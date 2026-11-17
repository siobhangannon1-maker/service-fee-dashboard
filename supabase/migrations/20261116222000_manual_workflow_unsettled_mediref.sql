-- Manual workflow completion: tolerate an old MediRef request record that never created a job, and count cancelled jobs as finished.
-- A genuinely active job (pending, waiting, processing, running) still blocks, as does a cancelled or failed job with a newer lock.
-- No comment lines inside function bodies, so the Supabase SQL editor cannot split a statement.
begin;
create or replace function public.manual_workflow_unsettled_mediref_permit(s jsonb, permit jsonb) returns boolean
language sql stable security invoker set search_path=public,pg_temp as $$
 select permit->>'branch'='mediref' and permit->>'source'='request_operation' and nullif(permit->>'jobId','') is null
  and (permit->>'createdAt')::timestamptz < now() - interval '30 minutes'
  and not exists(select 1 from jsonb_array_elements(coalesce(s->'jobs','[]'::jsonb)) x where x->>'integration'='mediref');
$$;
create or replace function public.manual_workflow_completion_blocker(s jsonb) returns text
language plpgsql stable security invoker set search_path=public,pg_temp as $$
declare j jsonb; permit jsonb; stopped boolean;
begin
 for j in select value from jsonb_array_elements(s->'jobs') loop
  if coalesce(j->>'status','') not in ('completed','failed','cancelled') then return 'active_job'; end if;
  if j->>'status' in ('failed','cancelled') and (j->>'lock_owned'='true' or j->>'locked_at' is not null)
   and (j->>'locked_at' is null or j->>'ended_at' is null or (j->>'ended_at')::timestamptz<(j->>'locked_at')::timestamptz)
   then return 'active_job'; end if;
 end loop;
 if s->>'preparing'='true' then return 'active_preparation'; end if;
 for permit in select value from jsonb_array_elements(s->'permits') loop
  if public.manual_workflow_unsettled_mediref_permit(s,permit) then continue; end if;
  select exists(select 1 from jsonb_array_elements(s->'jobs') x where x->>'id'=permit->>'jobId'
   and x->>'status' in ('completed','failed','cancelled') and x->>'ended_at' is not null
   and (x->>'ended_at')::timestamptz >= (permit->>'createdAt')::timestamptz) into stopped;
  if not stopped then return 'active_operation'; end if;
 end loop;
 return null;
exception when invalid_datetime_format or datetime_field_overflow then return 'active_operation';
end $$;
create or replace function public.inspect_manual_workflow_completion(p_draft_id uuid,p_actor_user_id uuid) returns jsonb
language plpgsql security invoker set search_path=public,pg_temp set row_security=off set timezone='UTC' as $$
declare d public.report_drafts%rowtype; jobs jsonb; permits jsonb; s jsonb; letter text; blocked text; resolved boolean; started boolean; tolerated jsonb;
begin
 if current_setting('transaction_isolation')<>'read committed' then raise exception 'manual_workflow_isolation_unsupported'; end if;
 select * into d from public.report_drafts where id=p_draft_id for update;
 if not found or d.deleted_at is not null or coalesce(d.status,'') not in ('approved','uploaded_to_praktika') or d.provider_approved_at is null
  then raise exception 'manual_workflow_clinical_approval_required'; end if;
 perform 1 from public.user_status where user_id=p_actor_user_id and is_active is true for share;
 if not found then raise exception 'manual_workflow_not_authorised'; end if;
 perform 1 from public.user_roles where user_id=p_actor_user_id and role::text in ('typist','practice_manager','admin','super_admin') for share;
 if not found then raise exception 'manual_workflow_not_authorised'; end if;
 begin
 perform 1 from public.praktika_helper_jobs where id in (select id from public.workflow_resolution_associated_jobs(p_draft_id)) order by id for update nowait;
 perform 1 from public.mediref_helper_jobs where lower(payload->>'draftId')=p_draft_id::text or payload->>'workflowContinuationId'=md5('praktika-complete-workflow:v1:'||p_draft_id::text)::uuid::text order by id for update nowait;
 exception when lock_not_available then
  letter:=public.workflow_resolution_letter_fingerprint(d);
  return jsonb_build_object('eligible',false,'alreadyResolved',false,'reasonCode','active_job',
   'letterFingerprint',letter,'fingerprint',encode(sha256(convert_to('manual-workflow-completion-v1:busy:'||letter,'UTF8')),'hex'));
 end;
 select coalesce(jsonb_agg(x.value order by x.integration,x.id),'[]') into jobs from (
  select 'praktika' as integration,j.id,jsonb_build_object('id',j.id,'integration','praktika','status',j.status,'lock_owned',j.locked_by is not null,'locked_at',j.locked_at,
   'ended_at',case when j.status='failed' then coalesce(j.failed_at,j.updated_at) else coalesce(j.completed_at,j.updated_at) end,'revision',j.updated_at) as value
  from public.praktika_helper_jobs j where j.id in (select id from public.workflow_resolution_associated_jobs(p_draft_id))
  union all
  select 'mediref',j.id,jsonb_build_object('id',j.id,'integration','mediref','status',j.status,'lock_owned',j.locked_by is not null,'locked_at',j.locked_at,'ended_at',j.updated_at,'revision',j.updated_at)
  from public.mediref_helper_jobs j where lower(j.payload->>'draftId')=p_draft_id::text or j.payload->>'workflowContinuationId'=md5('praktika-complete-workflow:v1:'||p_draft_id::text)::uuid::text
 ) x;
 select coalesce(jsonb_agg(jsonb_build_object('id',a.id,'jobId',a.details->>'jobId','branch',a.details->>'branch','source',a.details->>'source','createdAt',a.created_at) order by a.id),'[]') into permits
 from public.report_writing_audit_events a where a.entity_type='report_draft' and a.entity_id=p_draft_id::text and a.action='workflow_resolution_execution'
 and not exists(select 1 from public.report_writing_audit_events b where b.entity_type='report_draft' and b.entity_id=p_draft_id::text and b.action='workflow_resolution_settled' and b.details->>'permitId'=a.id::text);
 letter:=public.workflow_resolution_letter_fingerprint(d);
 select exists(select 1 from public.report_writing_audit_events a where a.entity_type='report_draft' and a.entity_id=p_draft_id::text
  and a.action='workflow_resolution_completed' and a.details->>'contract'='workflow-resolution-v1' and a.details->>'letterFingerprint'=letter) into resolved;
 started:=d.workflow_started_at is not null or jsonb_array_length(jobs)>0;
 s:=jsonb_build_object('domain','manual-workflow-completion-v1','letterFingerprint',letter,'jobs',jobs,'permits',permits,
  'preparing',coalesce(d.emailed_to_referrer_resend_id,'') like 'mediref:preparing:%','resolved',resolved,'started',started);
 blocked:=public.manual_workflow_completion_blocker(s);
 if blocked is null and not started then blocked:='workflow_not_started'; end if;
 select coalesce(jsonb_agg(p.value->'id' order by p.value->>'id'),'[]') into tolerated
 from jsonb_array_elements(permits) p where public.manual_workflow_unsettled_mediref_permit(s,p.value);
 return jsonb_build_object('fingerprint',encode(sha256(convert_to(s::text,'UTF8')),'hex'),'letterFingerprint',letter,
  'eligible',not resolved and blocked is null,'alreadyResolved',resolved,'reasonCode',case when resolved then 'already_resolved' else blocked end,
  'unsettledMedirefPermits',tolerated);
