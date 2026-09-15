-- Operator verification only. No external calls, new jobs, or historical backfill.
begin;
create function public.verify_workflow_completion(p_draft_id uuid, p_integration text,
  p_prior_job_id uuid, p_actor_user_id uuid, p_verified_success boolean default false)
returns jsonb language plpgsql security invoker set search_path = public, pg_temp as $$
declare d public.report_drafts%rowtype; parent public.praktika_helper_jobs%rowtype;
  prior_id uuid; prior_attempt integer; current_id text; audit jsonb; verifications jsonb;
  parent_id uuid := md5('praktika-complete-workflow:v1:' || p_draft_id::text)::uuid;
  t timestamptz; message text; next_stage text; next_status text; upload_done boolean; mediref_done boolean; icon_done boolean;
begin
  select * into d from public.report_drafts where id=p_draft_id for update;
  if not found or p_actor_user_id is null or p_integration is null or p_integration not in ('praktika','mediref')
    then return jsonb_build_object('ok',false,'code','not_eligible'); end if;
  if (select count(*) from public.user_status where user_id=p_actor_user_id) <> 1
    or not exists(select 1 from public.user_status where user_id=p_actor_user_id and is_active is true)
    or (select count(*) from public.user_roles where user_id=p_actor_user_id) <> 1
    or not exists(select 1 from public.user_roles where user_id=p_actor_user_id and role::text in ('admin','super_admin','practice_manager','typist'))
    or not exists(select 1 from public.providers where id=d.provider_id and is_active is true)
    then return jsonb_build_object('ok',false,'code','not_authorized'); end if;
  select * into parent from public.praktika_helper_jobs where id=parent_id for update;
  if not found or parent.job_type <> 'complete_report_workflow' or parent.app_user_id is null
    or parent.request->>'reportDraftId' is distinct from p_draft_id::text
    or parent.request->>'actorUserId' is distinct from parent.app_user_id::text
    or d.deleted_at is not null or d.status not in ('approved','uploaded_to_praktika')
    then return jsonb_build_object('ok',false,'code','not_eligible'); end if;
  verifications := coalesce(parent.response->'manualVerification','{}'::jsonb);
  audit := verifications->p_integration;
  if audit is not null then
    if audit->>'action' <> 'manually_verified_completed' or audit->>'verifiedSuccess' <> 'true'
      or (p_prior_job_id is not null and audit->>'priorJobId' is distinct from p_prior_job_id::text)
      then return jsonb_build_object('ok',false,'code','not_current_attempt'); end if;
    return jsonb_build_object('ok',true,'eligible',false,'reconciled',true,'verification',audit,'workflowStatus',d.workflow_status);
  end if;
  -- Never race a dispatched continuation or an already claimed MediRef retry.
  if parent.status not in ('failed','waiting') or parent.locked_by is not null
    then return jsonb_build_object('ok',false,'code','active_work'); end if;
  if p_integration='praktika' then
    perform 1 from public.praktika_helper_jobs where job_type='upload_report_to_praktika'
      and request->>'reportDraftId'=p_draft_id::text order by id for update;
    current_id := parent.response->>'retryUploadId';
    if current_id is null then
      if (select count(*) from public.praktika_helper_jobs where job_type='upload_report_to_praktika' and request->>'reportDraftId'=p_draft_id::text) <> 1
        then return jsonb_build_object('ok',false,'code','not_current_attempt'); end if;
      select id::text into current_id from public.praktika_helper_jobs where job_type='upload_report_to_praktika' and request->>'reportDraftId'=p_draft_id::text;
    end if;
    select id,attempts into prior_id,prior_attempt from public.praktika_helper_jobs
      where id::text=current_id and job_type='upload_report_to_praktika' and status='failed'
      and request->>'reportDraftId'=p_draft_id::text and request->>'continuationId'=parent_id::text;
    if not found or coalesce(d.uploaded_to_praktika,false) or d.workflow_praktika_upload_status='completed'
      or exists(select 1 from public.praktika_helper_jobs where job_type='upload_report_to_praktika' and request->>'reportDraftId'=p_draft_id::text and status <> 'failed')
      then return jsonb_build_object('ok',false,'code','not_eligible'); end if;
  else
    if d.workflow_mediref_status is distinct from 'failed' then return jsonb_build_object('ok',false,'code','not_eligible'); end if;
    perform 1 from public.mediref_helper_jobs where job_type='send_mediref_letter' and payload->>'draftId'=p_draft_id::text order by id for update;
    if exists(select 1 from public.mediref_helper_jobs where job_type='send_mediref_letter' and payload->>'draftId'=p_draft_id::text and status <> 'failed')
      then return jsonb_build_object('ok',false,'code','active_work'); end if;
    select id,attempts into prior_id,prior_attempt from public.mediref_helper_jobs
      where job_type='send_mediref_letter' and status='failed' and payload->>'draftId'=p_draft_id::text
      and (payload->>'workflowContinuationId' is null or payload->>'workflowContinuationId'=parent_id::text)
      order by created_at desc,id desc limit 1;
    if not found then return jsonb_build_object('ok',false,'code','not_eligible'); end if;
  end if;
  if p_prior_job_id is not null and p_prior_job_id <> prior_id then return jsonb_build_object('ok',false,'code','not_current_attempt'); end if;
  if not coalesce(p_verified_success,false) then return jsonb_build_object('ok',true,'eligible',true,'priorJobId',prior_id); end if;
  if p_prior_job_id is null then return jsonb_build_object('ok',false,'code','confirmation_required'); end if;
  t := clock_timestamp();
  audit := jsonb_build_object('integration',p_integration,'action','manually_verified_completed',
    'actorUserId',p_actor_user_id,'verifiedAt',t,'priorJobId',prior_id,'attempt',prior_attempt,
    'draftId',p_draft_id,'intentId',parent_id,'verifiedSuccess',true);
  verifications := verifications || jsonb_build_object(p_integration,audit);
  upload_done := p_integration='praktika' or d.workflow_praktika_upload_status='completed';
  mediref_done := p_integration='mediref' or d.workflow_mediref_status in ('completed','skipped','not_requested');
  icon_done := d.workflow_icon_update_status in ('completed','skipped','not_requested');
  next_stage := case when not coalesce(upload_done,false) then 'upload' when not coalesce(icon_done,false) then 'icon' else 'mediref' end;
  message := case
    when not coalesce(upload_done,false) and exists(select 1 from public.praktika_helper_jobs where job_type='upload_report_to_praktika' and request->>'reportDraftId'=p_draft_id::text and status='failed') then 'Praktika upload needs verification.'
    when not coalesce(mediref_done,false) and (d.workflow_mediref_status='failed' or exists(select 1 from public.mediref_helper_jobs where job_type='send_mediref_letter' and payload->>'draftId'=p_draft_id::text and status='failed')) then 'MediRef needs verification.'
    when not coalesce(icon_done,false) and (d.workflow_icon_update_status='failed' or exists(select 1 from public.praktika_helper_jobs where job_type='update_praktika_letter_icons' and request->>'reportDraftId'=p_draft_id::text and status='failed')) then 'Praktika icon update needs verification.'
    when d.workflow_periodontal_chart_status in ('failed','error','pending','running','waiting_for_authentication','waiting_for_periodontal') then 'Periodontal chart needs attention.'
    else null end;
  next_status := case when message is not null then 'failed' when coalesce(upload_done and mediref_done and icon_done,false) then 'completed' else 'waiting' end;
  update public.praktika_helper_jobs set status=next_status,
    response=(coalesce(parent.response,'{}'::jsonb)-'dispatched'-'issue') || jsonb_build_object('stage',next_stage,'manualVerification',verifications),
    updated_at=t,available_at=case when next_status='waiting' then t else available_at end
    where id=parent_id;
  update public.report_drafts set
    uploaded_to_praktika=case when p_integration='praktika' then true else uploaded_to_praktika end,
    workflow_praktika_upload_status=case when p_integration='praktika' then 'completed' else workflow_praktika_upload_status end,
    workflow_mediref_status=case when p_integration='mediref' then 'completed' else workflow_mediref_status end,
    workflow_status=case when next_status='waiting' then 'running' else next_status end,
    workflow_completed_at=case when next_status='completed' then t else null end,
    workflow_error=message,workflow_last_message=coalesce(message,case when next_status='completed' then 'All required workflow steps completed.' else 'External completion manually verified. Remaining steps will continue automatically.' end),updated_at=t
    where id=p_draft_id;
  return jsonb_build_object('ok',true,'eligible',false,'reconciled',false,'verification',audit,'workflowStatus',case when next_status='waiting' then 'running' else next_status end);
