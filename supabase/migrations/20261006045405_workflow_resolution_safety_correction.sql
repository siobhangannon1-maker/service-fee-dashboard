-- Additive correction; prior migration is intentionally unchanged. No backfill.
begin;
-- Contradictory diagnostics always win over a claimed pre-execution failure.
create function public.workflow_resolution_execution_conflict(v jsonb)
returns boolean language sql immutable security invoker set search_path=public,pg_temp as $$
 with recursive nodes(value) as (
   select v
   union all
   select child.value from nodes n cross join lateral (
     select value from jsonb_each(case when jsonb_typeof(n.value)='object' then n.value else '{}'::jsonb end)
     union all
     select value from jsonb_array_elements(case when jsonb_typeof(n.value)='array' then n.value else '[]'::jsonb end)
   ) child
 )
 select exists(select 1 from nodes where jsonb_typeof(value)='object' and (
   (value ? 'requestInvoked' and value->'requestInvoked' is distinct from 'false'::jsonb)
   or (value ? 'externalExecution' and value->>'externalExecution' is distinct from 'not_started')
   or (value ? 'deadlineExceeded' and value->'deadlineExceeded' is distinct from 'false'::jsonb)
   or value->'dispatched'='true'::jsonb
   or value->>'insertionOutcome' in ('attempted','unconfirmed')
 ));
