-- Cheap candidate discovery; the original predicate remains authoritative.
begin;
create or replace function public.workflow_resolution_associated_jobs(p_draft_id uuid)
returns setof public.praktika_helper_jobs
language sql stable security invoker rows 10
set search_path=public,pg_temp set row_security=off as $$
 with target as materialized (
  select v.id,d.praktika_letter_icon_appointment_id,d.praktika_letter_icon_updated_at,
   d.praktika_letter_icon_update_response_preview,
   md5('praktika-complete-workflow:v1:'||v.id::text)::uuid as parent_id,
   substr(encode(sha256(convert_to('praktika-continuation-child:v1','UTF8')||decode('00','hex')||
    convert_to(md5('praktika-complete-workflow:v1:'||v.id::text)::uuid::text,'UTF8')||decode('00','hex')||
    convert_to('update_praktika_letter_icons','UTF8')),'hex'),1,32)::uuid as icon_id
  from (values(p_draft_id)) v(id) left join public.report_drafts d on d.id=v.id
 ), candidates as materialized (
  select j.id from public.praktika_helper_jobs j cross join target t
  where j.id=t.parent_id or lower(j.request->>'reportDraftId')=t.id::text
   or j.request->>'continuationId'=t.parent_id::text
   or (j.job_type='upload_report_to_praktika' and split_part(j.request#>>'{body,file,path}','/',1)='report-uploads'
    and split_part(j.request#>>'{body,file,path}','/',3)=t.id::text)
   or (j.job_type='update_praktika_letter_icons' and j.request->>'reportDraftId' is null
    and j.request->>'continuationId' is null and (j.id=t.icon_id or (j.status='completed'
     and t.praktika_letter_icon_appointment_id is not null and t.praktika_letter_icon_updated_at is not null
     and t.praktika_letter_icon_update_response_preview is not null
     and j.request#>>'{body,0,appointment_id}'=t.praktika_letter_icon_appointment_id)))
 ), selected as materialized (
  select j.* from public.praktika_helper_jobs j join candidates c on c.id=j.id
 )
 select j.* from selected j where public.workflow_resolution_job_associated(to_jsonb(j),p_draft_id);
$$;
revoke all on function public.workflow_resolution_associated_jobs(uuid) from public,anon,authenticated;
grant execute on function public.workflow_resolution_associated_jobs(uuid) to service_role;

-- Existing role/provider checks, row locks, fingerprints and safety predicates are unchanged.
create or replace function public.workflow_resolution_legacy_draft_safe(p_draft_id uuid)
returns boolean language sql stable security invoker set search_path=public,pg_temp set row_security=off as $$
 select (
   exists(select 1 from praktika_helper_jobs where id=md5('praktika-complete-workflow:v1:' || p_draft_id::text)::uuid)
   or exists(select 1 from report_drafts d where d.id=p_draft_id
     and exists(select 1 from praktika_helper_jobs j where j.job_type='upload_report_to_praktika'
       and (lower(j.request->>'reportDraftId')=d.id::text or j.request#>>'{body,file,path}' like '%/' || d.id::text || '/%')
       and j.status='completed' and public.workflow_resolution_legacy_execution_safe(to_jsonb(j)))
     and (d.workflow_icon_update_status in ('skipped','not_requested') or exists(select 1 from praktika_helper_jobs j
       where j.job_type='update_praktika_letter_icons' and j.id in (select id from public.workflow_resolution_associated_jobs(d.id))
       and j.status='completed' and public.workflow_resolution_legacy_execution_safe(to_jsonb(j))))
     and (d.workflow_mediref_status in ('skipped','not_requested') or exists(select 1 from mediref_helper_jobs j
       where lower(j.payload->>'draftId')=d.id::text and j.status='completed' and public.workflow_resolution_legacy_execution_safe(to_jsonb(j)))))
 ) and public.workflow_resolution_mediref_audit_safe(p_draft_id)
 and not exists(select 1 from praktika_helper_jobs j where j.id in (select id from public.workflow_resolution_associated_jobs(p_draft_id)) and (public.workflow_resolution_job_target_consistent(to_jsonb(j),p_draft_id) is distinct from true or public.workflow_resolution_legacy_execution_safe(to_jsonb(j)) is distinct from true
   or (j.job_type='complete_report_workflow' and (j.id<>md5('praktika-complete-workflow:v1:' || p_draft_id::text)::uuid
     or j.request->>'reportDraftId' is distinct from p_draft_id::text or j.app_user_id is null
     or j.request->>'actorUserId' is distinct from j.app_user_id::text))))
 and not exists(select 1 from mediref_helper_jobs j where (lower(j.payload->>'draftId')=p_draft_id::text
   or j.payload->>'workflowContinuationId'=md5('praktika-complete-workflow:v1:' || p_draft_id::text)::uuid::text)
   and (public.workflow_resolution_job_target_consistent(to_jsonb(j),p_draft_id) is distinct from true or public.workflow_resolution_legacy_execution_safe(to_jsonb(j)) is distinct from true));
$$;

create or replace function public.workflow_resolution_snapshot(p_draft_id uuid, p_actor_user_id uuid)
returns jsonb language plpgsql security invoker set search_path=public,pg_temp set row_security=off set timezone='UTC' as $$
declare d public.report_drafts%rowtype; parent public.praktika_helper_jobs%rowtype; pj jsonb; mj jsonb; events jsonb; snap jsonb; safe boolean; reason text;
begin
  if current_setting('transaction_isolation') <> 'read committed' then raise exception 'resolution_isolation_unsupported'; end if;
  select * into d from report_drafts where id=p_draft_id for update;
  if not found or d.deleted_at is not null or coalesce(d.status,'') not in ('approved','uploaded_to_praktika')
    or d.provider_approved_at is null or nullif(btrim(coalesce(nullif(d.edited_text,''),nullif(d.ai_generated_text,''),d.source_text)), '') is null then raise exception 'resolution_invalid_draft'; end if;
  perform 1 from user_status where user_id=p_actor_user_id and is_active is true for share;
  if not found then raise exception 'resolution_not_authorized'; end if;
  perform 1 from user_roles where user_id=p_actor_user_id and role::text in ('typist','practice_manager','admin','super_admin') for share;
  if not found then raise exception 'resolution_not_authorized'; end if;
  perform 1 from providers where id=d.provider_id and is_active is true for share;
  if not found then raise exception 'resolution_not_authorized'; end if;
  select * into parent from praktika_helper_jobs where id=md5('praktika-complete-workflow:v1:' || p_draft_id::text)::uuid for update;
  perform 1 from praktika_helper_jobs where id in (select id from public.workflow_resolution_associated_jobs(p_draft_id)) order by id for update;
  perform 1 from mediref_helper_jobs where lower(payload->>'draftId')=p_draft_id::text or payload->>'workflowContinuationId'=parent.id::text order by id for update;
  select coalesce(jsonb_agg(to_jsonb(j) order by j.id),'[]') into pj from praktika_helper_jobs j where j.id in (select id from public.workflow_resolution_associated_jobs(p_draft_id));
  select coalesce(jsonb_agg(to_jsonb(j) order by j.id),'[]') into mj from mediref_helper_jobs j where lower(payload->>'draftId')=p_draft_id::text or payload->>'workflowContinuationId'=parent.id::text;
  select coalesce(jsonb_agg(to_jsonb(a) order by a.created_at,a.id),'[]') into events from report_writing_audit_events a where entity_type='report_draft' and entity_id=p_draft_id::text;
  safe := not exists(select 1 from jsonb_array_elements(pj || mj) j where public.workflow_resolution_legacy_execution_safe(j) is distinct from true);
  if parent.id is not null and (parent.job_type is distinct from 'complete_report_workflow' or parent.request->>'reportDraftId' is distinct from p_draft_id::text
      or parent.app_user_id is null or parent.request->>'actorUserId' is distinct from parent.app_user_id::text
      or parent.status not in ('failed','completed') or parent.locked_at is not null or parent.locked_by is not null or parent.response->>'dispatched'='true') then safe:=false; end if;
  if exists(select 1 from jsonb_array_elements(pj) j where j->>'job_type'='complete_report_workflow' and j->>'id' is distinct from parent.id::text) then safe:=false; end if;
  if d.emailed_to_referrer_resend_id like 'mediref:preparing:%' then safe:=false; end if;
  if exists(select 1 from jsonb_array_elements(events) a where a->>'action'='workflow_resolution_execution'
      and not exists(select 1 from jsonb_array_elements(events) b where b->>'action'='workflow_resolution_settled' and b#>>'{details,permitId}'=a->>'id')) then safe:=false; end if;
  -- Legacy terminal status does not prove that execution stopped safely.
  if not public.workflow_resolution_legacy_draft_safe(p_draft_id) then safe:=false; end if;
  if parent.response#>>'{medirefPreparationFailure,insertionOutcome}' in ('unconfirmed','attempted') or parent.response#>>'{medirefPreparationFailure,externalExecution}'='uncertain'
      or parent.response#>>'{medirefPreparationFailure,deadlineExceeded}'='true' then safe:=false; end if;
  snap:=jsonb_build_object('draft',to_jsonb(d),'parent',case when parent.id is null then null else to_jsonb(parent) end,'praktika',pj,'mediref',mj,'events',events);
  return snap || jsonb_build_object('fingerprint',encode(sha256(convert_to(snap::text,'UTF8')),'hex'),
    'letterFingerprint',public.workflow_resolution_letter_fingerprint(d),'executionSafe',safe,
    'reason',case when safe then null else 'Execution is active or uncertain. Reconcile it before verifying or resuming.' end);
end $$;

create or replace function public.manual_letter_icon_closed(p_draft_id uuid) returns boolean
language plpgsql stable security invoker set search_path=public,pg_temp set row_security=off set timezone='UTC' as $$
declare d public.report_drafts%rowtype; s jsonb;
begin
 if not exists(select 1 from report_writing_audit_events a where a.entity_type='report_draft' and a.entity_id=p_draft_id::text
 and a.action='workflow_resolution_completed' and a.details->>'manualIconContract'='manual-letter-icon-v1') then return false; end if;
 select * into d from report_drafts where id=p_draft_id;
 if not found then return false; end if;
 s:=jsonb_build_object('draft',to_jsonb(d),'letterFingerprint',public.workflow_resolution_letter_fingerprint(d),
 'parent',(select to_jsonb(j) from praktika_helper_jobs j where j.id=md5('praktika-complete-workflow:v1:'||p_draft_id::text)::uuid),
 'praktika',(select coalesce(jsonb_agg(to_jsonb(j) order by j.id),'[]') from praktika_helper_jobs j where j.id in (select id from public.workflow_resolution_associated_jobs(p_draft_id))),
 'mediref',(select coalesce(jsonb_agg(to_jsonb(j) order by j.id),'[]') from mediref_helper_jobs j where lower(j.payload->>'draftId')=p_draft_id::text or j.payload->>'workflowContinuationId'=md5('praktika-complete-workflow:v1:'||p_draft_id::text)::uuid::text),
 'events',(select coalesce(jsonb_agg(to_jsonb(a) order by a.created_at,a.id),'[]') from report_writing_audit_events a where a.entity_type='report_draft' and a.entity_id=p_draft_id::text));
 if not public.manual_letter_icon_ready(s) then return false; end if;
 return exists(select 1 from report_writing_audit_events a where a.entity_type='report_draft' and a.entity_id=p_draft_id::text
 and a.action='workflow_resolution_completed' and a.details->>'contract'='workflow-resolution-v1' and a.details->>'version'='1'
 and a.details->>'manualIconContract'='manual-letter-icon-v1' and a.details->>'letterFingerprint'=s->>'letterFingerprint'
 and a.details->>'evidenceFingerprint'=public.manual_letter_icon_fingerprint(s) and a.details->'iconManuallyVerified'='true'::jsonb);
end $$;
-- Failed icons still require cleared locks. Completed non-icon helpers must pass
-- the existing authoritative execution-safety check, which recognises retained
-- terminal lock fields only with valid settled results and no uncertainty.
create or replace function public.manual_letter_icon_ready(s jsonb) returns boolean
language plpgsql stable security invoker set search_path=public,pg_temp set row_security=off set timezone='UTC' as $$
declare d jsonb:=s->'draft'; p jsonb:=s->'parent'; j jsonb; i jsonb; uploads int:=0; icons int:=0; med int:=0;
begin
 if coalesce(d->>'status','') not in ('approved','uploaded_to_praktika') or d->>'deleted_at' is not null or d->>'provider_approved_at' is null
 or p->>'id' is distinct from md5('praktika-complete-workflow:v1:'||(d->>'id'))::uuid::text
 or p->>'job_type' is distinct from 'complete_report_workflow' or p->>'status' is distinct from 'failed'
 or p->>'locked_at' is not null or p->>'locked_by' is not null or p->>'failed_at' is null
 or p#>>'{request,reportDraftId}' is distinct from d->>'id' or p->>'app_user_id' is null
 or p#>>'{request,actorUserId}' is distinct from p->>'app_user_id'
 or p#>>'{request,options,praktikaPatientId}' is distinct from d->>'praktika_patient_id' or nullif(d->>'praktika_patient_id','') is null
 or coalesce(p#>>'{response,stage}','') not in ('icon','mediref')
 or coalesce(p#>>'{response,dispatched}','false')<>'false'
 or public.workflow_resolution_execution_conflict(p->'response') is distinct from false
 or p#>'{response,medirefPreparationFailure}' is not null
 or jsonb_typeof(p#>'{request,options,attachPeriodontalChart}') is distinct from 'boolean'
 or coalesce(d->>'emailed_to_referrer_resend_id','') like 'mediref:preparing:%' then return false; end if;
 for j in select value from jsonb_array_elements(s->'praktika') loop
  if j->>'id'=p->>'id' then continue; end if;
  if public.workflow_resolution_job_target_consistent(j,(d->>'id')::uuid) is distinct from true
  or j#>>'{request,reportDraftId}' is distinct from d->>'id' then return false; end if;
  if j->>'job_type'='update_praktika_letter_icons' then
   icons:=icons+1; i:=j;
   if j->>'status' is distinct from 'failed' or j->>'failed_at' is null
    or j->>'locked_at' is not null or j->>'locked_by' is not null then return false; end if;
  elsif j->>'job_type'='upload_report_to_praktika' then
   uploads:=uploads+1;
   if j->>'status' is distinct from 'completed' or public.workflow_resolution_legacy_execution_safe(j) is distinct from true then return false; end if;
  elsif public.workflow_resolution_periodontal_read(j) is distinct from true or public.workflow_resolution_legacy_execution_safe(j) is distinct from true then return false;
  end if;
 end loop;
 if icons<>1 or uploads<>1 or i#>>'{request,method}' is distinct from 'POST'
 or i#>>'{request,path}' is distinct from '/php/forms/db_commitFormData.php' or i#>>'{request,contentType}' is distinct from 'json'
 or jsonb_typeof(i#>'{request,body}') is distinct from 'array' then return false; end if;
 if jsonb_array_length(i#>'{request,body}')<>1 or public.workflow_resolution_positive_read_id(i#>'{request,body,0,appointment_id}') is distinct from true
 or public.workflow_resolution_positive_read_id(i#>'{request,body,0,practice_id}') is distinct from true then return false; end if;
 if not exists(select 1 from report_letter_queue q where q.report_draft_id::text=d->>'id'
 and q.appointment_id=i#>>'{request,body,0,appointment_id}' and q.praktika_patient_id=d->>'praktika_patient_id') then return false; end if;
 for j in select value from jsonb_array_elements(s->'mediref') loop
  med:=med+1;
  if j->>'job_type' is distinct from 'send_mediref_letter' or j->>'status' is distinct from 'completed'
  or j#>>'{payload,draftId}' is distinct from d->>'id'
  or (j#>>'{payload,workflowContinuationId}' is not null and j#>>'{payload,workflowContinuationId}'<>p->>'id')
  or public.workflow_resolution_legacy_execution_safe(j) is distinct from true then return false; end if;
  if p#>>'{request,options,attachPeriodontalChart}'='true' then
   if d->>'workflow_periodontal_chart_status' is distinct from 'completed' or d->>'periodontal_chart_attached_at' is null
   or nullif(d->>'periodontal_chart_attachment_name','') is null or nullif(d->>'periodontal_chart_attachment_error','') is not null
   or jsonb_typeof(j#>'{payload,attachments}') is distinct from 'array' then return false; end if;
   if (select count(*) from jsonb_array_elements(j#>'{payload,attachments}') a where a->>'fileName'=d->>'periodontal_chart_attachment_name')<>1 then return false; end if;
  elsif coalesce(d->>'workflow_periodontal_chart_status','not_requested') not in ('skipped','not_requested')
   or nullif(d->>'periodontal_chart_attachment_error','') is not null then return false; end if;
 end loop;
 if med<>1 or public.workflow_resolution_mediref_audit_safe((d->>'id')::uuid) is distinct from true then return false; end if;
 if exists(select 1 from jsonb_array_elements(s->'events') a where a->>'action'='workflow_resolution_execution'
 and not exists(select 1 from jsonb_array_elements(s->'events') b where b->>'action'='workflow_resolution_settled' and b#>>'{details,permitId}'=a->>'id')
 and coalesce(a#>>'{details,jobId}','') not in (p->>'id',i->>'id')) then return false; end if;
 return true;
end $$;
commit;
