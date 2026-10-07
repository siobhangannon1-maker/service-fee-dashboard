-- Performance only: no data changes, evidence changes or eligibility relaxation.
-- Apply during a quiet window: ordinary index creation takes write-blocking locks.
begin;
-- Lookup indexes expose identifiers hidden inside the exact PL/pgSQL predicate.
create index workflow_resolution_praktika_draft_idx on public.praktika_helper_jobs ((lower(request->>'reportDraftId')));
create index workflow_resolution_praktika_continuation_idx on public.praktika_helper_jobs ((request->>'continuationId'));
create index workflow_resolution_praktika_upload_path_idx on public.praktika_helper_jobs ((split_part(request#>>'{body,file,path}','/',3))) where job_type='upload_report_to_praktika';
create index workflow_resolution_praktika_legacy_icon_idx on public.praktika_helper_jobs ((request#>>'{body,0,appointment_id}')) where job_type='update_praktika_letter_icons' and status='completed' and request->>'reportDraftId' is null and request->>'continuationId' is null;
create index workflow_resolution_mediref_draft_idx on public.mediref_helper_jobs ((lower(payload->>'draftId')));
create index workflow_resolution_mediref_continuation_idx on public.mediref_helper_jobs ((payload->>'workflowContinuationId'));
create index workflow_resolution_audit_draft_idx on public.report_writing_audit_events (entity_id,action,created_at,id) where entity_type='report_draft';

-- This is a superset of every true branch of job_associated, never an evidence
-- decision. UNION deduplicates identities. The original exact predicate remains
-- the final authority, including legacy receipt/time/actor/ambiguity checks.
create function public.workflow_resolution_praktika_jobs(p_draft_id uuid)
returns setof public.praktika_helper_jobs language sql stable security invoker
set search_path=public,pg_temp set row_security=off as $$
 with identity as materialized (
   select md5('praktika-complete-workflow:v1:' || p_draft_id::text)::uuid as parent_id,
     (select praktika_letter_icon_appointment_id from report_drafts where id=p_draft_id) as appointment_id
 ), candidates as materialized (
   select id from praktika_helper_jobs where lower(request->>'reportDraftId')=p_draft_id::text
   union select j.id from praktika_helper_jobs j,identity i where j.request->>'continuationId'=i.parent_id::text
   union select j.id from praktika_helper_jobs j,identity i where j.id=i.parent_id
   union select id from praktika_helper_jobs where job_type='upload_report_to_praktika' and split_part(request#>>'{body,file,path}','/',3)=p_draft_id::text
   union select j.id from praktika_helper_jobs j,identity i where j.id=substr(encode(sha256(convert_to('praktika-continuation-child:v1','UTF8') || decode('00','hex') || convert_to(i.parent_id::text,'UTF8') || decode('00','hex') || convert_to('update_praktika_letter_icons','UTF8')),'hex'),1,32)::uuid
   union select j.id from praktika_helper_jobs j,identity i where j.job_type='update_praktika_letter_icons' and j.status='completed' and j.request->>'reportDraftId' is null and j.request->>'continuationId' is null and j.request#>>'{body,0,appointment_id}'=i.appointment_id
 )
 select j.* from candidates c join praktika_helper_jobs j on j.id=c.id
 where public.workflow_resolution_job_associated(to_jsonb(j),p_draft_id);
$$;
revoke all on function public.workflow_resolution_praktika_jobs(uuid) from public,anon,authenticated;
grant execute on function public.workflow_resolution_praktika_jobs(uuid) to service_role;
create or replace function public.workflow_resolution_legacy_draft_safe(p_draft_id uuid)
returns boolean language sql stable security invoker set search_path=public,pg_temp set row_security=off as $$
 select (
   exists(select 1 from praktika_helper_jobs where id=md5('praktika-complete-workflow:v1:' || p_draft_id::text)::uuid)
   or exists(select 1 from report_drafts d where d.id=p_draft_id
     and exists(select 1 from praktika_helper_jobs j where j.job_type='upload_report_to_praktika'
       and (lower(j.request->>'reportDraftId')=d.id::text or j.request#>>'{body,file,path}' like '%/' || d.id::text || '/%')
       and j.status='completed' and public.workflow_resolution_legacy_execution_safe(to_jsonb(j)))
     and (d.workflow_icon_update_status in ('skipped','not_requested') or exists(select 1 from public.workflow_resolution_praktika_jobs(d.id) j
       where j.job_type='update_praktika_letter_icons' and public.workflow_resolution_job_associated(to_jsonb(j),d.id)
       and j.status='completed' and public.workflow_resolution_legacy_execution_safe(to_jsonb(j))))
     and (d.workflow_mediref_status in ('skipped','not_requested') or exists(select 1 from mediref_helper_jobs j
       where lower(j.payload->>'draftId')=d.id::text and j.status='completed' and public.workflow_resolution_legacy_execution_safe(to_jsonb(j)))))
 ) and public.workflow_resolution_mediref_audit_safe(p_draft_id)
 and not exists(select 1 from public.workflow_resolution_praktika_jobs(p_draft_id) j where public.workflow_resolution_job_associated(to_jsonb(j),p_draft_id) and (public.workflow_resolution_job_target_consistent(to_jsonb(j),p_draft_id) is distinct from true or public.workflow_resolution_legacy_execution_safe(to_jsonb(j)) is distinct from true
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
  perform 1 from praktika_helper_jobs where id in (select id from public.workflow_resolution_praktika_jobs(p_draft_id)) order by id for update;
  perform 1 from mediref_helper_jobs where lower(payload->>'draftId')=p_draft_id::text or payload->>'workflowContinuationId'=parent.id::text order by id for update;
  select coalesce(jsonb_agg(to_jsonb(j) order by j.id),'[]') into pj from public.workflow_resolution_praktika_jobs(p_draft_id) j;
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
commit;
