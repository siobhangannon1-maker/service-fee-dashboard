-- New Complete Workflow intents only. No historical backfill or external actions.
-- The existing helper primary key enforces one deterministic intent per draft.
begin;
create function public.reserve_praktika_workflow(
  p_draft_id uuid, p_actor_user_id uuid, p_options jsonb
) returns jsonb
language plpgsql security invoker set search_path = public, pg_temp as $$
declare
  d public.report_drafts%rowtype;
  j public.praktika_helper_jobs%rowtype;
  intent_id uuid := md5('praktika-complete-workflow:v1:' || p_draft_id::text)::uuid;
  intent_request jsonb;
  t timestamptz := clock_timestamp();
begin
  if p_actor_user_id is null or p_draft_id is null
    or jsonb_typeof(p_options) is distinct from 'object' then
    return jsonb_build_object('ok', false, 'code', 'invalid_request');
  end if;
  -- Actor authorization is performed by the server before invoking this service-only RPC.
  -- Neither created_by nor provider_id is an authentication identity here.
  select * into d from public.report_drafts where id = p_draft_id for update;
  if not found or d.deleted_at is not null
    or d.status not in ('approved', 'uploaded_to_praktika') then
    return jsonb_build_object('ok', false, 'code', 'ineligible_draft');
  end if;
  intent_request := jsonb_build_object('version', 1, 'reportDraftId', p_draft_id,
    'actorUserId', p_actor_user_id, 'options', p_options);
  select * into j from public.praktika_helper_jobs where id = intent_id for update;
  if found then
    if j.job_type is distinct from 'complete_report_workflow'
      or j.app_user_id is distinct from p_actor_user_id
      or (j.request - 'options') is distinct from (intent_request - 'options')
      or ((j.request->'options') - 'actor' - 'authorization')
        is distinct from (p_options - 'actor' - 'authorization') then
      return jsonb_build_object('ok', false, 'code', 'intent_conflict');
    end if;
    -- Keep the original signed actor snapshot: profile metadata changes do not
    -- turn a repeated request by the same actor into a new execution.
    -- Reconciliation returns the existing intent, including paused/uncertain work.
    -- It never resets a stage, unlocks a job, or creates another upload.
    return jsonb_build_object('ok', true, 'intentId', j.id, 'reconciled', true,
      'intentStatus', j.status, 'workflowStatus', d.workflow_status,
      'uploadStatus', d.workflow_praktika_upload_status);
  end if;
  -- Include every upload status: failed/processing/completed outcomes cannot be replayed.
  if coalesce(d.uploaded_to_praktika, false)
    or exists (select 1 from public.praktika_helper_jobs
      where job_type = 'upload_report_to_praktika'
        and request->>'reportDraftId' = p_draft_id::text) then
    return jsonb_build_object('ok', false, 'code', 'existing_attempt');
  end if;
  if d.workflow_status = 'running' or d.workflow_praktika_upload_status = 'running'
    or d.workflow_icon_update_status = 'running' then
    return jsonb_build_object('ok', false, 'code', 'existing_workflow');
  end if;
  insert into public.praktika_helper_jobs
    (id, app_user_id, job_type, status, priority, request, response, available_at)
    values (intent_id, p_actor_user_id, 'complete_report_workflow', 'waiting', 20,
      intent_request, jsonb_build_object('stage', 'upload'), t);
  update public.report_drafts set workflow_status = 'running', workflow_started_at = t,
    workflow_completed_at = null, workflow_error = null,
    workflow_praktika_upload_status = 'waiting_for_authentication',
    workflow_icon_update_status = 'pending', workflow_mediref_status = 'pending',
    workflow_periodontal_chart_status = case when p_options->>'attachPeriodontalChart' = 'true'
      then 'pending' else 'not_requested' end,
    workflow_last_message = 'Workflow queued — waiting for Praktika verification.',
    updated_at = t where id = p_draft_id;
  return jsonb_build_object('ok', true, 'intentId', intent_id, 'reconciled', false,
    'intentStatus', 'waiting', 'workflowStatus', 'running',
    'uploadStatus', 'waiting_for_authentication');
end $$;
revoke all on function public.reserve_praktika_workflow(uuid,uuid,jsonb) from public, anon, authenticated;
grant execute on function public.reserve_praktika_workflow(uuid,uuid,jsonb) to service_role;
commit;