end $$;
create or replace function public.confirm_manual_workflow_completion(p_draft_id uuid,p_actor_user_id uuid,p_fingerprint text,p_letter_fingerprint text,p_all_steps_confirmed boolean) returns jsonb
language plpgsql security invoker set search_path=public,pg_temp set row_security=off set timezone='UTC' as $$
declare s jsonb; event_id uuid:=gen_random_uuid(); t timestamptz; note jsonb:='{}'::jsonb;
begin
 if p_all_steps_confirmed is distinct from true then raise exception 'manual_workflow_confirmation_required'; end if;
 s:=public.inspect_manual_workflow_completion(p_draft_id,p_actor_user_id);
 if s->>'letterFingerprint' is distinct from p_letter_fingerprint then return jsonb_build_object('ok',false,'reasonCode','letter_changed'); end if;
 if s->>'alreadyResolved'='true' then return jsonb_build_object('ok',true,'reconciled',true); end if;
 if s->>'eligible' is distinct from 'true' then return jsonb_build_object('ok',false,'reasonCode',s->>'reasonCode'); end if;
 if s->>'fingerprint' is distinct from p_fingerprint then return jsonb_build_object('ok',false,'reasonCode','state_changed'); end if;
 if jsonb_array_length(coalesce(s->'unsettledMedirefPermits','[]'::jsonb))>0 then
  note:=jsonb_build_object('unsettledMedirefStep',true,'unsettledMedirefPermitIds',s->'unsettledMedirefPermits');
 end if;
 t:=clock_timestamp();
 insert into public.report_writing_audit_events(id,entity_type,entity_id,action,details) values(event_id,'report_draft',p_draft_id::text,'workflow_resolution_completed',
  jsonb_build_object('contract','workflow-resolution-v1','version',1,'draftId',p_draft_id,'letterFingerprint',p_letter_fingerprint,'previewFingerprint',p_fingerprint,
   'manualCompletionContract','manual-workflow-completion-v1','completionType','administrative_override','allRequiredStepsConfirmed',true,
   'reason','All required workflow steps have been completed manually or independently verified.',
   'actorUserId',p_actor_user_id,'completedAt',t,'source','operator_manual_completion') || note);
 update public.report_drafts set workflow_status='completed',updated_at=t where id=p_draft_id;
 return jsonb_build_object('ok',true,'eventId',event_id);
end $$;
revoke all on function public.manual_workflow_unsettled_mediref_permit(jsonb,jsonb),public.manual_workflow_completion_blocker(jsonb),public.inspect_manual_workflow_completion(uuid,uuid),public.confirm_manual_workflow_completion(uuid,uuid,text,text,boolean) from public,anon,authenticated;
grant execute on function public.manual_workflow_unsettled_mediref_permit(jsonb,jsonb),public.manual_workflow_completion_blocker(jsonb),public.inspect_manual_workflow_completion(uuid,uuid),public.confirm_manual_workflow_completion(uuid,uuid,text,text,boolean) to service_role;
commit;
