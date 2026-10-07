-- Additive production-shape correction. No row updates/backfill or lock cleanup.
-- Quiesce -> establish outstanding outcomes -> migrations -> updated workers -> web.
begin;
create function public.workflow_resolution_icon_success(r jsonb,q jsonb default null)
returns boolean language plpgsql immutable security invoker set search_path=public,pg_temp as $$
declare k text; b jsonb;
begin
 if jsonb_typeof(r) is distinct from 'object' or r ? 'error' or r ? 'errors' or r->'success'='false'::jsonb or r->'empty'='true'::jsonb then return false; end if;
 foreach k in array array['appointment_icon1id','appointment_icon2id','appointment_icon3id','appointment_icon4id'] loop
  if jsonb_typeof(r->k) not in ('number','string') or coalesce(r->>k,'') !~ '^(0|[1-9][0-9]*)$' or (r->>k)::numeric>9007199254740991 then return false; end if;
 end loop;
 if not ('6597' in(r->>'appointment_icon1id',r->>'appointment_icon2id',r->>'appointment_icon3id',r->>'appointment_icon4id')) then return false; end if;
 if q is null then return true; end if;
 if q->>'method' is distinct from 'POST' or q->>'path' is distinct from '/php/forms/db_commitFormData.php' or q->>'contentType' is distinct from 'json'
  or jsonb_typeof(q->'body') is distinct from 'array' then return false; end if;
 if jsonb_array_length(q->'body')<>1 then return false; end if;
 b:=q#>'{body,0}';
 if jsonb_typeof(b) is distinct from 'object' or coalesce(b->>'appointment_id','') !~ '^[1-9][0-9]*$' or coalesce(b->>'practice_id','') !~ '^[1-9][0-9]*$' then return false; end if;
 if (b->>'practice_id')::numeric>9007199254740991 or (b->>'appointment_id')::numeric>9007199254740991 then return false; end if;
 foreach k in array array['appointment_icon1id','appointment_icon2id','appointment_icon3id','appointment_icon4id'] loop
  if jsonb_typeof(b->k) not in ('number','string') or coalesce(b->>k,'') !~ '^(0|[1-9][0-9]*)$' or (b->>k)::numeric<>(r->>k)::numeric then return false; end if;
 end loop;
 return true;
end $$;

-- Exact committed read-only request allowlist. Read results never prove attachment.
create function public.workflow_resolution_periodontal_read(j jsonb)
returns boolean language plpgsql immutable security invoker set search_path=public,pg_temp as $$
declare q jsonb:=j->'request'; b jsonb; p jsonb; fields jsonb; idkey text;
begin
 if j->>'job_type' is null or j->>'job_type' not in ('periodontal_chart_patient_perio_exam_ids','periodontal_chart_perio_exams') then return false; end if;
 if q->>'method' is distinct from 'POST' or q->>'path' is distinct from '/php/forms/db_getFormData.php' or q->>'contentType' is distinct from 'json' or jsonb_typeof(q->'body') is distinct from 'array' then return false; end if;
 if jsonb_array_length(q->'body')<>1 then return false; end if;
 b:=q#>'{body,0}';
 if jsonb_typeof(b) is distinct from 'object' or exists(select 1 from jsonb_object_keys(b) k where k not in ('fields','parameters')) then return false; end if;
 if j->>'job_type'='periodontal_chart_patient_perio_exam_ids' then fields:='["patient_perioexamids","patient_medicalhistory","patient_images"]';idkey:='patient_id';
 else fields:='["perioexam_id","perioexam_patientid","perioexam_providerid","perioexam_date","perioexam_notes","perioexam_diagnosis","perioexam_boneloss","perioexam_systemicfactors","perioexam_toothdata"]';idkey:='perioexam_id';end if;
 if jsonb_typeof(b->'fields') is distinct from 'array' or jsonb_typeof(b->'parameters') is distinct from 'array' then return false; end if;
 if jsonb_array_length(b->'fields')<>jsonb_array_length(fields) or not (b->'fields' @> fields) or jsonb_array_length(b->'parameters') not between 1 and 1000 or (idkey='patient_id' and jsonb_array_length(b->'parameters')<>1) then return false; end if;
 for p in select value from jsonb_array_elements(b->'parameters') loop
  if jsonb_typeof(p) is distinct from 'object' then return false; end if;
  if (select count(*) from jsonb_object_keys(p))<>2 or coalesce(p->>'practice_id','') !~ '^[1-9][0-9]*$' or coalesce(p->>idkey,'') !~ '^[1-9][0-9]*$' or (p->>'practice_id')::numeric>9007199254740991 or (p->>idkey)::numeric>9007199254740991 then return false; end if;
 end loop;
 return true;
