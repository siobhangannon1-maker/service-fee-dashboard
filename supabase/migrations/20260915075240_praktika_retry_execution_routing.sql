-- Explicit operator verification only. No historical jobs are updated.
begin;
create or replace function public.reserve_praktika_upload_retry(p_draft_id uuid, p_prior_job_id uuid, p_actor_user_id uuid)
returns jsonb language plpgsql security invoker set search_path = public, pg_temp as $$
declare d public.report_drafts%rowtype; parent public.praktika_helper_jobs%rowtype;
  prior public.praktika_helper_jobs%rowtype; replacement public.praktika_helper_jobs%rowtype;
  parent_id uuid := md5('praktika-complete-workflow:v1:' || p_draft_id::text)::uuid;
  replacement_id uuid := md5('praktika-manual-upload-retry:v1:' || p_prior_job_id::text)::uuid;
  audit jsonb; t timestamptz := clock_timestamp();
begin
  -- Same draft-first lock order as the original reservation. Serializes tabs/users.
  select * into d from public.report_drafts where id=p_draft_id for update;
  if not found or p_actor_user_id is null then return jsonb_build_object('ok',false,'code','not_eligible'); end if;
  select * into parent from public.praktika_helper_jobs where id=parent_id for update;
  if not found or parent.job_type <> 'complete_report_workflow'
    or parent.app_user_id is null
    or parent.request->>'actorUserId' is distinct from parent.app_user_id::text
    or parent.request->>'reportDraftId' is distinct from p_draft_id::text
    then return jsonb_build_object('ok',false,'code','not_authorized'); end if;
  if (select count(*) from public.user_status where user_id=p_actor_user_id) <> 1
    or not exists(select 1 from public.user_status where user_id=p_actor_user_id and is_active is true)
    then return jsonb_build_object('ok',false,'code','not_authorized'); end if;
  -- Same canonical Typist roles and active-provider rule as the API.
  if (select count(*) from public.user_roles where user_id=p_actor_user_id) <> 1
    or not exists(select 1 from public.user_roles where user_id=p_actor_user_id
      and role::text in ('admin','super_admin','practice_manager','typist'))
    or not exists(select 1 from public.providers where id=d.provider_id and is_active is true)
    then return jsonb_build_object('ok',false,'code','not_authorized'); end if;
  select * into prior from public.praktika_helper_jobs where id=p_prior_job_id for update;
  if not found or prior.job_type <> 'upload_report_to_praktika' or prior.status <> 'failed'
    or coalesce(prior.response#>>'{patient_communication,iFileId}','') ~ '^[0-9]*[1-9][0-9]*$'
    or prior.app_user_id is null
    or (prior.app_user_id is distinct from parent.app_user_id
      and (prior.request#>>'{manualRetry,actorUserId}' is distinct from prior.app_user_id::text
        or prior.request#>>'{manualRetry,verifiedAbsent}' is distinct from 'true'))
    or prior.request->>'reportDraftId' is distinct from p_draft_id::text
    or prior.request->>'continuationId' is distinct from parent_id::text
    then return jsonb_build_object('ok',false,'code','not_eligible'); end if;
  -- Reconcile even after completion/failure of the replacement: a stale click is
  -- never authorization for the next generation of retries.
  select * into replacement from public.praktika_helper_jobs where id=replacement_id;
  if found then
    if replacement.app_user_id is null
      or replacement.request#>>'{manualRetry,actorUserId}' is distinct from replacement.app_user_id::text
      or replacement.request#>>'{manualRetry,verifiedAbsent}' is distinct from 'true'
      or replacement.job_type <> 'upload_report_to_praktika'
      or replacement.request#>>'{manualRetry,priorJobId}' is distinct from p_prior_job_id::text
      or replacement.request->>'continuationId' is distinct from parent_id::text
      then return jsonb_build_object('ok',false,'code','collision'); end if;
    return jsonb_build_object('ok',true,'reconciled',true,'intentId',parent_id,'uploadJobId',replacement_id,'uploadStatus',replacement.status,'workflowStatus',d.workflow_status);
  end if;
  if d.deleted_at is not null or d.status <> 'approved' or coalesce(d.uploaded_to_praktika,false)
    or d.workflow_praktika_upload_status = 'completed' or parent.status <> 'failed'
    or parent.response->>'stage' is distinct from 'upload'
    then return jsonb_build_object('ok',false,'code','not_eligible'); end if;
  if parent.response->>'retryUploadId' is not null then
    if parent.response->>'retryUploadId' <> p_prior_job_id::text then
      return jsonb_build_object('ok',false,'code','not_current_attempt'); end if;
  elsif (select count(*) from public.praktika_helper_jobs where job_type='upload_report_to_praktika'
    and request->>'reportDraftId'=p_draft_id::text) <> 1 then
    return jsonb_build_object('ok',false,'code','existing_attempt');
  end if;
  if exists(select 1 from public.praktika_helper_jobs where job_type='upload_report_to_praktika'
    and request->>'reportDraftId'=p_draft_id::text and status <> 'failed') then
    return jsonb_build_object('ok',false,'code','existing_attempt'); end if;
  if exists (
    with recursive lineage as (
      select id,request from public.praktika_helper_jobs where id=p_prior_job_id
      union
      select j.id,j.request from public.praktika_helper_jobs j join lineage l
        on j.id::text=l.request#>>'{manualRetry,priorJobId}'
        where j.job_type='upload_report_to_praktika' and j.request->>'reportDraftId'=p_draft_id::text
          and j.status='failed' and j.request->>'continuationId'=parent_id::text
          and (j.app_user_id=parent.app_user_id or (j.request#>>'{manualRetry,actorUserId}'=j.app_user_id::text
            and j.request#>>'{manualRetry,verifiedAbsent}'='true'))
    )
    select 1 from public.praktika_helper_jobs j where j.job_type='upload_report_to_praktika'
      and j.request->>'reportDraftId'=p_draft_id::text and not exists(select 1 from lineage l where l.id=j.id)
  ) then return jsonb_build_object('ok',false,'code','existing_attempt'); end if;
  audit := jsonb_build_object('verifiedAbsent',true,'actorUserId',p_actor_user_id,
    'authorizedAt',t,'priorJobId',p_prior_job_id,'uploadJobId',replacement_id);
  -- Waiting is not runnable by the upload worker. The ordinary continuation
  -- verifies/prepares the approved PDF before transitioning this new job to pending.
  -- The winning authorizer owns this new execution; historical actors remain unchanged.
  insert into public.praktika_helper_jobs(id,app_user_id,job_type,status,priority,request,available_at)
    values(replacement_id,p_actor_user_id,'upload_report_to_praktika','waiting',20,
      prior.request || jsonb_build_object('manualRetry',audit),t);
  update public.praktika_helper_jobs set status='waiting', locked_at=null,locked_by=null,
    failed_at=null,error_message=null,updated_at=t,available_at=t,
    response=jsonb_build_object('stage','upload','retryUploadId',replacement_id,'retryExecutionUserId',p_actor_user_id)
    where id=parent_id;
  update public.report_drafts set workflow_status='running',workflow_praktika_upload_status='waiting_for_authentication',
    workflow_completed_at=null,workflow_error=null,
    workflow_last_message='Praktika retry authorized. Continuing in background.',updated_at=t where id=p_draft_id;
  return jsonb_build_object('ok',true,'reconciled',false,'intentId',parent_id,'uploadJobId',replacement_id,'uploadStatus','waiting','workflowStatus','running');
end $$;
revoke all on function public.reserve_praktika_upload_retry(uuid,uuid,uuid) from public,anon,authenticated;
grant execute on function public.reserve_praktika_upload_retry(uuid,uuid,uuid) to service_role;
commit;
