-- Attention policy only. No existing record is dispositioned by installation.
begin;
set local lock_timeout='3s';
do $$ begin if current_user<>'postgres' then raise exception 'Migration requires reviewed postgres owner';end if;end $$;

create index historical_attention_lookup on public.report_writing_audit_events(entity_id,action)
 where action in ('historical_attention_disposition','historical_attention_invalidated');
create unique index historical_attention_epoch on public.report_writing_audit_events(entity_id,(details->>'epoch'))
 where action='historical_attention_disposition';
create index historical_attention_fences on public.report_writing_audit_events using gin ((details->'fenceKeys'))
 where action='historical_attention_disposition';

-- Do not invalidate existing completion evidence merely by recording attention policy.
-- Preserve every other instruction in the installed historical fence.
do $$
declare definition text; old_clause text:='(''system_historical_reconciliation'',''system_historical_reconciliation_invalidated'',''system_historical_retention_released'') then';
begin
 definition:=pg_get_functiondef('public.fence_historical_workflow_write()'::regprocedure);
 if position(old_clause in definition)=0 then raise exception 'Unexpected historical fence definition';end if;
 execute replace(definition,old_clause,'(''system_historical_reconciliation'',''system_historical_reconciliation_invalidated'',''system_historical_retention_released'',''historical_attention_disposition'',''historical_attention_invalidated'') then');
end $$;

