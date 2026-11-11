-- Administrative staff attestation, never an automated-success result.
begin;
create or replace function public.manual_workflow_completion_blocker(s jsonb) returns text
language plpgsql stable security invoker set search_path=public,pg_temp as $$
declare j jsonb; permit jsonb; stopped boolean;
begin
 for j in select value from jsonb_array_elements(s->'jobs') loop
  if coalesce(j->>'status','') not in ('completed','failed') then return 'active_job'; end if;
  -- A terminal failure may retain an old lock, but a newer/unbounded lease is uncertain.
  if j->>'status'='failed' and (j->>'lock_owned'='true' or j->>'locked_at' is not null)
   and (j->>'locked_at' is null or j->>'ended_at' is null or (j->>'ended_at')::timestamptz<(j->>'locked_at')::timestamptz)
   then return 'active_job'; end if;
 end loop;
 if s->>'preparing'='true' then return 'active_preparation'; end if;
 for permit in select value from jsonb_array_elements(s->'permits') loop
  select exists(select 1 from jsonb_array_elements(s->'jobs') x where x->>'id'=permit->>'jobId'
   and x->>'status' in ('completed','failed') and x->>'ended_at' is not null
   and (x->>'ended_at')::timestamptz >= (permit->>'createdAt')::timestamptz) into stopped;
  if not stopped then return 'active_operation'; end if;
 end loop;
 return null;
exception when invalid_datetime_format or datetime_field_overflow then return 'active_operation';
end $$;
create or replace function public.inspect_manual_workflow_completion(p_draft_id uuid,p_actor_user_id uuid) returns jsonb
language plpgsql security invoker set search_path=public,pg_temp set row_security=off set timezone='UTC' as $$
declare d public.report_drafts%rowtype; jobs jsonb; permits jsonb; s jsonb; letter text; blocked text; resolved boolean;
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
 s:=jsonb_build_object('domain','manual-workflow-completion-v1','letterFingerprint',letter,'jobs',jobs,'permits',permits,
  'preparing',coalesce(d.emailed_to_referrer_resend_id,'') like 'mediref:preparing:%','resolved',resolved);
 blocked:=public.manual_workflow_completion_blocker(s);
 return jsonb_build_object('fingerprint',encode(sha256(convert_to(s::text,'UTF8')),'hex'),'letterFingerprint',letter,
  'eligible',not resolved and blocked is null,'alreadyResolved',resolved,'reasonCode',case when resolved then 'already_resolved' else blocked end);
end $$;
create or replace function public.confirm_manual_workflow_completion(p_draft_id uuid,p_actor_user_id uuid,p_fingerprint text,p_letter_fingerprint text,p_all_steps_confirmed boolean) returns jsonb
language plpgsql security invoker set search_path=public,pg_temp set row_security=off set timezone='UTC' as $$
declare s jsonb; event_id uuid:=gen_random_uuid(); t timestamptz;
begin
 if p_all_steps_confirmed is distinct from true then raise exception 'manual_workflow_confirmation_required'; end if;
 s:=public.inspect_manual_workflow_completion(p_draft_id,p_actor_user_id);
 if s->>'letterFingerprint' is distinct from p_letter_fingerprint then return jsonb_build_object('ok',false,'reasonCode','letter_changed'); end if;
 if s->>'alreadyResolved'='true' then return jsonb_build_object('ok',true,'reconciled',true); end if;
 if s->>'eligible' is distinct from 'true' then return jsonb_build_object('ok',false,'reasonCode',s->>'reasonCode'); end if;
 if s->>'fingerprint' is distinct from p_fingerprint then return jsonb_build_object('ok',false,'reasonCode','state_changed'); end if;
 t:=clock_timestamp();
 insert into public.report_writing_audit_events(id,entity_type,entity_id,action,details) values(event_id,'report_draft',p_draft_id::text,'workflow_resolution_completed',
  jsonb_build_object('contract','workflow-resolution-v1','version',1,'draftId',p_draft_id,'letterFingerprint',p_letter_fingerprint,'previewFingerprint',p_fingerprint,
   'manualCompletionContract','manual-workflow-completion-v1','completionType','administrative_override','allRequiredStepsConfirmed',true,
   'reason','All required workflow steps have been completed manually or independently verified.',
   'actorUserId',p_actor_user_id,'completedAt',t,'source','operator_manual_completion'));
 update public.report_drafts set workflow_status='completed',updated_at=t where id=p_draft_id;
 return jsonb_build_object('ok',true,'eventId',event_id);
end $$;
create or replace function public.manual_workflow_completion_closed(p_draft_id uuid) returns boolean
language sql stable security invoker set search_path=public,pg_temp set row_security=off as $$
 select exists(select 1 from public.report_drafts d join public.report_writing_audit_events a on a.entity_type='report_draft' and a.entity_id=d.id::text
  where d.id=p_draft_id and d.deleted_at is null and d.status in ('approved','uploaded_to_praktika') and d.provider_approved_at is not null
  and a.action='workflow_resolution_completed' and a.details->>'contract'='workflow-resolution-v1' and a.details->>'version'='1'
  and a.details->>'manualCompletionContract'='manual-workflow-completion-v1' and a.details->>'completionType'='administrative_override'
  and a.details->'allRequiredStepsConfirmed'='true'::jsonb and a.details->>'source'='operator_manual_completion'
  and nullif(a.details->>'actorUserId','') is not null and nullif(a.details->>'completedAt','') is not null
  and a.details->>'reason'='All required workflow steps have been completed manually or independently verified.'
  and a.details->>'letterFingerprint'=public.workflow_resolution_letter_fingerprint(d));
$$;
create or replace function public.workflow_resolution_projection(p_draft_ids uuid[])
returns table(id uuid,"draftId" uuid,"letterFingerprint" text,events jsonb,"executionSafe" boolean)
language sql stable security invoker set search_path=public,pg_temp set row_security=off as $$
 select d.id,d.id,public.workflow_resolution_letter_fingerprint(d),
 (select coalesce(jsonb_agg(jsonb_build_object('id',a.id,'action',a.action,'details',a.details) order by a.created_at,a.id),'[]') from report_writing_audit_events a where a.entity_id=d.id::text and a.entity_type='report_draft' and a.details->>'contract'='workflow-resolution-v1'),
 (not exists(select 1 from report_writing_audit_events a where a.entity_id=d.id::text and a.action='workflow_resolution_execution' and not exists(select 1 from report_writing_audit_events b where b.action='workflow_resolution_settled' and b.details->>'permitId'=a.id::text))
 and public.workflow_resolution_legacy_draft_safe(d.id) and coalesce(d.emailed_to_referrer_resend_id,'') not like 'mediref:preparing:%') or public.manual_letter_icon_closed(d.id) or public.manual_workflow_completion_closed(d.id)
 from report_drafts d where d.id=any(p_draft_ids);
$$;
revoke all on function public.manual_workflow_completion_blocker(jsonb),public.inspect_manual_workflow_completion(uuid,uuid),public.confirm_manual_workflow_completion(uuid,uuid,text,text,boolean),public.manual_workflow_completion_closed(uuid) from public,anon,authenticated;
grant execute on function public.manual_workflow_completion_blocker(jsonb),public.inspect_manual_workflow_completion(uuid,uuid),public.confirm_manual_workflow_completion(uuid,uuid,text,text,boolean),public.manual_workflow_completion_closed(uuid) to service_role;
commit;
