-- Local review candidate only. No backfill, new tables, columns, or external actions.
begin;
create function public.mediref_approved_letter_fingerprint(d public.report_drafts)
returns text language sql stable security invoker set search_path = public, pg_temp set timezone = 'UTC' as $$
  select encode(sha256(convert_to(jsonb_build_object('draftId',d.id,'approvedAt',d.provider_approved_at,
    'reportType',d.report_type,'letter',coalesce(nullif(d.edited_text,''),nullif(d.ai_generated_text,''),d.source_text),
    'provider',d.provider_id,'patient',d.patient_name,'dob',d.patient_dob,'referrer',d.referrer_name)::text,'UTF8')),'hex');
$$;
revoke all on function public.mediref_approved_letter_fingerprint(public.report_drafts) from public,anon,authenticated;
grant execute on function public.mediref_approved_letter_fingerprint(public.report_drafts) to service_role;

-- All send-job writes share the acknowledgement's draft-first mutex. A fresh
-- READ COMMITTED snapshot after waiting sees the committed permanent marker.
-- row_security=off does NOT bypass RLS: an RLS-filtered lookup raises an error.
create function public.fence_manual_mediref_execution() returns trigger
language plpgsql security invoker set search_path = public, pg_temp set row_security = off as $$
declare old_draft text; new_draft text; candidate text; response jsonb;
begin
  if tg_op <> 'INSERT' and old.job_type='send_mediref_letter' then old_draft:=old.payload->>'draftId'; end if;
  if tg_op <> 'DELETE' and new.job_type='send_mediref_letter' then
    new_draft:=new.payload->>'draftId';
    if new_draft is null then raise exception using errcode='P0001',message='invalid_mediref_draft'; end if;
  end if;
  for candidate in select distinct x from unnest(array[old_draft,new_draft]) x where x is not null order by x loop
    if current_setting('transaction_isolation') <> 'read committed' then
      raise exception using errcode='P0001',message='mediref_execution_isolation_unsupported';
    end if;
    if candidate !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
      raise exception using errcode='P0001',message='invalid_mediref_draft';
    end if;
    perform 1 from public.report_drafts where id=candidate::uuid for update;
    if not found then raise exception using errcode='P0001',message='invalid_mediref_draft'; end if;
    select j.response into response from public.praktika_helper_jobs j
      where id=md5('praktika-complete-workflow:v1:' || candidate::uuid::text)::uuid;
    if response#>>'{manualVerification,mediref,source}'='manually_sent'
      and response#>>'{manualVerification,mediref,recoveryClass}'='no_prior_helper_job_v1' then
      raise exception using errcode='P0001',message='manually_acknowledged';
    end if;
  end loop;
  if tg_op='DELETE' then return old; end if; return new;
end $$;
revoke all on function public.fence_manual_mediref_execution() from public,anon,authenticated;
create trigger manual_mediref_execution_fence before insert or update or delete on public.mediref_helper_jobs
for each row execute function public.fence_manual_mediref_execution();

-- Preparation and retry claims already update the draft. They therefore share
-- its row lock, and cannot clear the completed branch/reopen a preparation claim.
create function public.fence_manual_mediref_draft_claim() returns trigger
language plpgsql security invoker set search_path = public, pg_temp set row_security = off as $$
declare response jsonb;
begin
  -- Unrelated letter edits retain the fence without requiring privileged lookups.
  if new.workflow_mediref_status is not distinct from old.workflow_mediref_status
    and new.emailed_to_referrer_resend_id is not distinct from old.emailed_to_referrer_resend_id
    and new.id=old.id then return new; end if;
  select j.response into response from public.praktika_helper_jobs j
    where id=md5('praktika-complete-workflow:v1:' || old.id::text)::uuid;
  if response#>>'{manualVerification,mediref,source}'='manually_sent'
    and response#>>'{manualVerification,mediref,recoveryClass}'='no_prior_helper_job_v1'
    and (new.id <> old.id or new.workflow_mediref_status is distinct from 'completed'
      or (new.emailed_to_referrer_resend_id is distinct from old.emailed_to_referrer_resend_id and new.emailed_to_referrer_resend_id is not null)) then
    raise exception using errcode='P0001',message='manually_acknowledged';
  end if;
  return new;
end $$;
revoke all on function public.fence_manual_mediref_draft_claim() from public,anon,authenticated;
create trigger manual_mediref_draft_claim_fence before update on public.report_drafts
for each row execute function public.fence_manual_mediref_draft_claim();