-- Snapshot is private and exact-draft only. Return hash/keys, never source bodies.
create function public.inspect_historical_attention(p_draft_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare d public.report_drafts%rowtype; pj jsonb; mj jsonb; audits jsonb; keys text[]; v text;
begin
 select * into d from public.report_drafts where id=p_draft_id;
 if not found or d.deleted_at is not null or d.status not in ('approved','uploaded_to_praktika')
   or d.created_at is null or d.created_at>='2026-09-16T00:00:00Z'::timestamptz
   or d.provider_approved_at>='2026-09-16T00:00:00Z'::timestamptz
   or d.updated_at is null or d.workflow_status='running' then return jsonb_build_object('ok',false,'code','not_historical');end if;
 select coalesce(jsonb_agg(to_jsonb(j) order by j.id),'[]') into pj from public.praktika_helper_jobs j where
   j.id=md5('praktika-complete-workflow:v1:'||d.id::text)::uuid or j.request->>'reportDraftId'=d.id::text
   or position('/'||d.id::text||'/' in coalesce(j.request#>>'{body,file,path}',''))>0
   or (d.praktika_letter_icon_appointment_id is not null and j.request#>>'{body,0,appointment_id}'=d.praktika_letter_icon_appointment_id);
 select coalesce(jsonb_agg(to_jsonb(j) order by j.id),'[]') into mj from public.mediref_helper_jobs j where j.payload->>'draftId'=d.id::text;
 if exists(select 1 from jsonb_array_elements(pj||mj) j where j->>'status' in ('pending','waiting','running','processing')) then
   return jsonb_build_object('ok',false,'code','active_work');end if;
 -- A recent normal attempt is current work even if it has already failed.
 -- Only the exact approved, deterministic historical-remediation provenance is exempt.
 if exists(select 1 from jsonb_array_elements(pj||mj) x where
   (nullif(x->>'created_at','')::timestamptz>='2026-09-16T00:00:00Z'::timestamptz
    or nullif(x->>'updated_at','')::timestamptz>='2026-09-16T00:00:00Z'::timestamptz)
   and not coalesce(x->>'job_type'='upload_report_to_praktika'
    and x#>>'{request,historicalRemediation,source}'='historical_remediation_reupload'
    and x#>>'{request,historicalRemediation,policyVersion}'='historical-praktika-remediation:v1'
    and x#>>'{request,historicalRemediation,draftId}'=d.id::text
    and x#>>'{request,historicalRemediation,manifestDigest}'='e399e2d422af85cdacd9cfba0618f9742728183ba5a2e554116bb0ee6e44b8f5'
    and (x->>'id')::uuid=substr(encode(sha256(convert_to('historical-praktika-remediation:v1:'||d.id::text,'UTF8')),'hex'),1,32)::uuid,false)) then
   return jsonb_build_object('ok',false,'code','current_work');end if;
 select coalesce(jsonb_agg(to_jsonb(a) order by a.id),'[]') into audits from public.report_writing_audit_events a
 where a.entity_id=d.id::text and a.action not in ('historical_attention_disposition','historical_attention_invalidated');
 keys:=array['draft:'||d.id::text,'job:'||md5('praktika-complete-workflow:v1:'||d.id::text)::uuid::text];
 for v in select j->>'id' from jsonb_array_elements(pj||mj) j loop keys:=array_append(keys,'job:'||v);end loop;
 for v in select j->>'id' from jsonb_array_elements(audits) j loop keys:=array_append(keys,'audit:'||v);end loop;
 if d.praktika_letter_icon_appointment_id is not null then keys:=array_append(keys,'appointment:'||d.praktika_letter_icon_appointment_id);end if;
 return jsonb_build_object('ok',true,'epoch',public.historical_reconciliation_epoch(d.created_at,d.provider_approved_at),
  'draftRevision',d.updated_at,'fingerprint',encode(sha256(convert_to(jsonb_build_object('draft',to_jsonb(d),'praktika',pj,'mediref',mj,'audits',audits)::text,'UTF8')),'hex'),
  'fenceKeys',to_jsonb(keys));
end $$;

-- Deliberate administrative decision, authenticated actor from the JWT, never caller-supplied actor.
-- Evidence kind is either a positively confirmed stored upload or explicit human attestation
-- for the exact reviewed PDF/artifact and patient. Neither claims other branches succeeded.
create function public.disposition_historical_attention(p_draft_id uuid,p_fingerprint text,p_manifest_digest text,
 p_upload_job_id uuid,p_artifact_fingerprint text,p_evidence_kind text,p_operator_confirmed boolean default false,p_execute boolean default false)
returns jsonb language plpgsql security definer set search_path='' as $$
declare actor uuid:=auth.uid(); proposal jsonb; fresh jsonb; d public.report_drafts%rowtype;
 j public.praktika_helper_jobs%rowtype; old_event public.report_writing_audit_events%rowtype;
 event_id uuid; k text; f jsonb; result jsonb;
begin
 if actor is null or (select count(*) from public.user_status where user_id=actor)<>1
   or not exists(select 1 from public.user_status where user_id=actor and is_active is true)
   or (select count(*) from public.user_roles where user_id=actor)<>1
   or not exists(select 1 from public.user_roles where user_id=actor and role::text in ('admin','super_admin')) then
   return jsonb_build_object('ok',false,'code','forbidden');end if;
 if p_execute is null or p_operator_confirmed is null or p_fingerprint is null or p_fingerprint!~'^[a-f0-9]{64}$'
   or p_manifest_digest is null or p_manifest_digest!~'^[a-f0-9]{64}$'
   or p_artifact_fingerprint is null or p_artifact_fingerprint!~'^[a-f0-9]{64}$'
   or p_evidence_kind is null or p_evidence_kind not in ('confirmed_upload','operator_attestation')
   or current_setting('transaction_isolation')<>'read committed' then return jsonb_build_object('ok',false,'code','invalid_review');end if;
 if not pg_try_advisory_xact_lock(hashtextextended('historical-reconciliation:draft:'||p_draft_id::text,0)) then return jsonb_build_object('ok',false,'code','busy');end if;
 select * into d from public.report_drafts where id=p_draft_id for update nowait;
 if not found then return jsonb_build_object('ok',false,'code','not_historical');end if;
 event_id:=extensions.uuid_generate_v5('66d895a8-f955-5e36-a98c-62791e7d92bf',p_draft_id::text||':'||public.historical_reconciliation_epoch(d.created_at,d.provider_approved_at)||':attention-v1');
 select * into old_event from public.report_writing_audit_events where id=event_id;
 if found then
  if old_event.action='historical_attention_disposition' and old_event.details->>'reviewedFingerprint'=p_fingerprint
   and old_event.details->>'manifestDigest'=p_manifest_digest and old_event.details#>>'{pdfEvidence,jobId}'=p_upload_job_id::text
   and old_event.details#>>'{pdfEvidence,artifactFingerprint}'=p_artifact_fingerprint
   and old_event.details#>>'{pdfEvidence,kind}'=p_evidence_kind
   and not exists(select 1 from public.report_writing_audit_events where id=extensions.uuid_generate_v5(event_id,'invalidated')) then
    return jsonb_build_object('ok',true,'code','already_dispositioned','eventId',event_id);end if;
  return jsonb_build_object('ok',false,'code','conflicting_or_superseded');
 end if;
 proposal:=public.inspect_historical_attention(p_draft_id);
 if proposal->>'ok' is distinct from 'true' then return proposal;end if;
 for k in select jsonb_array_elements_text(proposal->'fenceKeys') order by 1 loop
  if not pg_try_advisory_xact_lock(hashtextextended('historical-reconciliation:'||k,0)) then return jsonb_build_object('ok',false,'code','busy');end if;
 end loop;
 fresh:=public.inspect_historical_attention(p_draft_id);
 if fresh is distinct from proposal or fresh->>'fingerprint' is distinct from p_fingerprint then return jsonb_build_object('ok',false,'code','state_changed');end if;
 select * into j from public.praktika_helper_jobs where id=p_upload_job_id;
 if not found or j.job_type<>'upload_report_to_praktika' then return jsonb_build_object('ok',false,'code','pdf_not_proven');end if;
 f:=j.request#>'{body,file}';result:=j.response;
 if j.request->>'method' is distinct from 'POST' or j.request->>'path' is distinct from '/php/forms/db_updateFormData.php'
   or j.request->>'contentType' is distinct from 'multipart_storage'
   or f->>'fieldName' is distinct from 'patient_communication[file][file]'
   or j.request#>>'{body,fields,patient_communication[file][name]}' is distinct from f->>'fileName'
   or (j.request ? 'reportDraftId' and j.request->>'reportDraftId' is distinct from d.id::text)
   or f->>'contentType' is distinct from 'application/pdf' or coalesce(f->>'bucket','')=''
   or coalesce(f->>'fileName','')='' or coalesce(d.praktika_patient_id,'')=''
   or j.request#>>'{body,fields,patient_id}' is distinct from d.praktika_patient_id
   or position('/'||d.id::text||'/' in coalesce(f->>'path',''))=0
   or encode(sha256(convert_to(f::text,'UTF8')),'hex') is distinct from p_artifact_fingerprint then
  return jsonb_build_object('ok',false,'code','artifact_or_patient_mismatch');end if;
 if p_evidence_kind='confirmed_upload' and (j.status<>'completed'
   or coalesce(result->>'error','false') not in ('false','null','') or coalesce(result->>'errors','false') not in ('false','null','')
   or result->>'success'='false' or coalesce(result#>>'{patient_communication,iFileId}','')!~'^[1-9][0-9]*$') then
  return jsonb_build_object('ok',false,'code','pdf_not_proven');end if;
 if p_evidence_kind='operator_attestation' and not p_operator_confirmed then return jsonb_build_object('ok',false,'code','confirmation_required');end if;
 if not p_execute then return jsonb_build_object('ok',true,'code','eligible','eventId',event_id);end if;
 insert into public.report_writing_audit_events(id,entity_type,entity_id,provider_id,action,details)
 values(event_id,'report_draft',d.id::text,d.provider_id,'historical_attention_disposition',jsonb_build_object(
  'source','protected_historical_attention','policyVersion','historical-attention-v1','draftId',d.id,'epoch',fresh->>'epoch',
  'draftRevision',d.updated_at,'reviewedFingerprint',p_fingerprint,'manifestDigest',p_manifest_digest,'authorizerUserId',actor,
  'recordedAt',clock_timestamp(),'disposition','historical_non_actionable','reason','historical_pdf_present_no_further_action',
  'branches',jsonb_build_array('mediref','icon','bookkeeping'),'fenceKeys',fresh->'fenceKeys',
  'pdfEvidence',jsonb_build_object('presence','confirmed_present','kind',p_evidence_kind,'jobId',j.id,'artifactFingerprint',p_artifact_fingerprint)));
 return jsonb_build_object('ok',true,'code','dispositioned','eventId',event_id);
exception when lock_not_available then return jsonb_build_object('ok',false,'code','busy');
end $$;

create function public.protect_historical_attention()
returns trigger language plpgsql security invoker set search_path='' as $$
begin
 if TG_OP='TRUNCATE' then raise exception 'Attention audit is immutable';end if;
 if TG_OP in ('UPDATE','DELETE') and old.action in ('historical_attention_disposition','historical_attention_invalidated') then raise exception 'Attention audit is immutable';end if;
 if TG_OP in ('INSERT','UPDATE') and new.action in ('historical_attention_disposition','historical_attention_invalidated') then
  if current_user<>'postgres' then raise exception 'Protected attention event';end if;
  if new.entity_type<>'report_draft' or new.details->>'source' is distinct from 'protected_historical_attention' then raise exception 'Invalid attention event';end if;
 end if;
 if TG_OP='DELETE' then return old;end if;return new;
end $$;

create function public.fence_historical_attention_write()
returns trigger language plpgsql security definer set search_path='' as $$
declare oldj jsonb:=case when TG_OP='INSERT' then '{}'::jsonb else to_jsonb(old) end;
 newj jsonb:=case when TG_OP='DELETE' then '{}'::jsonb else to_jsonb(new) end;
 keys text[]:='{}'; k text; j jsonb; candidate text; event record; invalid_id uuid;
begin
 if TG_TABLE_NAME='report_writing_audit_events' and coalesce(newj->>'action',oldj->>'action') in
   ('historical_attention_disposition','historical_attention_invalidated') then
   if TG_OP='DELETE' then return old; end if;return new;
 end if;
 foreach j in array array[oldj,newj] loop
   if j='{}' then continue; end if;
   if TG_TABLE_NAME='report_drafts' then keys:=array_append(keys,'draft:'||(j->>'id'));
     if coalesce(j->>'praktika_letter_icon_appointment_id','')<>'' and
       (TG_OP<>'UPDATE' or oldj->'praktika_letter_icon_appointment_id' is distinct from newj->'praktika_letter_icon_appointment_id'
        or oldj->'praktika_letter_icon_updated_at' is distinct from newj->'praktika_letter_icon_updated_at') then
       keys:=array_append(keys,'appointment:'||(j->>'praktika_letter_icon_appointment_id'));end if;
   elsif TG_TABLE_NAME='praktika_helper_jobs' then
     keys:=array_append(keys,'job:'||(j->>'id'));
     for candidate in select j#>>'{request,reportDraftId}' union
       select v from regexp_split_to_table(coalesce(j#>>'{request,body,file,path}',''),'/') v loop
       if candidate ~ '^[0-9a-f-]{36}$' then keys:=array_append(keys,'draft:'||candidate);end if;
     end loop;
     if coalesce(j#>>'{request,body,0,appointment_id}','')<>'' then keys:=array_append(keys,'appointment:'||(j#>>'{request,body,0,appointment_id}'));end if;
   elsif TG_TABLE_NAME='mediref_helper_jobs' then keys:=array_append(keys,'job:'||(j->>'id'));
     if coalesce(j#>>'{payload,draftId}','')<>'' then keys:=array_append(keys,'draft:'||(j#>>'{payload,draftId}'));end if;
   else
     keys:=array_append(keys,'audit:'||(j->>'id'));
     if coalesce(j#>>'{details,helperJobId}','')<>'' then keys:=array_append(keys,'job:'||(j#>>'{details,helperJobId}'));end if;
     if coalesce(j->>'entity_id','') ~ '^[0-9a-f-]{36}$' then keys:=array_append(keys,'draft:'||(j->>'entity_id'));end if;
   end if;
 end loop;
 for k in select distinct v from unnest(keys) v where v is not null order by v loop
   perform pg_advisory_xact_lock_shared(hashtextextended('historical-reconciliation:'||k,0));
 end loop;
 for event in select * from public.report_writing_audit_events a where a.action='historical_attention_disposition'
   and (a.details->'fenceKeys') ?| keys loop
   invalid_id:=extensions.uuid_generate_v5(event.id,'invalidated');
   insert into public.report_writing_audit_events(id,action,entity_type,entity_id,provider_id,details)
   values(invalid_id,'historical_attention_invalidated','report_draft',event.entity_id,event.provider_id,
    jsonb_build_object('source','protected_historical_attention','dispositionId',event.id,'reason','superseding_database_activity')) on conflict(id) do nothing;
 end loop;
 if TG_OP='DELETE' then return old;end if;return new;
end $$;

create trigger a_protect_historical_attention before insert or update or delete on public.report_writing_audit_events
 for each row execute function public.protect_historical_attention();
create trigger protect_historical_attention_truncate before truncate on public.report_writing_audit_events
 for each statement execute function public.protect_historical_attention();
create trigger historical_attention_fence before insert or update or delete on public.report_drafts for each row execute function public.fence_historical_attention_write();
create trigger historical_attention_fence before insert or update or delete on public.praktika_helper_jobs for each row execute function public.fence_historical_attention_write();
create trigger historical_attention_fence before insert or update or delete on public.mediref_helper_jobs for each row execute function public.fence_historical_attention_write();
create trigger historical_attention_fence before insert or update or delete on public.report_writing_audit_events for each row execute function public.fence_historical_attention_write();

create function public.protect_historical_attention_source_truncate()
returns trigger language plpgsql security definer set search_path='' as $$
begin
 if exists(select 1 from public.report_writing_audit_events where action='historical_attention_disposition') then
  raise exception 'Attention evidence protects source tables';end if;
 return null;
end $$;
create trigger attention_source_truncate before truncate on public.report_drafts for each statement execute function public.protect_historical_attention_source_truncate();
create trigger attention_source_truncate before truncate on public.praktika_helper_jobs for each statement execute function public.protect_historical_attention_source_truncate();
create trigger attention_source_truncate before truncate on public.mediref_helper_jobs for each statement execute function public.protect_historical_attention_source_truncate();
revoke all on function public.protect_historical_attention_source_truncate() from public,anon,authenticated,service_role;
revoke all on function public.inspect_historical_attention(uuid),public.disposition_historical_attention(uuid,text,text,uuid,text,text,boolean,boolean),
 public.protect_historical_attention(),public.fence_historical_attention_write() from public,anon,authenticated,service_role;
grant execute on function public.inspect_historical_attention(uuid) to service_role;
grant execute on function public.disposition_historical_attention(uuid,text,text,uuid,text,text,boolean,boolean) to authenticated;
-- The RPC derives auth.uid() and requires exactly one active status and canonical admin role.
-- No RPC call or data disposition occurs in this migration.
commit;
