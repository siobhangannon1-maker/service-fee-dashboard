-- Isolated review candidate. No backfill; existing manual MediRef/learning contracts are unchanged.
begin;
create function public.workflow_resolution_letter_fingerprint(d public.report_drafts)
returns text language sql stable security invoker set search_path=public,pg_temp as $$
 select encode(sha256(convert_to(jsonb_build_object('letter',public.mediref_approved_letter_fingerprint(d),'patientTarget',d.praktika_patient_id)::text,'UTF8')),'hex');
$$;
revoke all on function public.workflow_resolution_letter_fingerprint(public.report_drafts) from public,anon,authenticated;
grant execute on function public.workflow_resolution_letter_fingerprint(public.report_drafts) to service_role;
create function public.workflow_resolution_snapshot(p_draft_id uuid, p_actor_user_id uuid)
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
  safe := not exists(select 1 from jsonb_array_elements(pj || mj) j where coalesce(j->>'status','') not in ('completed','failed'));
  if parent.id is not null and (parent.job_type is distinct from 'complete_report_workflow' or parent.request->>'reportDraftId' is distinct from p_draft_id::text
      or parent.app_user_id is null or parent.request->>'actorUserId' is distinct from parent.app_user_id::text
      or parent.status not in ('failed','completed') or parent.locked_at is not null or parent.locked_by is not null or parent.response->>'dispatched'='true') then safe:=false; end if;
  if exists(select 1 from jsonb_array_elements(pj) j where j->>'job_type'='complete_report_workflow' and j->>'id' is distinct from parent.id::text) then safe:=false; end if;
  if exists(select 1 from praktika_helper_jobs where job_type='update_praktika_letter_icons' and request->>'reportDraftId' is null and request->>'continuationId' is null and status in ('pending','waiting','processing','running')) then safe:=false; end if;
  if d.emailed_to_referrer_resend_id like 'mediref:preparing:%' then safe:=false; end if;
  if exists(select 1 from jsonb_array_elements(events) a where a->>'action'='workflow_resolution_execution'
      and not exists(select 1 from jsonb_array_elements(events) b where b->>'action'='workflow_resolution_settled' and b#>>'{details,permitId}'=a->>'id')) then safe:=false; end if;
  if exists(select 1 from jsonb_array_elements(pj) j where j->>'status'='failed' and (j#>>'{response,externalExecution}'='uncertain' or j#>>'{response,requestInvoked}'='true')) then safe:=false; end if;
  if parent.response#>>'{medirefPreparationFailure,insertionOutcome}' in ('unconfirmed','attempted') or parent.response#>>'{medirefPreparationFailure,externalExecution}'='uncertain'
      or parent.response#>>'{medirefPreparationFailure,deadlineExceeded}'='true' then safe:=false; end if;
  snap:=jsonb_build_object('draft',to_jsonb(d),'parent',case when parent.id is null then null else to_jsonb(parent) end,'praktika',pj,'mediref',mj,'events',events);
  return snap || jsonb_build_object('fingerprint',encode(sha256(convert_to(snap::text,'UTF8')),'hex'),
    'letterFingerprint',public.workflow_resolution_letter_fingerprint(d),'executionSafe',safe,
    'reason',case when safe then null else 'Execution is active or uncertain. Reconcile it before verifying or resuming.' end);
end $$;
revoke all on function public.workflow_resolution_snapshot(uuid,uuid) from public,anon,authenticated;
grant execute on function public.workflow_resolution_snapshot(uuid,uuid) to service_role;

-- A permanent completed-branch fence applies to the draft, including edits.
create function public.workflow_resolution_fenced(p_draft_id uuid,p_branch text)
returns boolean language sql stable security invoker set search_path=public,pg_temp set row_security=off as $$
 select exists(select 1 from report_writing_audit_events where entity_type='report_draft' and entity_id=p_draft_id::text
   and details->>'contract'='workflow-resolution-v1' and (action='workflow_resolution_completed' or (action='workflow_resolution_branch_fence' and details->>'branch'=p_branch)
     or (action='workflow_resolution_verification' and details->>'branch'=p_branch and details->>'outcome'='completed')))
 or exists(select 1 from praktika_helper_jobs where id=md5('praktika-complete-workflow:v1:' || p_draft_id::text)::uuid
   and response#>>array['manualVerification',p_branch,'action']='manually_verified_completed' and response#>>array['manualVerification',p_branch,'verifiedSuccess']='true'
   and response#>>array['manualVerification',p_branch,'draftId']=p_draft_id::text);
$$;
revoke all on function public.workflow_resolution_fenced(uuid,text) from public,anon,authenticated;
grant execute on function public.workflow_resolution_fenced(uuid,text) to service_role;

create function public.workflow_resolution_job_fence() returns trigger
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
 if tg_op<>'DELETE' and tg_table_name='praktika_helper_jobs' and new.job_type='update_praktika_letter_icons' and new_id is null and exists(select 1 from report_writing_audit_events where details->>'contract'='workflow-resolution-v1' and action in ('workflow_resolution_completed','workflow_resolution_verification')) then raise exception 'resolution_legacy_target_unscoped'; end if;
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
revoke all on function public.workflow_resolution_job_fence() from public,anon,authenticated;
create trigger workflow_resolution_job_fence before insert or update or delete on public.praktika_helper_jobs for each row execute function public.workflow_resolution_job_fence();
create trigger workflow_resolution_job_fence before insert or update or delete on public.mediref_helper_jobs for each row execute function public.workflow_resolution_job_fence();

create function public.workflow_resolution_draft_fence() returns trigger
language plpgsql security invoker set search_path=public,pg_temp set row_security=off as $$
declare b text; column_name text;
begin
 if tg_op='DELETE' then
   if exists(select 1 from report_writing_audit_events where entity_id=old.id::text and details->>'contract'='workflow-resolution-v1') then raise exception 'resolution_evidence_is_permanent'; end if;
   return old;
 end if;
 if new.id<>old.id and exists(select 1 from report_writing_audit_events where entity_id=old.id::text and details->>'contract'='workflow-resolution-v1') then raise exception 'resolution_evidence_is_permanent'; end if;
 if public.workflow_resolution_letter_fingerprint(new) is distinct from public.workflow_resolution_letter_fingerprint(old)
   and exists(select 1 from report_writing_audit_events where entity_id=old.id::text and details->>'contract'='workflow-resolution-v1' and action in ('workflow_resolution_verification','workflow_resolution_completed')) then raise exception 'resolution_letter_is_fenced'; end if;
 foreach b in array array['praktika','icon','mediref','periodontal'] loop
   column_name:=case b when 'praktika' then 'workflow_praktika_upload_status' when 'icon' then 'workflow_icon_update_status' when 'mediref' then 'workflow_mediref_status' else 'workflow_periodontal_chart_status' end;
   if public.workflow_resolution_fenced(old.id,b) and to_jsonb(new)->column_name is distinct from to_jsonb(old)->column_name
     and coalesce(to_jsonb(new)->>column_name,'') not in ('completed','skipped','not_requested') then raise exception 'resolution_branch_completed'; end if;
 end loop;
 if public.workflow_resolution_fenced(old.id,'icon') and new.praktika_letter_icon_appointment_id is distinct from old.praktika_letter_icon_appointment_id then raise exception 'resolution_branch_completed'; end if;
 if public.workflow_resolution_fenced(old.id,'periodontal') and (new.periodontal_chart_attachment_name is distinct from old.periodontal_chart_attachment_name or new.periodontal_chart_attachment_error is distinct from old.periodontal_chart_attachment_error) then raise exception 'resolution_branch_completed'; end if;
 if public.workflow_resolution_fenced(old.id,'mediref') and new.emailed_to_referrer_resend_id is distinct from old.emailed_to_referrer_resend_id
    and new.emailed_to_referrer_resend_id is not null then raise exception 'resolution_branch_completed'; end if;
 if public.workflow_resolution_fenced(old.id,'workflow') and new.workflow_status is distinct from old.workflow_status and new.workflow_status is distinct from 'completed' then raise exception 'resolution_workflow_completed'; end if;
 return new;
end $$;
revoke all on function public.workflow_resolution_draft_fence() from public,anon,authenticated;
create trigger workflow_resolution_draft_fence before update or delete on public.report_drafts for each row execute function public.workflow_resolution_draft_fence();

create function public.workflow_resolution_audit_fence() returns trigger
language plpgsql security invoker set search_path=public,pg_temp set row_security=off as $$
begin
 if tg_op='TRUNCATE' then
   if exists(select 1 from report_writing_audit_events where details->>'contract'='workflow-resolution-v1') then raise exception 'resolution_evidence_is_permanent'; end if;
   return null;
 end if;
 if tg_op<>'INSERT' and old.details->>'contract'='workflow-resolution-v1' then raise exception 'resolution_evidence_is_permanent'; end if;
 if tg_op='INSERT' and new.action like 'workflow_resolution_%' then
   if new.details->>'contract' is distinct from 'workflow-resolution-v1' or new.details->>'draftId' is distinct from new.entity_id
     or new.entity_type<>'report_draft' then raise exception 'resolution_invalid_evidence'; end if;
   if current_user not in ('service_role','postgres') then raise exception 'resolution_not_authorized'; end if;
   perform 1 from report_drafts where id=new.entity_id::uuid for update;
 end if;
 if tg_op='DELETE' then return old; end if; return new;
end $$;
revoke all on function public.workflow_resolution_audit_fence() from public,anon,authenticated;
create trigger workflow_resolution_audit_fence before insert or update or delete on public.report_writing_audit_events for each row execute function public.workflow_resolution_audit_fence();
create trigger workflow_resolution_audit_truncate_fence before truncate on public.report_writing_audit_events for each statement execute function public.workflow_resolution_audit_fence();

-- Immutable execution claims never disappear because a lease/heartbeat expired.
create function public.settle_workflow_resolution_execution(p_draft_id uuid,p_job_id uuid,p_owner text,p_safe_before_execution boolean default false)
returns void language plpgsql security invoker set search_path=public,pg_temp set row_security=off as $$
declare a record; j jsonb;
begin
 perform 1 from report_drafts where id=p_draft_id for update;
 select to_jsonb(x) into j from praktika_helper_jobs x where id=p_job_id;
 if j is null then select to_jsonb(x) into j from mediref_helper_jobs x where id=p_job_id; end if;
 if j->>'status' is distinct from 'completed' and not (p_safe_before_execution and j->>'status' in ('failed','waiting','pending')) then raise exception 'resolution_execution_uncertain'; end if;
 for a in select id,details from report_writing_audit_events where entity_id=p_draft_id::text and action='workflow_resolution_execution'
   and details->>'jobId'=p_job_id::text and details->>'owner' is not distinct from p_owner
   and not exists(select 1 from report_writing_audit_events b where b.action='workflow_resolution_settled' and b.details->>'permitId'=report_writing_audit_events.id::text) loop
   insert into report_writing_audit_events(entity_type,entity_id,action,details) values('report_draft',p_draft_id::text,'workflow_resolution_settled',
     jsonb_build_object('contract','workflow-resolution-v1','version',1,'draftId',p_draft_id,'permitId',a.id,'jobId',p_job_id,'safeBeforeExecution',p_safe_before_execution));
 end loop;
end $$;
revoke all on function public.settle_workflow_resolution_execution(uuid,uuid,text,boolean) from public,anon,authenticated;
grant execute on function public.settle_workflow_resolution_execution(uuid,uuid,text,boolean) to service_role;

-- The authenticated API seals the exact resolver output and derives the plan.
-- The service-only RPC rechecks its source digest and execution safety under the
-- same draft mutex used by every insertion/claim. Browser plans are never accepted.
create function public.confirm_workflow_resolution(p_draft_id uuid,p_actor_user_id uuid,p_expected_fingerprint text,p_letter_fingerprint text,
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
 original:=jsonb_build_object('parentStatus',parent.status,'parentFailedAt',parent.failed_at,'parentError',parent.error_message,'parentResponse',parent.response,
   'workflowError',s#>'{draft,workflow_error}');
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
revoke all on function public.confirm_workflow_resolution(uuid,uuid,text,text,jsonb,jsonb,text,jsonb,jsonb,jsonb) from public,anon,authenticated;
grant execute on function public.confirm_workflow_resolution(uuid,uuid,text,text,jsonb,jsonb,text,jsonb,jsonb,jsonb) to service_role;
create function public.begin_workflow_resolution_operation(p_draft_id uuid,p_branch text,p_permit_id uuid,p_resolution_event uuid default null)
returns jsonb language plpgsql security invoker set search_path=public,pg_temp set row_security=off as $$
begin
 if current_setting('transaction_isolation')<>'read committed' or p_branch not in ('praktika','icon','mediref','periodontal') then raise exception 'resolution_invalid_operation'; end if;
 perform 1 from report_drafts where id=p_draft_id for update;
 if not found or public.workflow_resolution_fenced(p_draft_id,p_branch) then return jsonb_build_object('ok',false); end if;
 if exists(select 1 from report_writing_audit_events where entity_id=p_draft_id::text and action='workflow_resolution_verification' and details->>'branch'=p_branch and details->>'outcome'='incomplete')
  and not exists(select 1 from praktika_helper_jobs p join report_writing_audit_events a on a.id::text=p.response#>>'{resolution,eventId}' where p.id=md5('praktika-complete-workflow:v1:' || p_draft_id::text)::uuid and a.id=p_resolution_event and a.action='workflow_resolution_resume' and a.details->'plan' ? p_branch) then return jsonb_build_object('ok',false); end if;
 if exists(select 1 from praktika_helper_jobs p where p.id=md5('praktika-complete-workflow:v1:' || p_draft_id::text)::uuid and not exists(select 1 from user_status u where u.user_id=p.app_user_id and u.is_active is true)) then raise exception 'resolution_actor_inactive'; end if;
 insert into report_writing_audit_events(id,entity_type,entity_id,action,details) values(p_permit_id,'report_draft',p_draft_id::text,'workflow_resolution_execution',
  jsonb_build_object('contract','workflow-resolution-v1','version',1,'draftId',p_draft_id,'branch',p_branch,'permitId',p_permit_id,'source','request_operation'));
 return jsonb_build_object('ok',true);
end $$;
revoke all on function public.begin_workflow_resolution_operation(uuid,text,uuid,uuid) from public,anon,authenticated;
grant execute on function public.begin_workflow_resolution_operation(uuid,text,uuid,uuid) to service_role;
create function public.settle_workflow_resolution_operation(p_draft_id uuid,p_permit_id uuid)
returns void language plpgsql security invoker set search_path=public,pg_temp set row_security=off as $$
begin
 perform 1 from report_drafts where id=p_draft_id for update;
 if not exists(select 1 from report_writing_audit_events where id=p_permit_id and entity_id=p_draft_id::text and action='workflow_resolution_execution' and details->>'source'='request_operation') then raise exception 'resolution_invalid_permit'; end if;
 if not exists(select 1 from report_writing_audit_events where action='workflow_resolution_settled' and details->>'permitId'=p_permit_id::text) then
  insert into report_writing_audit_events(entity_type,entity_id,action,details) values('report_draft',p_draft_id::text,'workflow_resolution_settled',
   jsonb_build_object('contract','workflow-resolution-v1','version',1,'draftId',p_draft_id,'permitId',p_permit_id,'source','request_operation'));
 end if;
end $$;
revoke all on function public.settle_workflow_resolution_operation(uuid,uuid) from public,anon,authenticated;
grant execute on function public.settle_workflow_resolution_operation(uuid,uuid) to service_role;
create function public.workflow_resolution_job_settled() returns trigger
language plpgsql security invoker set search_path=public,pg_temp set row_security=off as $$
declare draft_id text;
begin
 if new.status='completed' and old.status in ('processing','running') then
  draft_id:=case when tg_table_name='praktika_helper_jobs' then to_jsonb(new)#>>'{request,reportDraftId}' else to_jsonb(new)#>>'{payload,draftId}' end;
  if draft_id is null and tg_table_name='praktika_helper_jobs' then
    select request->>'reportDraftId' into draft_id from praktika_helper_jobs where id::text=new.request->>'continuationId';
    if draft_id is null and new.job_type='upload_report_to_praktika' then draft_id:=nullif(split_part(new.request#>>'{body,file,path}','/',3),''); end if;
  end if;
  if draft_id is not null then perform public.settle_workflow_resolution_execution(draft_id::uuid,new.id,old.locked_by,false); end if;
 end if;
 return new;
end $$;
revoke all on function public.workflow_resolution_job_settled() from public,anon,authenticated;
create trigger workflow_resolution_job_settled after update on public.praktika_helper_jobs for each row execute function public.workflow_resolution_job_settled();
create trigger workflow_resolution_job_settled after update on public.mediref_helper_jobs for each row execute function public.workflow_resolution_job_settled();
create function public.workflow_resolution_projection(p_draft_ids uuid[])
returns table(id uuid,"draftId" uuid,"letterFingerprint" text,events jsonb,"executionSafe" boolean)
language sql stable security invoker set search_path=public,pg_temp set row_security=off as $$
 select d.id,d.id,public.workflow_resolution_letter_fingerprint(d),
 (select coalesce(jsonb_agg(jsonb_build_object('id',a.id,'action',a.action,'details',a.details) order by a.created_at,a.id),'[]') from report_writing_audit_events a where a.entity_id=d.id::text and a.entity_type='report_draft' and a.details->>'contract'='workflow-resolution-v1'),
 not exists(select 1 from report_writing_audit_events a where a.entity_id=d.id::text and a.action='workflow_resolution_execution' and not exists(select 1 from report_writing_audit_events b where b.action='workflow_resolution_settled' and b.details->>'permitId'=a.id::text))
 and not exists(select 1 from praktika_helper_jobs j where lower(j.request->>'reportDraftId')=d.id::text and coalesce(j.status,'') not in ('completed','failed'))
 and not exists(select 1 from mediref_helper_jobs j where lower(j.payload->>'draftId')=d.id::text and coalesce(j.status,'') not in ('completed','failed'))
 from report_drafts d where d.id=any(p_draft_ids);
$$;
revoke all on function public.workflow_resolution_projection(uuid[]) from public,anon,authenticated;
grant execute on function public.workflow_resolution_projection(uuid[]) to service_role;

-- Branch success and parent-aware messaging are joined under the draft mutex.
create function public.record_mediref_preparation_completion(p_draft_id uuid,p_job_id uuid,p_values jsonb)
returns void language plpgsql security invoker set search_path=public,pg_temp set row_security=off as $$
declare d public.report_drafts%rowtype; parent public.praktika_helper_jobs%rowtype; v public.report_drafts%rowtype; j public.mediref_helper_jobs%rowtype;
begin
 select * into d from report_drafts where id=p_draft_id for update;
 if not found then raise exception 'resolution_invalid_draft'; end if;
 select * into j from mediref_helper_jobs where id=p_job_id and status='completed' and payload->>'draftId'=p_draft_id::text;
 if not found or j.result->>'prepared' is distinct from 'true' then raise exception 'mediref_preparation_unconfirmed'; end if;
 if public.workflow_resolution_fenced(p_draft_id,'workflow') then return; end if;
 select * into parent from praktika_helper_jobs where id=md5('praktika-complete-workflow:v1:' || p_draft_id::text)::uuid;
 select * into v from jsonb_populate_record(null::report_drafts,p_values);
 update report_drafts set workflow_mediref_status='completed',
   workflow_status=case when parent.status='failed' then 'failed' when parent.id is not null then d.workflow_status else v.workflow_status end,
   workflow_completed_at=case when parent.id is not null then d.workflow_completed_at else v.workflow_completed_at end,
   workflow_error=case when parent.status='failed' then coalesce(d.workflow_error,parent.error_message) else v.workflow_error end,
   workflow_last_message=case when parent.status='failed' then 'MediRef prepared. Workflow needs attention. Use Resolve workflow; automatic continuation is paused.'
     when parent.id is not null and parent.status not in ('waiting','processing') then 'MediRef prepared. Review the authoritative workflow status.' else v.workflow_last_message end,
   emailed_to_referrer_at=v.emailed_to_referrer_at,emailed_to_referrer_email=v.emailed_to_referrer_email,
   emailed_to_referrer_resend_id=v.emailed_to_referrer_resend_id,updated_at=v.updated_at where id=p_draft_id;
end $$;
revoke all on function public.record_mediref_preparation_completion(uuid,uuid,jsonb) from public,anon,authenticated;
grant execute on function public.record_mediref_preparation_completion(uuid,uuid,jsonb) to service_role;

create function public.workflow_resolution_truncate_fence() returns trigger
language plpgsql security invoker set search_path=public,pg_temp set row_security=off as $$
begin
 if exists(select 1 from report_writing_audit_events where details->>'contract'='workflow-resolution-v1') then raise exception 'resolution_evidence_is_permanent'; end if;
 return null;
end $$;
revoke all on function public.workflow_resolution_truncate_fence() from public,anon,authenticated;
create trigger workflow_resolution_truncate_fence before truncate on public.report_drafts for each statement execute function public.workflow_resolution_truncate_fence();
create trigger workflow_resolution_truncate_fence before truncate on public.praktika_helper_jobs for each statement execute function public.workflow_resolution_truncate_fence();
create trigger workflow_resolution_truncate_fence before truncate on public.mediref_helper_jobs for each statement execute function public.workflow_resolution_truncate_fence();
create function public.complete_resolved_workflow(p_draft_id uuid,p_parent_id uuid,p_owner text)
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
 end loop;
 if exists(select 1 from praktika_helper_jobs where lower(request->>'reportDraftId')=p_draft_id::text and id<>p_parent_id and status not in ('completed','failed'))
   or exists(select 1 from mediref_helper_jobs where lower(payload->>'draftId')=p_draft_id::text and status not in ('completed','failed')) then raise exception 'resolution_active'; end if;
 if exists(select 1 from report_writing_audit_events a where a.entity_id=p_draft_id::text and a.action='workflow_resolution_execution' and (a.details->>'jobId'=p_parent_id::text and a.details->>'owner'=p_owner) is not true and not exists(select 1 from report_writing_audit_events b where b.action='workflow_resolution_settled' and b.details->>'permitId'=a.id::text)) then raise exception 'resolution_execution_uncertain'; end if;
 insert into report_writing_audit_events(id,entity_type,entity_id,action,details) values(closure_id,'report_draft',p_draft_id::text,'workflow_resolution_completed',
  jsonb_build_object('contract','workflow-resolution-v1','version',1,'draftId',p_draft_id,'eventId',closure_id,'source','controlled_resume','actorUserId',e.details->>'actorUserId',
    'letterFingerprint',e.details->>'letterFingerprint','previewFingerprint',e.details->>'previewFingerprint','completedAt',t,'resumeEventId',e.id,'originalFailure',e.details->'originalFailure'));
 update praktika_helper_jobs set status='completed',completed_at=t,locked_by=null,locked_at=null,response=response || jsonb_build_object('manualWorkflowCompletion',
   jsonb_build_object('contract','workflow-resolution-v1','eventId',closure_id,'source','controlled_resume','letterFingerprint',e.details->>'letterFingerprint')) where id=p_parent_id;
 update report_drafts set workflow_status='completed',workflow_last_message='Verified incomplete workflow steps completed through controlled resumption.',updated_at=t where id=p_draft_id;
 return jsonb_build_object('ok',true);
end $$;
revoke all on function public.complete_resolved_workflow(uuid,uuid,text) from public,anon,authenticated;
grant execute on function public.complete_resolved_workflow(uuid,uuid,text) to service_role;
create index workflow_resolution_evidence_idx on public.report_writing_audit_events(entity_id,action,created_at,id)
where details->>'contract'='workflow-resolution-v1';
commit;