create function public.protect_manual_mediref_acknowledgement() returns trigger
language plpgsql security invoker set search_path = public, pg_temp set row_security = off as $$
declare entry jsonb;
begin
  if tg_op='TRUNCATE' then
    if exists(select 1 from public.praktika_helper_jobs where response#>>'{manualVerification,mediref,source}'='manually_sent'
      and response#>>'{manualVerification,mediref,recoveryClass}'='no_prior_helper_job_v1') then
      raise exception using errcode='P0001',message='manual_mediref_acknowledgement_is_permanent';
    end if;
    return null;
  end if;
  entry:=old.response#>'{manualVerification,mediref}';
  if entry->>'source'='manually_sent' and entry->>'recoveryClass'='no_prior_helper_job_v1' then
    if tg_op='DELETE' then raise exception using errcode='P0001',message='manual_mediref_acknowledgement_is_permanent'; end if;
    if new.response#>'{manualVerification,mediref}' is distinct from entry or new.id <> old.id
      or new.job_type is distinct from old.job_type
      or new.request->>'reportDraftId' is distinct from old.request->>'reportDraftId' then
      raise exception using errcode='P0001',message='manual_mediref_acknowledgement_is_permanent';
    end if;
  end if;
  if tg_op='DELETE' then return old; end if;
  return new;
end $$;
revoke all on function public.protect_manual_mediref_acknowledgement() from public,anon,authenticated;
create trigger manual_mediref_marker_protection before update or delete on public.praktika_helper_jobs
for each row execute function public.protect_manual_mediref_acknowledgement();
create trigger manual_mediref_marker_truncate_protection before truncate on public.praktika_helper_jobs
for each statement execute function public.protect_manual_mediref_acknowledgement();

-- Replace the signature (no ambiguous PostgREST overload); five-argument callers
-- retain their defaulted legacy behaviour. Only service_role may call this RPC.
drop function public.verify_workflow_completion(uuid,text,uuid,uuid,boolean);
create function public.verify_workflow_completion(p_draft_id uuid, p_integration text,
  p_prior_job_id uuid, p_actor_user_id uuid, p_verified_success boolean default false, p_expected_state text default null)
returns jsonb language plpgsql security invoker set search_path = public, pg_temp set timezone = 'UTC' as $$
declare d public.report_drafts%rowtype; parent public.praktika_helper_jobs%rowtype;
  prior_id uuid; prior_attempt integer; current_id text; audit jsonb; verifications jsonb;
  parent_id uuid := md5('praktika-complete-workflow:v1:' || p_draft_id::text)::uuid;
  no_job boolean := false; upload_id uuid; icon_id uuid; proof jsonb; fingerprint text; letter_fingerprint text;
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
  if not found then return jsonb_build_object('ok',false,'code','historical_review_required'); end if;
  if parent.job_type is distinct from 'complete_report_workflow' or parent.app_user_id is null
    or parent.request->>'reportDraftId' is distinct from p_draft_id::text
    or parent.request->>'actorUserId' is distinct from parent.app_user_id::text
    or d.deleted_at is not null or coalesce(d.status,'') not in ('approved','uploaded_to_praktika')
    then return jsonb_build_object('ok',false,'code','not_eligible'); end if;
  verifications := coalesce(parent.response->'manualVerification','{}'::jsonb);
  audit := verifications->p_integration;
  if audit is not null then
    if audit->>'source'='manually_sent' and audit->>'recoveryClass'='no_prior_helper_job_v1' then
      if p_integration <> 'mediref' or (coalesce(p_verified_success,false) and
        (p_prior_job_id is not null or p_expected_state is distinct from audit->>'previewFingerprint'
          or public.mediref_approved_letter_fingerprint(d) is distinct from audit->>'letterFingerprint')) then
        return jsonb_build_object('ok',false,'code','state_changed');
      end if;
      return jsonb_build_object('ok',true,'eligible',false,'reconciled',true,'verification',audit,'workflowStatus',d.workflow_status);
    end if;
    if audit->>'action' <> 'manually_verified_completed' or audit->>'verifiedSuccess' <> 'true'
      or (p_prior_job_id is not null and audit->>'priorJobId' is distinct from p_prior_job_id::text)
      then return jsonb_build_object('ok',false,'code','not_current_attempt'); end if;
    return jsonb_build_object('ok',true,'eligible',false,'reconciled',true,'verification',audit,'workflowStatus',d.workflow_status);
  end if;
  -- Never race a dispatched continuation or an already claimed MediRef retry.
  if coalesce(parent.status,'') not in ('failed','waiting') or parent.locked_by is not null
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
    perform 1 from public.mediref_helper_jobs where job_type='send_mediref_letter' and lower(payload->>'draftId')=p_draft_id::text order by id for update;
    if exists(select 1 from public.mediref_helper_jobs where job_type='send_mediref_letter' and lower(payload->>'draftId')=p_draft_id::text and status <> 'failed')
      then return jsonb_build_object('ok',false,'code','active_work'); end if;
    select id,attempts into prior_id,prior_attempt from public.mediref_helper_jobs
      where job_type='send_mediref_letter' and status='failed' and lower(payload->>'draftId')=p_draft_id::text
      and (payload->>'workflowContinuationId' is null or payload->>'workflowContinuationId'=parent_id::text)
      order by created_at desc,id desc limit 1;
    if not found then
      -- The supported recovery class has ZERO attempts, including incompatible or
      -- terminal ones. Absence alone never supplies execution-safety evidence.
      if exists(select 1 from public.mediref_helper_jobs where job_type='send_mediref_letter' and lower(payload->>'draftId')=p_draft_id::text)
        then return jsonb_build_object('ok',false,'code','not_eligible'); end if;
      if current_setting('transaction_isolation') <> 'read committed'
        then return jsonb_build_object('ok',false,'code','uncertain_execution'); end if;
      if parent.status is distinct from 'failed' or parent.locked_at is not null or parent.locked_by is not null
        or d.workflow_status is distinct from 'failed' or parent.response->>'dispatched'='true'
        or parent.response->>'retryUploadId' is not null
        or exists(select 1 from public.praktika_helper_jobs where job_type='complete_report_workflow'
          and lower(request->>'reportDraftId')=p_draft_id::text and id <> parent_id)
        then return jsonb_build_object('ok',false,'code','active_work'); end if;
      if d.emailed_to_referrer_resend_id is not null or d.emailed_to_referrer_at is not null
        or parent.response->>'issue' is not null
        then return jsonb_build_object('ok',false,'code','uncertain_execution'); end if;
      proof:=parent.response->'medirefPreparationFailure';
      if proof->>'contract' is distinct from 'mediref-no-job-failure-v1'
        or proof->>'insertionOutcome' is distinct from 'not_attempted'
        or proof->>'externalExecution' is distinct from 'not_started'
        or proof->'deadlineExceeded' is distinct from 'false'::jsonb
        or proof->>'stage' is null or proof->>'stage' not in
          ('patient_validation','pdf_generation','pdf_validation','storage_upload','storage_verification','attachment_validation')
        or proof->>'code' is distinct from ('MEDIREF_' || upper(proof->>'stage') || '_FAILED')
        or parent.failed_at is null or coalesce(parent.response->>'stage','') not in ('upload','icon','mediref')
        or parent.request#>>'{options,actor,actorUserId}' is distinct from parent.app_user_id::text
        or d.workflow_last_message is distinct from 'MediRef preparation needs reconciliation. No replacement job was created.'
        or nullif(btrim(coalesce(nullif(d.edited_text,''),nullif(d.ai_generated_text,''),d.source_text)), '') is null
        then return jsonb_build_object('ok',false,'code','missing_safe_evidence'); end if;
      -- Any retained result/send audit contradicts the narrow no-execution class.
      if parent.response->>'retryExecutionUserId' is not null
        or exists(select 1 from jsonb_object_keys(coalesce(parent.response,'{}'::jsonb)) k
          where k not in ('stage','manualVerification','medirefPreparationFailure','dispatched','issue','retryUploadId','retryExecutionUserId'))
        or exists(select 1 from public.report_writing_audit_events where entity_type='report_draft'
          and entity_id=p_draft_id::text and action='Queued MediRef send')
        then return jsonb_build_object('ok',false,'code','uncertain_execution'); end if;
      perform 1 from public.praktika_helper_jobs where lower(request->>'reportDraftId')=p_draft_id::text
        and id <> parent_id order by id for update;
      no_job:=true;
      letter_fingerprint:=public.mediref_approved_letter_fingerprint(d);
      -- Opaque snapshot digest: no letter text or patient identity leaves the DB.
      fingerprint:=encode(sha256(convert_to(jsonb_build_object('draft',to_jsonb(d),'parent',to_jsonb(parent),
        'children',(select coalesce(jsonb_agg(to_jsonb(j) order by j.id),'[]'::jsonb) from public.praktika_helper_jobs j
          where lower(j.request->>'reportDraftId')=p_draft_id::text and j.id <> parent_id))::text,'UTF8')),'hex');
      if not coalesce(p_verified_success,false) then
        return jsonb_build_object('ok',true,'eligible',true,'recoveryClass','no_prior_helper_job_v1',
          'priorJobId',null,'currentStateToken',fingerprint);
      end if;
      if p_prior_job_id is not null or p_expected_state is distinct from fingerprint
        then return jsonb_build_object('ok',false,'code','state_changed'); end if;
    end if;
  end if;
  if no_job then
    t:=clock_timestamp();
    audit:=jsonb_build_object('integration','mediref','action','manually_verified_completed',
      'source','manually_sent','recoveryClass','no_prior_helper_job_v1',
      'reason','operator_confirmed_exact_approved_letter_sent','actorUserId',p_actor_user_id,'verifiedAt',t,
      'priorJobId',null,'attempt',0,'draftId',p_draft_id,'intentId',parent_id,'verifiedSuccess',true,
      'letterFingerprint',letter_fingerprint,'previewFingerprint',fingerprint,
      'originalFailure',jsonb_build_object('category','mediref_preparation_not_attempted','parentFailedAt',parent.failed_at,'preparation',proof));
    verifications:=verifications || jsonb_build_object('mediref',audit);
    -- Preserve the other branches exactly. Parent completion is conservative;
    -- read-side resolver still independently requires all authoritative evidence.
    upload_id:=substr(encode(sha256(convert_to('praktika-continuation-child:v1','UTF8') || decode('00','hex') ||
      convert_to(parent_id::text,'UTF8') || decode('00','hex') || convert_to('upload_report_to_praktika','UTF8')),'hex'),1,32)::uuid;
    icon_id:=substr(encode(sha256(convert_to('praktika-continuation-child:v1','UTF8') || decode('00','hex') ||
      convert_to(parent_id::text,'UTF8') || decode('00','hex') || convert_to('update_praktika_letter_icons','UTF8')),'hex'),1,32)::uuid;
    upload_done:=d.workflow_praktika_upload_status='completed' and coalesce(d.uploaded_to_praktika,false)
      and exists(select 1 from public.praktika_helper_jobs where id=upload_id and job_type='upload_report_to_praktika'
        and status='completed' and app_user_id=parent.app_user_id and request->>'reportDraftId'=p_draft_id::text and request->>'continuationId'=parent_id::text
        and coalesce(response#>>'{patient_communication,iFileId}','') ~ '^[0-9]*[1-9][0-9]*$'
        and response->>'error' is null and response->>'errors' is null and response->>'success' is distinct from 'false');
    icon_done:=d.workflow_icon_update_status in ('skipped','not_requested') or
      (d.workflow_icon_update_status='completed' and exists(select 1 from public.praktika_helper_jobs where id=icon_id and job_type='update_praktika_letter_icons'
        and status='completed' and app_user_id=parent.app_user_id and request->>'reportDraftId'=p_draft_id::text and request->>'continuationId'=parent_id::text
        and coalesce(response,'{}'::jsonb) <> '{}'::jsonb and response->>'error' is null
        and response->>'success' is distinct from 'false' and response->>'empty' is distinct from 'true'));
    next_status:=case when coalesce(upload_done and icon_done,false)
      and d.workflow_periodontal_chart_status in ('skipped','not_requested')
      and parent.request#>>'{options,attachPeriodontalChart}'='false' and d.periodontal_chart_attachment_error is null
      and not exists(select 1 from public.praktika_helper_jobs where job_type='upload_report_to_praktika'
        and lower(request->>'reportDraftId')=p_draft_id::text and id <> upload_id and status is distinct from 'failed')
      then 'completed' else 'failed' end;
    update public.praktika_helper_jobs set status=next_status,
      response=coalesce(parent.response,'{}'::jsonb) || jsonb_build_object('manualVerification',verifications),
      completed_at=case when next_status='completed' then t else completed_at end,updated_at=t where id=parent_id;
    update public.report_drafts set workflow_mediref_status='completed',workflow_status=next_status,
      workflow_completed_at=case when next_status='completed' then t else null end,
      workflow_last_message=case when next_status='completed' then 'All required workflow steps completed.'
        else 'MediRef manually acknowledged as sent. Remaining workflow steps need attention.' end,updated_at=t where id=p_draft_id;
    -- Automated failure/error fields and emailed_to_referrer_at remain untouched.
    return jsonb_build_object('ok',true,'eligible',false,'reconciled',false,'verification',audit,'workflowStatus',next_status);
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
    when not coalesce(mediref_done,false) and (d.workflow_mediref_status='failed' or exists(select 1 from public.mediref_helper_jobs where job_type='send_mediref_letter' and lower(payload->>'draftId')=p_draft_id::text and status='failed')) then 'MediRef needs verification.'
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
revoke all on function public.verify_workflow_completion(uuid,text,uuid,uuid,boolean,text) from public,anon,authenticated;
grant execute on function public.verify_workflow_completion(uuid,text,uuid,uuid,boolean,text) to service_role;
commit;
