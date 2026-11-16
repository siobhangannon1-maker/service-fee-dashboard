-- Manual administrative completion only. No job state, external request or clinical approval changes.
begin;
create or replace function public.manual_letter_icon_fingerprint(s jsonb) returns text
language sql immutable security invoker set search_path=public,pg_temp as $$
 select encode(sha256(convert_to(jsonb_build_object('letter',s->'letterFingerprint','parent',s->'parent',
 'praktika',s->'praktika','mediref',s->'mediref','chart',jsonb_build_array(s#>'{draft,workflow_periodontal_chart_status}',
 s#>'{draft,periodontal_chart_attachment_name}',s#>'{draft,periodontal_chart_attached_at}',s#>'{draft,periodontal_chart_attachment_error}'))::text,'UTF8')),'hex');
$$;
create or replace function public.manual_letter_icon_ready(s jsonb) returns boolean
language plpgsql stable security invoker set search_path=public,pg_temp set row_security=off set timezone='UTC' as $$
declare d jsonb:=s->'draft'; p jsonb:=s->'parent'; j jsonb; i jsonb; uploads int:=0; icons int:=0; med int:=0;
begin
 if coalesce(d->>'status','') not in ('approved','uploaded_to_praktika') or d->>'deleted_at' is not null or d->>'provider_approved_at' is null
 or p->>'id' is distinct from md5('praktika-complete-workflow:v1:'||(d->>'id'))::uuid::text
 or p->>'job_type' is distinct from 'complete_report_workflow' or p->>'status' is distinct from 'failed'
 or p->>'locked_at' is not null or p->>'locked_by' is not null or p->>'failed_at' is null
 or p#>>'{request,reportDraftId}' is distinct from d->>'id' or p->>'app_user_id' is null
 or p#>>'{request,actorUserId}' is distinct from p->>'app_user_id'
 or p#>>'{request,options,praktikaPatientId}' is distinct from d->>'praktika_patient_id' or nullif(d->>'praktika_patient_id','') is null
 or coalesce(p#>>'{response,stage}','') not in ('icon','mediref')
 or coalesce(p#>>'{response,dispatched}','false')<>'false'
 or public.workflow_resolution_execution_conflict(p->'response') is distinct from false
 or p#>'{response,medirefPreparationFailure}' is not null
 or jsonb_typeof(p#>'{request,options,attachPeriodontalChart}') is distinct from 'boolean'
 or coalesce(d->>'emailed_to_referrer_resend_id','') like 'mediref:preparing:%' then return false; end if;
 for j in select value from jsonb_array_elements(s->'praktika') loop
  if j->>'id'=p->>'id' then continue; end if;
  if public.workflow_resolution_job_target_consistent(j,(d->>'id')::uuid) is distinct from true
  or j#>>'{request,reportDraftId}' is distinct from d->>'id'
  or j->>'locked_at' is not null or j->>'locked_by' is not null then return false; end if;
  if j->>'job_type'='update_praktika_letter_icons' then
   icons:=icons+1; i:=j;
   if j->>'status' is distinct from 'failed' or j->>'failed_at' is null then return false; end if;
  elsif j->>'job_type'='upload_report_to_praktika' then
   uploads:=uploads+1;
   if j->>'status' is distinct from 'completed' or public.workflow_resolution_legacy_execution_safe(j) is distinct from true then return false; end if;
  elsif public.workflow_resolution_periodontal_read(j) is distinct from true or public.workflow_resolution_legacy_execution_safe(j) is distinct from true then return false;
  end if;
 end loop;
 if icons<>1 or uploads<>1 or i#>>'{request,method}' is distinct from 'POST'
 or i#>>'{request,path}' is distinct from '/php/forms/db_commitFormData.php' or i#>>'{request,contentType}' is distinct from 'json'
 or jsonb_typeof(i#>'{request,body}') is distinct from 'array' then return false; end if;
 if jsonb_array_length(i#>'{request,body}')<>1 or public.workflow_resolution_positive_read_id(i#>'{request,body,0,appointment_id}') is distinct from true
 or public.workflow_resolution_positive_read_id(i#>'{request,body,0,practice_id}') is distinct from true then return false; end if;
 if not exists(select 1 from report_letter_queue q where q.report_draft_id::text=d->>'id'
 and q.appointment_id=i#>>'{request,body,0,appointment_id}' and q.praktika_patient_id=d->>'praktika_patient_id') then return false; end if;
 for j in select value from jsonb_array_elements(s->'mediref') loop
  med:=med+1;
  if j->>'job_type' is distinct from 'send_mediref_letter' or j->>'status' is distinct from 'completed'
  or j#>>'{payload,draftId}' is distinct from d->>'id'
  or (j#>>'{payload,workflowContinuationId}' is not null and j#>>'{payload,workflowContinuationId}'<>p->>'id')
  or public.workflow_resolution_legacy_execution_safe(j) is distinct from true then return false; end if;
  if p#>>'{request,options,attachPeriodontalChart}'='true' then
   if d->>'workflow_periodontal_chart_status' is distinct from 'completed' or d->>'periodontal_chart_attached_at' is null
   or nullif(d->>'periodontal_chart_attachment_name','') is null or nullif(d->>'periodontal_chart_attachment_error','') is not null
   or jsonb_typeof(j#>'{payload,attachments}') is distinct from 'array' then return false; end if;
   if (select count(*) from jsonb_array_elements(j#>'{payload,attachments}') a where a->>'fileName'=d->>'periodontal_chart_attachment_name')<>1 then return false; end if;
  elsif coalesce(d->>'workflow_periodontal_chart_status','not_requested') not in ('skipped','not_requested')
   or nullif(d->>'periodontal_chart_attachment_error','') is not null then return false; end if;
 end loop;
 if med<>1 or public.workflow_resolution_mediref_audit_safe((d->>'id')::uuid) is distinct from true then return false; end if;
 if exists(select 1 from jsonb_array_elements(s->'events') a where a->>'action'='workflow_resolution_execution'
 and not exists(select 1 from jsonb_array_elements(s->'events') b where b->>'action'='workflow_resolution_settled' and b#>>'{details,permitId}'=a->>'id')
 and coalesce(a#>>'{details,jobId}','') not in (p->>'id',i->>'id')) then return false; end if;
 return true;
end $$;
create or replace function public.inspect_manual_letter_icon(p_draft_id uuid,p_actor_user_id uuid) returns jsonb
language plpgsql security invoker set search_path=public,pg_temp set row_security=off set timezone='UTC' as $$
declare s jsonb;
begin
 s:=public.workflow_resolution_snapshot(p_draft_id,p_actor_user_id);
 return s || jsonb_build_object('manualIconReady',public.manual_letter_icon_ready(s));
end $$;
create or replace function public.confirm_manual_letter_icon(p_draft_id uuid,p_actor_user_id uuid,p_fingerprint text,p_letter_fingerprint text,p_icon_confirmed boolean) returns jsonb
language plpgsql security invoker set search_path=public,pg_temp set row_security=off set timezone='UTC' as $$
declare s jsonb; event_id uuid:=gen_random_uuid(); t timestamptz:=clock_timestamp(); icon jsonb;
begin
 if p_icon_confirmed is distinct from true then raise exception 'manual_icon_confirmation_required'; end if;
 s:=public.inspect_manual_letter_icon(p_draft_id,p_actor_user_id);
 if s->>'letterFingerprint' is distinct from p_letter_fingerprint then return jsonb_build_object('ok',false); end if;
 if exists(select 1 from report_writing_audit_events a where a.entity_type='report_draft' and a.entity_id=p_draft_id::text
 and a.action='workflow_resolution_completed' and a.details->>'letterFingerprint'=p_letter_fingerprint
 and a.details->>'manualIconContract'='manual-letter-icon-v1') then return jsonb_build_object('ok',true,'reconciled',true); end if;
 if s->>'manualIconReady' is distinct from 'true' or s->>'fingerprint' is distinct from p_fingerprint
 or public.workflow_resolution_fenced(p_draft_id,'icon') then return jsonb_build_object('ok',false); end if;
 select value into icon from jsonb_array_elements(s->'praktika') where value->>'job_type'='update_praktika_letter_icons';
 insert into report_writing_audit_events(entity_type,entity_id,action,details) values('report_draft',p_draft_id::text,'workflow_resolution_verification',
 jsonb_build_object('contract','workflow-resolution-v1','version',1,'draftId',p_draft_id,'letterFingerprint',p_letter_fingerprint,
 'branch','icon','outcome','completed','source','human_external_verification','actorUserId',p_actor_user_id,'verifiedAt',t,'priorJobId',icon->>'id'));
 insert into report_writing_audit_events(id,entity_type,entity_id,action,details) values(event_id,'report_draft',p_draft_id::text,'workflow_resolution_completed',
 jsonb_build_object('contract','workflow-resolution-v1','version',1,'draftId',p_draft_id,'letterFingerprint',p_letter_fingerprint,
 'previewFingerprint',p_fingerprint,'manualIconContract','manual-letter-icon-v1','evidenceFingerprint',public.manual_letter_icon_fingerprint(s),
 'actorUserId',p_actor_user_id,'completedAt',t,'source','operator_manual_completion','iconManuallyVerified',true,'outcomes',jsonb_build_object('icon','completed')));
 update report_drafts set workflow_status='completed',updated_at=t where id=p_draft_id;
 return jsonb_build_object('ok',true,'eventId',event_id);
end $$;
create or replace function public.manual_letter_icon_closed(p_draft_id uuid) returns boolean
language plpgsql stable security invoker set search_path=public,pg_temp set row_security=off set timezone='UTC' as $$
declare d public.report_drafts%rowtype; s jsonb;
begin
 if not exists(select 1 from report_writing_audit_events a where a.entity_type='report_draft' and a.entity_id=p_draft_id::text
 and a.action='workflow_resolution_completed' and a.details->>'manualIconContract'='manual-letter-icon-v1') then return false; end if;
 select * into d from report_drafts where id=p_draft_id;
 if not found then return false; end if;
 s:=jsonb_build_object('draft',to_jsonb(d),'letterFingerprint',public.workflow_resolution_letter_fingerprint(d),
 'parent',(select to_jsonb(j) from praktika_helper_jobs j where j.id=md5('praktika-complete-workflow:v1:'||p_draft_id::text)::uuid),
 'praktika',(select coalesce(jsonb_agg(to_jsonb(j) order by j.id),'[]') from praktika_helper_jobs j where public.workflow_resolution_job_associated(to_jsonb(j),p_draft_id)),
 'mediref',(select coalesce(jsonb_agg(to_jsonb(j) order by j.id),'[]') from mediref_helper_jobs j where lower(j.payload->>'draftId')=p_draft_id::text or j.payload->>'workflowContinuationId'=md5('praktika-complete-workflow:v1:'||p_draft_id::text)::uuid::text),
 'events',(select coalesce(jsonb_agg(to_jsonb(a) order by a.created_at,a.id),'[]') from report_writing_audit_events a where a.entity_type='report_draft' and a.entity_id=p_draft_id::text));
 if not public.manual_letter_icon_ready(s) then return false; end if;
 return exists(select 1 from report_writing_audit_events a where a.entity_type='report_draft' and a.entity_id=p_draft_id::text
 and a.action='workflow_resolution_completed' and a.details->>'contract'='workflow-resolution-v1' and a.details->>'version'='1'
 and a.details->>'manualIconContract'='manual-letter-icon-v1' and a.details->>'letterFingerprint'=s->>'letterFingerprint'
 and a.details->>'evidenceFingerprint'=public.manual_letter_icon_fingerprint(s) and a.details->'iconManuallyVerified'='true'::jsonb);
end $$;
create or replace function public.workflow_resolution_projection(p_draft_ids uuid[])
returns table(id uuid,"draftId" uuid,"letterFingerprint" text,events jsonb,"executionSafe" boolean)
language sql stable security invoker set search_path=public,pg_temp set row_security=off as $$
 select d.id,d.id,public.workflow_resolution_letter_fingerprint(d),
 (select coalesce(jsonb_agg(jsonb_build_object('id',a.id,'action',a.action,'details',a.details) order by a.created_at,a.id),'[]') from report_writing_audit_events a where a.entity_id=d.id::text and a.entity_type='report_draft' and a.details->>'contract'='workflow-resolution-v1'),
 (not exists(select 1 from report_writing_audit_events a where a.entity_id=d.id::text and a.action='workflow_resolution_execution' and not exists(select 1 from report_writing_audit_events b where b.action='workflow_resolution_settled' and b.details->>'permitId'=a.id::text))
 and public.workflow_resolution_legacy_draft_safe(d.id) and coalesce(d.emailed_to_referrer_resend_id,'') not like 'mediref:preparing:%') or public.manual_letter_icon_closed(d.id)
 from report_drafts d where d.id=any(p_draft_ids);
$$;
revoke all on function public.manual_letter_icon_fingerprint(jsonb),public.manual_letter_icon_ready(jsonb),public.inspect_manual_letter_icon(uuid,uuid),public.confirm_manual_letter_icon(uuid,uuid,text,text,boolean),public.manual_letter_icon_closed(uuid) from public,anon,authenticated;
grant execute on function public.manual_letter_icon_fingerprint(jsonb),public.manual_letter_icon_ready(jsonb),public.inspect_manual_letter_icon(uuid,uuid),public.confirm_manual_letter_icon(uuid,uuid,text,text,boolean),public.manual_letter_icon_closed(uuid) to service_role;
commit;