end $$;

-- Reuse the installed Manual MediRef Recovery's exact retained audit check.
create function public.mediref_has_queued_send_audit(p_draft_id uuid)
returns boolean language sql stable security invoker set search_path=public,pg_temp set row_security=off as $$
 select exists(select 1 from public.report_writing_audit_events where entity_type='report_draft' and entity_id=p_draft_id::text and action='Queued MediRef send');
$$;
create or replace function public.workflow_resolution_legacy_execution_safe(j jsonb)
returns boolean language plpgsql immutable security invoker set search_path=public,pg_temp as $$
declare r jsonb:=coalesce(j->'response',j->'result','{}'); f jsonb; kind text:=j->>'job_type';
begin
 -- Status/result are evaluated before retained terminal locks. Uncertainty wins.
 -- A validated read request cannot mutate externally, but active reads still block.
 if public.workflow_resolution_execution_conflict(r) then return false; end if;
 if public.workflow_resolution_periodontal_read(j) then
   return coalesce(j->>'status' in ('completed','failed'),false);
 end if;
 if j->>'status'='completed' then
   if kind='upload_report_to_praktika' then
     return coalesce(r#>>'{patient_communication,iFileId}','') ~ '^[1-9][0-9]*$'
       and not (r ? 'error' or r ? 'errors') and r->'success' is distinct from 'false'::jsonb;
   elsif kind='update_praktika_letter_icons' then
     return public.workflow_resolution_icon_success(r,j->'request');
   elsif kind='send_mediref_letter' then
     if nullif(j->>'locked_by','') is not null or nullif(j->>'locked_at','') is not null then return false; end if;
     return coalesce((r->'sent'='true'::jsonb or (r->'prepared'='true'::jsonb and r->'sent'='false'::jsonb))
       and not (r ? 'error' or r ? 'errors') and r->'success' is distinct from 'false'::jsonb,false);
   end if;
   if kind='complete_report_workflow' then
     if nullif(j->>'locked_by','') is not null or nullif(j->>'locked_at','') is not null then return false; end if;
     return coalesce(r->>'stage'='mediref' or
       (r#>>'{manualWorkflowCompletion,contract}'='workflow-resolution-v1'
        and r#>>'{manualWorkflowCompletion,source}' in ('operator_manual_completion','controlled_resume')),false);
   end if;
   -- Unknown legacy kinds never establish safe external execution.
   return false;
 end if;
 if nullif(j->>'locked_by','') is not null or nullif(j->>'locked_at','') is not null then return false; end if;
 if j->>'status' is distinct from 'failed' then return false; end if;
 if kind='upload_report_to_praktika' then
   f:=r->'uploadFailure';
   return coalesce(jsonb_typeof(f)='object' and f->'requestInvoked'='false'::jsonb
     and f->>'stage' in ('preparation','pre_dispatch'),false);
 elsif kind='complete_report_workflow' then
   f:=r->'medirefPreparationFailure';
   return coalesce(f->>'contract'='mediref-no-job-failure-v1'
     and f->>'insertionOutcome'='not_attempted' and f->>'externalExecution'='not_started'
     and f->'deadlineExceeded'='false'::jsonb
     and f->>'stage' in ('patient_validation','pdf_generation','pdf_validation','storage_upload','storage_verification','attachment_validation')
     and f->>'code'='MEDIREF_' || upper(f->>'stage') || '_FAILED',false);
 end if;
 -- Legacy icon/MediRef failures have no durable pre-execution contract.
 return false;
end $$;

-- Target association never uses a patient name, age of claim, or global unscoped set.
create function public.workflow_resolution_job_associated(j jsonb,p_draft_id uuid)
returns boolean language plpgsql stable security invoker set search_path=public,pg_temp set row_security=off as $$
declare q jsonb:=j->'request'; d public.report_drafts%rowtype; parent_id uuid:=md5('praktika-complete-workflow:v1:' || p_draft_id::text)::uuid; child_id uuid; endtime timestamptz;
begin
 if lower(q->>'reportDraftId')=p_draft_id::text or q->>'continuationId'=parent_id::text or j->>'id'=parent_id::text then return true; end if;
 if j->>'job_type'='upload_report_to_praktika' and split_part(q#>>'{body,file,path}','/',1)='report-uploads' and split_part(q#>>'{body,file,path}','/',3)=p_draft_id::text then return true; end if;
 if j->>'job_type' is distinct from 'update_praktika_letter_icons' or q->>'reportDraftId' is not null or q->>'continuationId' is not null then return false; end if;
 child_id:=substr(encode(sha256(convert_to('praktika-continuation-child:v1','UTF8') || decode('00','hex') || convert_to(parent_id::text,'UTF8') || decode('00','hex') || convert_to('update_praktika_letter_icons','UTF8')),'hex'),1,32)::uuid;
 if j->>'id'=child_id::text and exists(select 1 from praktika_helper_jobs p where p.id=parent_id and p.request->>'reportDraftId'=p_draft_id::text) then return true; end if;
 select * into d from report_drafts where id=p_draft_id;
 if not found or d.praktika_letter_icon_appointment_id is null or d.praktika_letter_icon_updated_at is null or d.praktika_letter_icon_update_response_preview is null then return false; end if;
 -- Legacy identity: exact appointment + saved result + completion window + upload actor.
 -- The same saved receipt must not also match another letter.
 if q#>>'{body,0,appointment_id}' is distinct from d.praktika_letter_icon_appointment_id or j->>'status' is distinct from 'completed' then return false; end if;
 begin
  if d.praktika_letter_icon_update_response_preview::jsonb is distinct from j->'response' then return false; end if;
  endtime:=coalesce(nullif(j->>'completed_at',''),nullif(j->>'updated_at',''))::timestamptz;
 exception when invalid_text_representation or invalid_datetime_format or datetime_field_overflow then return false; end;
 if endtime is null or endtime>d.praktika_letter_icon_updated_at or d.praktika_letter_icon_updated_at-endtime>interval '60 seconds' then return false; end if;
 if exists(select 1 from report_drafts other where other.id<>d.id and other.praktika_letter_icon_appointment_id=d.praktika_letter_icon_appointment_id and case when pg_input_is_valid(other.praktika_letter_icon_update_response_preview,'jsonb') then other.praktika_letter_icon_update_response_preview::jsonb else null end=j->'response' and other.praktika_letter_icon_updated_at between endtime and endtime+interval '60 seconds') then return false; end if;
 return exists(select 1 from praktika_helper_jobs u where u.job_type='upload_report_to_praktika' and u.status='completed' and u.app_user_id::text=j->>'app_user_id' and nullif(j->>'app_user_id','') is not null
   and (lower(u.request->>'reportDraftId')=p_draft_id::text or split_part(u.request#>>'{body,file,path}','/',3)=p_draft_id::text)
   and public.workflow_resolution_legacy_execution_safe(to_jsonb(u)));
end $$;

create function public.workflow_resolution_mediref_audit_safe(p_draft_id uuid)
returns boolean language sql stable security invoker set search_path=public,pg_temp set row_security=off as $$
 -- Every retained queue event must bind its jobId to a settled same-draft helper.
 select not public.mediref_has_queued_send_audit(p_draft_id) or not exists(
  select 1 from report_writing_audit_events a where a.entity_type='report_draft' and a.entity_id=p_draft_id::text and a.action='Queued MediRef send'
   and not exists(select 1 from mediref_helper_jobs j where j.id::text=a.details->>'jobId' and lower(j.payload->>'draftId')=p_draft_id::text and j.status='completed' and public.workflow_resolution_legacy_execution_safe(to_jsonb(j))));
$$;

create function public.workflow_resolution_job_target_consistent(j jsonb,p_draft_id uuid)
returns boolean language sql stable security invoker set search_path=public,pg_temp set row_security=off as $$
 select (j#>>'{request,reportDraftId}' is null or lower(j#>>'{request,reportDraftId}')=p_draft_id::text)
  and (j#>>'{request,continuationId}' is null or j#>>'{request,continuationId}'=md5('praktika-complete-workflow:v1:' || p_draft_id::text)::uuid::text)
  and (j#>>'{payload,draftId}' is null or lower(j#>>'{payload,draftId}')=p_draft_id::text)
  and (j#>>'{payload,workflowContinuationId}' is null or j#>>'{payload,workflowContinuationId}'=md5('praktika-complete-workflow:v1:' || p_draft_id::text)::uuid::text)
  and (j->>'job_type'<>'upload_report_to_praktika' or j#>>'{request,body,file,path}' is null or split_part(j#>>'{request,body,file,path}','/',3)=p_draft_id::text);
$$;
revoke all on function public.workflow_resolution_job_target_consistent(jsonb,uuid) from public,anon,authenticated;
grant execute on function public.workflow_resolution_job_target_consistent(jsonb,uuid) to service_role;

create or replace function public.workflow_resolution_legacy_draft_safe(p_draft_id uuid)
returns boolean language sql stable security invoker set search_path=public,pg_temp set row_security=off as $$
 select (
   exists(select 1 from praktika_helper_jobs where id=md5('praktika-complete-workflow:v1:' || p_draft_id::text)::uuid)
   or exists(select 1 from report_drafts d where d.id=p_draft_id
     and exists(select 1 from praktika_helper_jobs j where j.job_type='upload_report_to_praktika'
       and (lower(j.request->>'reportDraftId')=d.id::text or j.request#>>'{body,file,path}' like '%/' || d.id::text || '/%')
       and j.status='completed' and public.workflow_resolution_legacy_execution_safe(to_jsonb(j)))
     and (d.workflow_icon_update_status in ('skipped','not_requested') or exists(select 1 from praktika_helper_jobs j
       where j.job_type='update_praktika_letter_icons' and public.workflow_resolution_job_associated(to_jsonb(j),d.id)
       and j.status='completed' and public.workflow_resolution_legacy_execution_safe(to_jsonb(j))))
     and (d.workflow_mediref_status in ('skipped','not_requested') or exists(select 1 from mediref_helper_jobs j
       where lower(j.payload->>'draftId')=d.id::text and j.status='completed' and public.workflow_resolution_legacy_execution_safe(to_jsonb(j)))))
 ) and public.workflow_resolution_mediref_audit_safe(p_draft_id)
 and not exists(select 1 from praktika_helper_jobs j where public.workflow_resolution_job_associated(to_jsonb(j),p_draft_id) and (public.workflow_resolution_job_target_consistent(to_jsonb(j),p_draft_id) is distinct from true or public.workflow_resolution_legacy_execution_safe(to_jsonb(j)) is distinct from true
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
  perform 1 from praktika_helper_jobs where public.workflow_resolution_job_associated(to_jsonb(praktika_helper_jobs),p_draft_id) order by id for update;
  perform 1 from mediref_helper_jobs where lower(payload->>'draftId')=p_draft_id::text or payload->>'workflowContinuationId'=parent.id::text order by id for update;
  select coalesce(jsonb_agg(to_jsonb(j) order by j.id),'[]') into pj from praktika_helper_jobs j where public.workflow_resolution_job_associated(to_jsonb(j),p_draft_id);
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
create or replace function public.verify_workflow_completion(p_draft_id uuid, p_integration text,
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
        or public.mediref_has_queued_send_audit(p_draft_id)
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
create or replace function public.workflow_resolution_job_fence() returns trigger
language plpgsql security invoker set search_path=public,pg_temp set row_security=off as $$
declare old_id text; new_id text; draft_id text; branch text; r jsonb; prior jsonb; permit uuid;
begin
 if tg_table_name='praktika_helper_jobs' then
   if tg_op <> 'INSERT' then old_id:=old.request->>'reportDraftId'; end if;
   if tg_op <> 'DELETE' then new_id:=new.request->>'reportDraftId'; r:=to_jsonb(new); end if;
 else
   if tg_op <> 'INSERT' then old_id:=old.payload->>'draftId'; end if;
   if tg_op <> 'DELETE' then new_id:=new.payload->>'draftId'; r:=to_jsonb(new); end if;
 end if;
 if tg_table_name='praktika_helper_jobs' then
  if tg_op<>'INSERT' and old_id is null then
   select request->>'reportDraftId' into old_id from praktika_helper_jobs where id::text=old.request->>'continuationId';
   if old_id is null and old.job_type='upload_report_to_praktika' then old_id:=nullif(split_part(old.request#>>'{body,file,path}','/',3),''); end if;
  end if;
  if tg_op<>'DELETE' and new_id is null then
   select request->>'reportDraftId' into new_id from praktika_helper_jobs where id::text=new.request->>'continuationId';
   if new_id is null and new.job_type='upload_report_to_praktika' then new_id:=nullif(split_part(new.request#>>'{body,file,path}','/',3),''); end if;
  end if;
 end if;
 if tg_op <> 'INSERT' then prior:=to_jsonb(old); end if;
 if tg_table_name='praktika_helper_jobs' then
  if tg_op<>'INSERT' and old_id is null and old.job_type='update_praktika_letter_icons' then
   select id::text into old_id from report_drafts d where public.workflow_resolution_job_associated(to_jsonb(old),d.id) order by id limit 1;
  end if;
  if tg_op<>'DELETE' and new_id is null and new.job_type='update_praktika_letter_icons' then
   select id::text into new_id from report_drafts d where public.workflow_resolution_job_associated(to_jsonb(new),d.id) order by id limit 1;
  end if;
 end if;
 if tg_table_name='praktika_helper_jobs' then
   if tg_op='UPDATE' and old.response->'manualWorkflowCompletion' is not null and new.response->'manualWorkflowCompletion' is distinct from old.response->'manualWorkflowCompletion' then raise exception 'resolution_evidence_is_permanent'; end if;
 end if;
 for draft_id in select distinct lower(x) from unnest(array[old_id,new_id]) x where x is not null order by lower(x) loop
   if draft_id !~ '^[a-f0-9]{8}(-[a-f0-9]{4}){3}-[a-f0-9]{12}$' then raise exception 'resolution_invalid_draft_identity'; end if;
   if current_setting('transaction_isolation') <> 'read committed' then raise exception 'resolution_isolation_unsupported'; end if;
   perform 1 from report_drafts where id=draft_id::uuid for update;
   if not found then raise exception 'resolution_invalid_draft_identity'; end if;
   branch:=case coalesce(r->>'job_type',prior->>'job_type') when 'upload_report_to_praktika' then 'praktika' when 'update_praktika_letter_icons' then 'icon'
     when 'send_mediref_letter' then 'mediref' when 'complete_report_workflow' then 'workflow' else 'periodontal' end;
   if tg_op='DELETE' and exists(select 1 from report_writing_audit_events where entity_id=draft_id and details->>'contract'='workflow-resolution-v1') then raise exception 'resolution_evidence_is_permanent'; end if;
   if tg_op='UPDATE' and (old_id is distinct from new_id or new.id<>old.id or new.job_type<>old.job_type) then
     if exists(select 1 from report_writing_audit_events where entity_id=draft_id and details->>'contract'='workflow-resolution-v1') then raise exception 'resolution_evidence_is_permanent'; end if;
   end if;
   if tg_table_name='praktika_helper_jobs' and public.workflow_resolution_periodontal_read(coalesce(r,prior)) then continue; end if;
   if tg_op<>'DELETE' and branch<>'workflow' and (tg_op='INSERT' or r->>'status' in ('pending','waiting','processing','running'))
     and exists(select 1 from report_writing_audit_events where entity_id=draft_id and action='workflow_resolution_verification' and details->>'branch'=branch and details->>'outcome'='incomplete') then
     if not exists(select 1 from praktika_helper_jobs p join report_writing_audit_events a on a.id::text=p.response#>>'{resolution,eventId}'
       where p.id=md5('praktika-complete-workflow:v1:' || draft_id)::uuid and a.action='workflow_resolution_resume' and a.details->'plan' ? branch
       and coalesce(r#>>'{request,resolutionEventId}',r#>>'{payload,resolutionEventId}')=a.id::text) then raise exception 'resolution_attempt_not_authorized'; end if;
     if tg_op='INSERT' and branch='mediref' and exists(select 1 from mediref_helper_jobs where lower(payload->>'draftId')=draft_id) then raise exception 'resolution_existing_attempt'; end if;
   end if;
   if tg_op<>'DELETE' and public.workflow_resolution_fenced(draft_id::uuid,branch) then
     -- Accept closure's terminal parent update only; all new/revived work is fenced.
     if not (tg_op='UPDATE' and branch='workflow' and new.status='completed' and prior->>'status' in ('failed','completed','processing')
       and new.request=old.request and new.id=old.id) then raise exception 'resolution_branch_completed'; end if;
   end if;
   if tg_op<>'DELETE' and r->>'status' in ('processing','running') and (tg_op='INSERT' or prior->>'status' not in ('processing','running') or r->>'locked_by' is distinct from prior->>'locked_by') then
     permit:=gen_random_uuid();
     insert into report_writing_audit_events(id,entity_type,entity_id,action,details) values(permit,'report_draft',draft_id,'workflow_resolution_execution',
       jsonb_build_object('contract','workflow-resolution-v1','version',1,'draftId',draft_id,'permitId',permit,'jobId',r->>'id','branch',branch,'owner',r->>'locked_by'));
   end if;
 end loop;
 if tg_op='DELETE' then return old; end if; return new;
end $$;
revoke all on function public.workflow_resolution_icon_success(jsonb,jsonb) from public,anon,authenticated;
grant execute on function public.workflow_resolution_icon_success(jsonb,jsonb) to service_role;
revoke all on function public.workflow_resolution_periodontal_read(jsonb) from public,anon,authenticated;
grant execute on function public.workflow_resolution_periodontal_read(jsonb) to service_role;
revoke all on function public.mediref_has_queued_send_audit(uuid) from public,anon,authenticated;
grant execute on function public.mediref_has_queued_send_audit(uuid) to service_role;
revoke all on function public.workflow_resolution_job_associated(jsonb,uuid) from public,anon,authenticated;
grant execute on function public.workflow_resolution_job_associated(jsonb,uuid) to service_role;
revoke all on function public.workflow_resolution_mediref_audit_safe(uuid) from public,anon,authenticated;
grant execute on function public.workflow_resolution_mediref_audit_safe(uuid) to service_role;
create or replace function public.workflow_resolution_audit_fence() returns trigger
language plpgsql security invoker set search_path=public,pg_temp set row_security=off as $$
begin
 if tg_op='TRUNCATE' then
   if exists(select 1 from report_writing_audit_events where details->>'contract'='workflow-resolution-v1') then raise exception 'resolution_evidence_is_permanent'; end if;
   return null;
 end if;
 if tg_op<>'INSERT' and old.action='Queued MediRef send' and old.entity_type='report_draft' then
  perform 1 from report_drafts where id=old.entity_id::uuid for update;
  if exists(select 1 from report_writing_audit_events where entity_id=old.entity_id and details->>'contract'='workflow-resolution-v1') then raise exception 'resolution_evidence_is_permanent'; end if;
 end if;
 if tg_op<>'INSERT' and old.details->>'contract'='workflow-resolution-v1' then raise exception 'resolution_evidence_is_permanent'; end if;
 if tg_op='INSERT' and new.action='Queued MediRef send' and new.entity_type='report_draft' then
  perform 1 from report_drafts where id=new.entity_id::uuid for update;
  if public.workflow_resolution_fenced(new.entity_id::uuid,'mediref') then raise exception 'resolution_branch_completed'; end if;
 end if;
 if tg_op='INSERT' and new.action like 'workflow_resolution_%' then
   if new.details->>'contract' is distinct from 'workflow-resolution-v1' or new.details->>'draftId' is distinct from new.entity_id
     or new.entity_type<>'report_draft' then raise exception 'resolution_invalid_evidence'; end if;
   if current_user not in ('service_role','postgres') then raise exception 'resolution_not_authorized'; end if;
   perform 1 from report_drafts where id=new.entity_id::uuid for update;
 end if;
 if tg_op='DELETE' then return old; end if; return new;
end $$;
commit;