$$;
create function public.workflow_resolution_legacy_execution_safe(j jsonb)
returns boolean language plpgsql immutable security invoker set search_path=public,pg_temp as $$
declare r jsonb:=coalesce(j->'response',j->'result','{}'); f jsonb; kind text:=j->>'job_type';
begin
 if nullif(j->>'locked_by','') is not null or nullif(j->>'locked_at','') is not null
   or public.workflow_resolution_execution_conflict(r) then return false; end if;
 if j->>'status'='completed' then
   if kind='upload_report_to_praktika' then
     return coalesce(r#>>'{patient_communication,iFileId}','') ~ '^[1-9][0-9]*$'
       and not (r ? 'error' or r ? 'errors') and r->'success' is distinct from 'false'::jsonb;
   elsif kind='update_praktika_letter_icons' then
     return coalesce((r->'saved'='true'::jsonb or r->'appointment_icon_saved'='true'::jsonb)
       and not (r ? 'error' or r ? 'errors') and r->'success' is distinct from 'false'::jsonb,false);
   elsif kind='send_mediref_letter' then
     return coalesce((r->'sent'='true'::jsonb or (r->'prepared'='true'::jsonb and r->'sent'='false'::jsonb))
       and not (r ? 'error' or r ? 'errors') and r->'success' is distinct from 'false'::jsonb,false);
   end if;
   if kind='complete_report_workflow' then
     return coalesce(r->>'stage'='mediref' or
       (r#>>'{manualWorkflowCompletion,contract}'='workflow-resolution-v1'
        and r#>>'{manualWorkflowCompletion,source}' in ('operator_manual_completion','controlled_resume')),false);
   end if;
   -- Unknown legacy kinds never establish safe external execution.
   return false;
 end if;
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
revoke all on function public.workflow_resolution_execution_conflict(jsonb) from public,anon,authenticated;
revoke all on function public.workflow_resolution_legacy_execution_safe(jsonb) from public,anon,authenticated;
grant execute on function public.workflow_resolution_execution_conflict(jsonb) to service_role;
grant execute on function public.workflow_resolution_legacy_execution_safe(jsonb) to service_role;

-- The read-only Queue projection and locked confirmation use the same legacy gate.
create function public.workflow_resolution_legacy_draft_safe(p_draft_id uuid)
returns boolean language sql stable security invoker set search_path=public,pg_temp set row_security=off as $$
 select (
   exists(select 1 from praktika_helper_jobs where id=md5('praktika-complete-workflow:v1:' || p_draft_id::text)::uuid)
   or exists(select 1 from report_drafts d where d.id=p_draft_id
     and exists(select 1 from praktika_helper_jobs j where j.job_type='upload_report_to_praktika'
       and (lower(j.request->>'reportDraftId')=d.id::text or j.request#>>'{body,file,path}' like '%/' || d.id::text || '/%')
       and j.status='completed' and public.workflow_resolution_legacy_execution_safe(to_jsonb(j)))
     and (d.workflow_icon_update_status in ('skipped','not_requested') or exists(select 1 from praktika_helper_jobs j
       where j.job_type='update_praktika_letter_icons' and lower(j.request->>'reportDraftId')=d.id::text
       and j.status='completed' and public.workflow_resolution_legacy_execution_safe(to_jsonb(j))))
     and (d.workflow_mediref_status in ('skipped','not_requested') or exists(select 1 from mediref_helper_jobs j
       where lower(j.payload->>'draftId')=d.id::text and j.status='completed' and public.workflow_resolution_legacy_execution_safe(to_jsonb(j)))))
 ) and not exists(select 1 from praktika_helper_jobs j where (
   j.id=md5('praktika-complete-workflow:v1:' || p_draft_id::text)::uuid
   or lower(j.request->>'reportDraftId')=p_draft_id::text
   or j.request->>'continuationId'=md5('praktika-complete-workflow:v1:' || p_draft_id::text)::uuid::text
   or (j.job_type='upload_report_to_praktika' and j.request#>>'{body,file,path}' like '%/' || p_draft_id::text || '/%')
   or (j.job_type='update_praktika_letter_icons' and j.request->>'reportDraftId' is null and j.request->>'continuationId' is null)
 ) and (public.workflow_resolution_legacy_execution_safe(to_jsonb(j)) is distinct from true
   or (j.job_type='complete_report_workflow' and (j.id<>md5('praktika-complete-workflow:v1:' || p_draft_id::text)::uuid
     or j.request->>'reportDraftId' is distinct from p_draft_id::text or j.app_user_id is null
     or j.request->>'actorUserId' is distinct from j.app_user_id::text))))
 and not exists(select 1 from mediref_helper_jobs j where (lower(j.payload->>'draftId')=p_draft_id::text
   or j.payload->>'workflowContinuationId'=md5('praktika-complete-workflow:v1:' || p_draft_id::text)::uuid::text)
   and public.workflow_resolution_legacy_execution_safe(to_jsonb(j)) is distinct from true);
$$;
revoke all on function public.workflow_resolution_legacy_draft_safe(uuid) from public,anon,authenticated;
grant execute on function public.workflow_resolution_legacy_draft_safe(uuid) to service_role;

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
  perform 1 from praktika_helper_jobs where lower(request->>'reportDraftId')=p_draft_id::text or request->>'continuationId'=parent.id::text or (job_type='upload_report_to_praktika' and request#>>'{body,file,path}' like '%/' || p_draft_id::text || '/%') order by id for update;
  perform 1 from mediref_helper_jobs where lower(payload->>'draftId')=p_draft_id::text or payload->>'workflowContinuationId'=parent.id::text order by id for update;
  select coalesce(jsonb_agg(to_jsonb(j) order by j.id),'[]') into pj from praktika_helper_jobs j where lower(request->>'reportDraftId')=p_draft_id::text or request->>'continuationId'=parent.id::text or (job_type='upload_report_to_praktika' and request#>>'{body,file,path}' like '%/' || p_draft_id::text || '/%');
  select coalesce(jsonb_agg(to_jsonb(j) order by j.id),'[]') into mj from mediref_helper_jobs j where lower(payload->>'draftId')=p_draft_id::text or payload->>'workflowContinuationId'=parent.id::text;
  select coalesce(jsonb_agg(to_jsonb(a) order by a.created_at,a.id),'[]') into events from report_writing_audit_events a where entity_type='report_draft' and entity_id=p_draft_id::text;
  safe := not exists(select 1 from jsonb_array_elements(pj || mj) j where coalesce(j->>'status','') not in ('completed','failed') or nullif(j->>'locked_by','') is not null or nullif(j->>'locked_at','') is not null);
  if parent.id is not null and (parent.job_type is distinct from 'complete_report_workflow' or parent.request->>'reportDraftId' is distinct from p_draft_id::text
      or parent.app_user_id is null or parent.request->>'actorUserId' is distinct from parent.app_user_id::text
      or parent.status not in ('failed','completed') or parent.locked_at is not null or parent.locked_by is not null or parent.response->>'dispatched'='true') then safe:=false; end if;
  if exists(select 1 from jsonb_array_elements(pj) j where j->>'job_type'='complete_report_workflow' and j->>'id' is distinct from parent.id::text) then safe:=false; end if;
  if exists(select 1 from praktika_helper_jobs where job_type='update_praktika_letter_icons' and request->>'reportDraftId' is null and request->>'continuationId' is null and (status is distinct from 'completed' or public.workflow_resolution_legacy_execution_safe(to_jsonb(praktika_helper_jobs)) is distinct from true)) then safe:=false; end if;
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

create or replace function public.confirm_workflow_resolution(p_draft_id uuid,p_actor_user_id uuid,p_expected_fingerprint text,p_letter_fingerprint text,
 p_outcomes jsonb,p_required jsonb,p_action text,p_plan jsonb,p_options jsonb default null,p_completed jsonb default '[]')
returns jsonb language plpgsql security invoker set search_path=public,pg_temp set row_security=off set timezone='UTC' as $$
declare s jsonb; b text; outcome text; event_id uuid; closure_id uuid; parent_id uuid:=md5('praktika-complete-workflow:v1:' || p_draft_id::text)::uuid; parent public.praktika_helper_jobs%rowtype; t timestamptz:=clock_timestamp(); original jsonb;
begin
 s:=public.workflow_resolution_snapshot(p_draft_id,p_actor_user_id);
 if s->>'letterFingerprint' is distinct from p_letter_fingerprint then return jsonb_build_object('ok',false,'code','state_changed'); end if;
 if exists(select 1 from report_writing_audit_events where entity_id=p_draft_id::text and action='workflow_resolution_completed'
   and details->>'letterFingerprint'=p_letter_fingerprint and details->>'previewFingerprint'=p_expected_fingerprint) then return jsonb_build_object('ok',true,'reconciled',true); end if;
 if s->>'fingerprint' is distinct from p_expected_fingerprint or s->>'executionSafe' is distinct from 'true' then return jsonb_build_object('ok',false,'code','state_changed'); end if;
 if p_action not in ('save','complete','resume') or jsonb_typeof(p_outcomes)<>'object' or jsonb_typeof(p_required)<>'array' or jsonb_typeof(p_plan)<>'array' then raise exception 'resolution_invalid_request'; end if;
 select * into parent from praktika_helper_jobs where id=parent_id;
 -- Deliberately bounded provenance. Original records remain intact at source.
 original:=jsonb_build_object('contract','workflow-resolution-provenance-v1','parentId',parent.id,
   'parentStatus',case when parent.status in ('failed','completed') then parent.status else null end,
   'parentFailedAt',parent.failed_at,'failureRecorded',parent.error_message is not null,
   'workflowFailureRecorded',s#>>'{draft,workflow_error}' is not null);
 for b,outcome in select key,value from jsonb_each_text(p_outcomes) loop
   if b not in ('praktika','icon','mediref','periodontal') or outcome not in ('completed','incomplete') or not (p_required ? b) then raise exception 'resolution_invalid_branch'; end if;
   if public.workflow_resolution_fenced(p_draft_id,b) then raise exception 'resolution_branch_completed'; end if;
   event_id:=gen_random_uuid();
   insert into report_writing_audit_events(id,entity_type,entity_id,action,details) values(event_id,'report_draft',p_draft_id::text,'workflow_resolution_verification',
    jsonb_build_object('contract','workflow-resolution-v1','version',1,'draftId',p_draft_id,'eventId',event_id,'letterFingerprint',p_letter_fingerprint,
      'previewFingerprint',p_expected_fingerprint,'branch',b,'outcome',outcome,'source','human_external_verification','actorUserId',p_actor_user_id,
      'actorRole',(select role::text from user_roles where user_id=p_actor_user_id),'verifiedAt',t));
 end loop;
 if p_action='complete' then
   if exists(select 1 from jsonb_each_text(p_outcomes) where value<>'completed') or jsonb_array_length(p_plan)<>0 then raise exception 'resolution_incomplete_work'; end if;
   closure_id:=gen_random_uuid();
   insert into report_writing_audit_events(id,entity_type,entity_id,action,details) values(closure_id,'report_draft',p_draft_id::text,'workflow_resolution_completed',
     jsonb_build_object('contract','workflow-resolution-v1','version',1,'draftId',p_draft_id,'eventId',closure_id,'letterFingerprint',p_letter_fingerprint,
       'previewFingerprint',p_expected_fingerprint,'actorUserId',p_actor_user_id,'completedAt',t,'required',p_required,'outcomes',p_outcomes,'originalFailure',original,'source','operator_manual_completion'));
   if parent.id is not null then
     update praktika_helper_jobs set status='completed',completed_at=t,response=coalesce(response,'{}') || jsonb_build_object('manualWorkflowCompletion',
       jsonb_build_object('contract','workflow-resolution-v1','eventId',closure_id,'letterFingerprint',p_letter_fingerprint,'source','operator_manual_completion')) where id=parent_id;
   end if;
   update report_drafts set workflow_status='completed',workflow_last_message='Workflow completed by operator verification.',updated_at=t where id=p_draft_id;
 elsif p_action='resume' then
   if jsonb_array_length(p_plan)=0 or p_options is null then raise exception 'resolution_invalid_plan'; end if;
   for b in select jsonb_array_elements_text(p_plan) loop
     if p_outcomes->>b is distinct from 'incomplete' or public.workflow_resolution_fenced(p_draft_id,b) then raise exception 'resolution_invalid_plan'; end if;
   end loop;
   for b in select jsonb_array_elements_text(p_completed) loop
     insert into report_writing_audit_events(entity_type,entity_id,action,details) values('report_draft',p_draft_id::text,'workflow_resolution_branch_fence',jsonb_build_object('contract','workflow-resolution-v1','version',1,'draftId',p_draft_id,'branch',b,'source','retained_automated_evidence','letterFingerprint',p_letter_fingerprint,'previewFingerprint',p_expected_fingerprint));
   end loop;
   event_id:=gen_random_uuid();
   insert into report_writing_audit_events(id,entity_type,entity_id,action,details) values(event_id,'report_draft',p_draft_id::text,'workflow_resolution_resume',
     jsonb_build_object('contract','workflow-resolution-v1','version',1,'draftId',p_draft_id,'eventId',event_id,'letterFingerprint',p_letter_fingerprint,
       'previewFingerprint',p_expected_fingerprint,'actorUserId',p_actor_user_id,'plan',p_plan,'required',p_required,'completedBranches',p_completed,'originalFailure',original,'resumedAt',t));
   if parent.id is null then
     insert into praktika_helper_jobs(id,app_user_id,job_type,status,priority,request,response,available_at) values(parent_id,p_actor_user_id,'complete_report_workflow','waiting',20,
       jsonb_build_object('version',1,'reportDraftId',p_draft_id,'actorUserId',p_actor_user_id,'options',p_options),
       jsonb_build_object('stage','upload','resolution',jsonb_build_object('eventId',event_id,'plan',p_plan,'letterFingerprint',p_letter_fingerprint)),t);
   else
     if parent.status<>'failed' or parent.locked_by is not null or parent.locked_at is not null then raise exception 'resolution_active'; end if;
     update praktika_helper_jobs set status='waiting',locked_by=null,locked_at=null,available_at=t,updated_at=t,
       response=coalesce(response,'{}') || jsonb_build_object('stage','upload','dispatched',false,'resolution',jsonb_build_object('eventId',event_id,'plan',p_plan,'letterFingerprint',p_letter_fingerprint)) where id=parent_id;
   end if;
   update report_drafts set workflow_status='running',workflow_last_message='Verified incomplete workflow steps queued for controlled resumption.',
     workflow_praktika_upload_status=case when p_plan ? 'praktika' then 'waiting_for_authentication' else workflow_praktika_upload_status end,
     workflow_icon_update_status=case when p_plan ? 'icon' then 'pending' else workflow_icon_update_status end,
     workflow_mediref_status=case when p_plan ? 'mediref' then 'pending' else workflow_mediref_status end,updated_at=t where id=p_draft_id;
 end if;
 return jsonb_build_object('ok',true,'action',p_action,'eventId',coalesce(closure_id,event_id));
end $$;
create or replace function public.workflow_resolution_projection(p_draft_ids uuid[])
returns table(id uuid,"draftId" uuid,"letterFingerprint" text,events jsonb,"executionSafe" boolean)
language sql stable security invoker set search_path=public,pg_temp set row_security=off as $$
 select d.id,d.id,public.workflow_resolution_letter_fingerprint(d),
 (select coalesce(jsonb_agg(jsonb_build_object('id',a.id,'action',a.action,'details',a.details) order by a.created_at,a.id),'[]') from report_writing_audit_events a where a.entity_id=d.id::text and a.entity_type='report_draft' and a.details->>'contract'='workflow-resolution-v1'),
 not exists(select 1 from report_writing_audit_events a where a.entity_id=d.id::text and a.action='workflow_resolution_execution' and not exists(select 1 from report_writing_audit_events b where b.action='workflow_resolution_settled' and b.details->>'permitId'=a.id::text))
 and public.workflow_resolution_legacy_draft_safe(d.id)
 and coalesce(d.emailed_to_referrer_resend_id,'') not like 'mediref:preparing:%'
 from report_drafts d where d.id=any(p_draft_ids);
$$;

create or replace function public.complete_resolved_workflow(p_draft_id uuid,p_parent_id uuid,p_owner text)
returns jsonb language plpgsql security invoker set search_path=public,pg_temp set row_security=off as $$
declare p public.praktika_helper_jobs%rowtype; e public.report_writing_audit_events%rowtype; branch text; j jsonb; child uuid; closure_id uuid:=gen_random_uuid(); t timestamptz:=clock_timestamp();
begin
 perform 1 from report_drafts where id=p_draft_id for update;
 select * into p from praktika_helper_jobs where id=p_parent_id and request->>'reportDraftId'=p_draft_id::text and job_type='complete_report_workflow' and status='processing' and locked_by=p_owner for update;
 if not found then raise exception 'resolution_parent_changed'; end if;
 select * into e from report_writing_audit_events where id=(p.response#>>'{resolution,eventId}')::uuid and entity_id=p_draft_id::text and action='workflow_resolution_resume';
 if not found then raise exception 'resolution_plan_changed'; end if;
 for branch in select jsonb_array_elements_text(e.details->'plan') loop
   if branch='mediref' then
     select to_jsonb(x) into j from mediref_helper_jobs x where payload->>'draftId'=p_draft_id::text and payload->>'workflowContinuationId'=p_parent_id::text;
     if j->>'status' is distinct from 'completed' or j#>>'{result,prepared}' is distinct from 'true' or j#>>'{result,error}' is not null then raise exception 'resolution_helper_unconfirmed'; end if;
   else
     child:=substr(encode(sha256(convert_to('praktika-continuation-child:v1','UTF8') || decode('00','hex') || convert_to(p_parent_id::text,'UTF8') || decode('00','hex') || convert_to(case branch when 'praktika' then 'upload_report_to_praktika' else 'update_praktika_letter_icons' end,'UTF8')),'hex'),1,32)::uuid;
     select to_jsonb(x) into j from praktika_helper_jobs x where id=child and request->>'reportDraftId'=p_draft_id::text and request->>'continuationId'=p_parent_id::text and app_user_id=p.app_user_id;
     if j->>'status' is distinct from 'completed' or j#>>'{response,error}' is not null or j#>>'{response,success}'='false' then raise exception 'resolution_helper_unconfirmed'; end if;
     if branch='praktika' and coalesce(j#>>'{response,patient_communication,iFileId}','') !~ '^[0-9]*[1-9][0-9]*$' then raise exception 'resolution_helper_unconfirmed'; end if;
     if branch='icon' and (coalesce(j->'response','{}')='{}'::jsonb or j#>>'{response,empty}'='true') then raise exception 'resolution_helper_unconfirmed'; end if;
   end if;
  if public.workflow_resolution_legacy_execution_safe(j) is distinct from true then raise exception 'resolution_helper_unconfirmed'; end if;
 end loop;
 if exists(select 1 from praktika_helper_jobs where lower(request->>'reportDraftId')=p_draft_id::text and id<>p_parent_id and status not in ('completed','failed'))
   or exists(select 1 from mediref_helper_jobs where lower(payload->>'draftId')=p_draft_id::text and status not in ('completed','failed')) then raise exception 'resolution_active'; end if;
 if exists(select 1 from report_writing_audit_events a where a.entity_id=p_draft_id::text and a.action='workflow_resolution_execution' and (a.details->>'jobId'=p_parent_id::text and a.details->>'owner'=p_owner) is not true and not exists(select 1 from report_writing_audit_events b where b.action='workflow_resolution_settled' and b.details->>'permitId'=a.id::text)) then raise exception 'resolution_execution_uncertain'; end if;
 insert into report_writing_audit_events(id,entity_type,entity_id,action,details) values(closure_id,'report_draft',p_draft_id::text,'workflow_resolution_completed',
  jsonb_build_object('contract','workflow-resolution-v1','version',1,'draftId',p_draft_id,'eventId',closure_id,'source','controlled_resume','actorUserId',e.details->>'actorUserId',
    'letterFingerprint',e.details->>'letterFingerprint','previewFingerprint',e.details->>'previewFingerprint','completedAt',t,'resumeEventId',e.id,'originalFailure',jsonb_build_object('contract','workflow-resolution-provenance-v1','parentId',p.id,
      'parentStatus',case when e.details#>>'{originalFailure,parentStatus}' in ('failed','completed') then e.details#>>'{originalFailure,parentStatus}' else null end,
      'parentFailedAt',p.failed_at,'failureRecorded',p.error_message is not null,
      'workflowFailureRecorded',(select workflow_error is not null from report_drafts where id=p_draft_id))));
 update praktika_helper_jobs set status='completed',completed_at=t,locked_by=null,locked_at=null,response=response || jsonb_build_object('dispatched',false,'manualWorkflowCompletion',
   jsonb_build_object('contract','workflow-resolution-v1','eventId',closure_id,'source','controlled_resume','letterFingerprint',e.details->>'letterFingerprint')) where id=p_parent_id;
 update report_drafts set workflow_status='completed',workflow_last_message='Verified incomplete workflow steps completed through controlled resumption.',updated_at=t where id=p_draft_id;
 return jsonb_build_object('ok',true);
end $$;
commit;
