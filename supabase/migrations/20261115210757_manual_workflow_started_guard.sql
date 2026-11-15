-- A local-only follow-up: preserve existing approvals, audit events and replay fences.
-- Reuses the locked inspector's existing associated jobs. No new portal scans.
begin;
create or replace function public.inspect_manual_workflow_completion(p_draft_id uuid,p_actor_user_id uuid) returns jsonb
language plpgsql security invoker set search_path=public,pg_temp set row_security=off set timezone='UTC' as $$
declare d public.report_drafts%rowtype; jobs jsonb; permits jsonb; s jsonb; letter text; blocked text; resolved boolean; started boolean;
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
  select 'praktika' as integration,j.id,jsonb_build_object('id',j.id,'status',j.status,'lock_owned',j.locked_by is not null,'locked_at',j.locked_at,
   'ended_at',case when j.status='failed' then coalesce(j.failed_at,j.updated_at) else coalesce(j.completed_at,j.updated_at) end,'revision',j.updated_at) as value
  from public.praktika_helper_jobs j where j.id in (select id from public.workflow_resolution_associated_jobs(p_draft_id))
  union all
  select 'mediref',j.id,jsonb_build_object('id',j.id,'status',j.status,'lock_owned',j.locked_by is not null,'locked_at',j.locked_at,'ended_at',j.updated_at,'revision',j.updated_at)
  from public.mediref_helper_jobs j where lower(j.payload->>'draftId')=p_draft_id::text or j.payload->>'workflowContinuationId'=md5('praktika-complete-workflow:v1:'||p_draft_id::text)::uuid::text
 ) x;
 select coalesce(jsonb_agg(jsonb_build_object('id',a.id,'jobId',a.details->>'jobId','createdAt',a.created_at) order by a.id),'[]') into permits
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
 return jsonb_build_object('fingerprint',encode(sha256(convert_to(s::text,'UTF8')),'hex'),'letterFingerprint',letter,
  'eligible',not resolved and blocked is null,'alreadyResolved',resolved,'reasonCode',case when resolved then 'already_resolved' else blocked end);
end $$;
revoke all on function public.inspect_manual_workflow_completion(uuid,uuid) from public,anon,authenticated;
grant execute on function public.inspect_manual_workflow_completion(uuid,uuid) to service_role;
commit;