end $$;
revoke all on function public.verify_workflow_completion(uuid,text,uuid,uuid,boolean) from public,anon,authenticated;
grant execute on function public.verify_workflow_completion(uuid,text,uuid,uuid,boolean) to service_role;

-- Share the draft lock with manual completion; retain other branch verification.
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
  if parent.response#>>'{manualVerification,praktika,action}' = 'manually_verified_completed'
    and parent.response#>>'{manualVerification,praktika,verifiedSuccess}' = 'true' then
    return jsonb_build_object('ok',true,'reconciled',true,'manuallyVerified',true,'workflowStatus',d.workflow_status);
  end if;
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
    response=(coalesce(parent.response,'{}'::jsonb)-'dispatched'-'issue') || jsonb_build_object('stage','upload','retryUploadId',replacement_id,'retryExecutionUserId',p_actor_user_id)
    where id=parent_id;
  update public.report_drafts set workflow_status='running',workflow_praktika_upload_status='waiting_for_authentication',
    workflow_completed_at=null,workflow_error=null,
    workflow_last_message='Praktika retry authorized. Continuing in background.',updated_at=t where id=p_draft_id;
  return jsonb_build_object('ok',true,'reconciled',false,'intentId',parent_id,'uploadJobId',replacement_id,'uploadStatus','waiting','workflowStatus','running');
end $$;
revoke all on function public.reserve_praktika_upload_retry(uuid,uuid,uuid) from public,anon,authenticated;
grant execute on function public.reserve_praktika_upload_retry(uuid,uuid,uuid) to service_role;
commit;
