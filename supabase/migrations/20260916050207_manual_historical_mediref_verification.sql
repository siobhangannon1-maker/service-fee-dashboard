-- Local-only until separately approved. Append-only human evidence; no jobs or draft updates.
begin;
set local lock_timeout='3s';
do $$ begin
 if current_user<>'postgres' or not exists(select 1 from pg_class where oid='public.report_writing_audit_events'::regclass
   and relrowsecurity and pg_get_userbyid(relowner)='postgres') then raise exception 'Historical audit ownership/RLS baseline differs';end if;
 if not exists(select 1 from pg_trigger where tgrelid='public.report_writing_audit_events'::regclass
   and tgname='protect_historical_reconciliation_event' and tgenabled='O') then raise exception 'Historical protection prerequisite missing';end if;
 if has_table_privilege('anon','public.report_writing_audit_events','INSERT,UPDATE,DELETE,TRUNCATE')
   or has_table_privilege('authenticated','public.report_writing_audit_events','INSERT,UPDATE,DELETE,TRUNCATE') then
   raise exception 'Historical audit client privileges differ';end if;
end $$;
create function public.manual_historical_mediref_id(p_draft uuid,p_epoch text)
returns uuid language sql immutable strict set search_path='' as $$
 select extensions.uuid_generate_v5('66d895a8-f955-5e36-a98c-62791e7d92bf',p_draft::text||':'||p_epoch||':manual-mediref-v1');
$$;
create function public.inspect_manual_historical_mediref(p_draft_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare d public.report_drafts%rowtype; u public.praktika_helper_jobs%rowtype;
 i public.praktika_helper_jobs%rowtype; m public.mediref_helper_jobs%rowtype;
 a public.report_writing_audit_events%rowtype; us jsonb; icons jsonb; meds jsonb; audits jsonb;
 parents jsonb; duplicate_icons jsonb; all_audits jsonb; file jsonb; fields jsonb; parts text[];
 snapshot jsonb; fingerprint text; epoch text; branches jsonb; icon_outcome text; med_outcome text;
 chart_outcome text; chart_required boolean; historical_time timestamptz; upload_time timestamptz;
 icon_time timestamptz; med_time timestamptz; good_med boolean; matches integer; rec jsonb;
 reconciliation_state text:='none'; reconciled_fingerprint text; pdf_names jsonb; job_ids jsonb; keys text[]; other_branches jsonb;
begin
 select * into d from public.report_drafts where id=p_draft_id;
 if not found or d.deleted_at is not null or d.status not in ('approved','uploaded_to_praktika')
   or lower(btrim(d.patient_name, E' \t\n\r\v\f'||chr(160)||chr(5760)||chr(8192)||chr(8193)||chr(8194)||chr(8195)||chr(8196)||chr(8197)||chr(8198)||chr(8199)||chr(8200)||chr(8201)||chr(8202)||chr(8232)||chr(8233)||chr(8239)||chr(8287)||chr(12288)||chr(65279))) in ('test test','testing testing','siobhan gannon') then
   return jsonb_build_object('ok',false,'code','not_eligible'); end if;
 epoch:=public.historical_reconciliation_epoch(d.created_at,d.provider_approved_at);
 if epoch is null then return jsonb_build_object('ok',false,'code','missing_epoch'); end if;
 select coalesce(jsonb_agg(to_jsonb(j) order by j.id),'[]') into parents from public.praktika_helper_jobs j
  where j.job_type='complete_report_workflow' and (j.request->>'reportDraftId'=d.id::text
    or j.id=md5('praktika-complete-workflow:v1:'||d.id::text)::uuid);
 select coalesce(jsonb_agg(to_jsonb(j) order by j.id),'[]') into us from public.praktika_helper_jobs j
  where j.job_type='upload_report_to_praktika' and (j.request->>'reportDraftId'=d.id::text
    or j.request#>>'{body,file,path}' like '%/'||d.id::text||'/%'
    or exists(select 1 from public.report_writing_audit_events x where x.entity_id=d.id::text
      and x.action='Queued report upload to Praktika' and x.details->>'helperJobId'=j.id::text));
 select coalesce(jsonb_agg(to_jsonb(j) order by j.id),'[]') into icons from public.praktika_helper_jobs j
  where j.job_type='update_praktika_letter_icons' and (j.request->>'reportDraftId'=d.id::text
    or j.request#>>'{body,0,appointment_id}'=d.praktika_letter_icon_appointment_id);
 select coalesce(jsonb_agg(to_jsonb(j) order by j.id),'[]') into meds from public.mediref_helper_jobs j
  where j.job_type='send_mediref_letter' and j.payload->>'draftId'=d.id::text;
 select coalesce(jsonb_agg(to_jsonb(x) order by x.id),'[]') into audits from public.report_writing_audit_events x
  where x.action='Queued report upload to Praktika' and (x.entity_id=d.id::text
    or exists(select 1 from jsonb_array_elements(us) j where j->>'id'=x.details->>'helperJobId'));
 select coalesce(jsonb_agg(jsonb_build_object('id',x.id,'appointment',x.praktika_letter_icon_appointment_id,
   'at',x.praktika_letter_icon_updated_at) order by x.id),'[]') into duplicate_icons from public.report_drafts x
  where x.id<>d.id and x.praktika_letter_icon_appointment_id=d.praktika_letter_icon_appointment_id
    and x.praktika_letter_icon_updated_at=d.praktika_letter_icon_updated_at;
 select coalesce(jsonb_agg(to_jsonb(x) order by x.id),'[]') into all_audits from public.report_writing_audit_events x
  where x.entity_id=d.id::text and (x.action in ('Queued report upload to Praktika','Manual workflow verification','manually_verified_completed')
    or x.details ? 'manualVerification');
 snapshot:=jsonb_build_object('draft',to_jsonb(d),'parents',parents,'uploads',us,'icons',icons,
  'mediref',meds,'uploadAudits',audits,'otherAudits',all_audits,'duplicateIcons',duplicate_icons);
 fingerprint:=encode(sha256(convert_to(snapshot::text,'UTF8')),'hex');
 if parents<>'[]' or jsonb_array_length(meds) not between 1 and 2
   or exists(select 1 from jsonb_array_elements(meds) j where j->>'status' is distinct from 'failed'
     or j#>>'{payload,draftId}' is distinct from d.id::text
     or (j->'payload') ?| array['workflowContinuationId','retryMediref']
     or j->>'locked_by' is not null or j->>'locked_at' is not null
     or (j->>'created_at')::timestamptz < coalesce(d.provider_approved_at,d.created_at)
     or j#>'{result,sent}'='true'::jsonb or j#>'{result,prepared}'='true'::jsonb)
   or exists(select 1 from jsonb_array_elements(us||icons) j where j->>'status' not in ('completed','failed')
     or (j->'request') ?| array['reportDraftId','continuationId','manualRetry','replacementJobId']) then
   return jsonb_build_object('ok',false,'code','superseded'); end if;
 if exists(select 1 from public.report_writing_audit_events x where x.entity_id=d.id::text
   and (x.action in ('system_historical_reconciliation','Manual workflow verification','manually_verified_completed')
     or x.details ? 'manualVerification')) then return jsonb_build_object('ok',false,'code','conflicting');end if;
 if exists(select 1 from jsonb_array_elements(meds) j where jsonb_typeof(j#>'{payload,attachments}') is distinct from 'array') then
   return jsonb_build_object('ok',false,'code','invalid_evidence');end if;
 select coalesce(jsonb_agg(n order by n),'[]') into pdf_names from
   (select distinct x->>'fileName' n from jsonb_array_elements(meds) j,
      lateral jsonb_array_elements(j#>'{payload,attachments}') x
    where x->>'fileName' is distinct from d.periodontal_chart_attachment_name) names;
 if jsonb_array_length(pdf_names)<>1 or coalesce(pdf_names->>0,'') !~* '^[^/\\]+\.pdf$'
   or exists(select 1 from jsonb_array_elements(meds) j where
     (select count(*) from jsonb_array_elements(j#>'{payload,attachments}') x where x->>'fileName'=pdf_names->>0)<>1) then
   return jsonb_build_object('ok',false,'code','invalid_evidence');end if;
 select jsonb_agg(j->>'id' order by j->>'id') into job_ids from jsonb_array_elements(meds) j;
 keys:=array['draft:'||d.id::text,'job:'||md5('praktika-complete-workflow:v1:'||d.id::text)::uuid::text];
 select keys||coalesce(array_agg('job:'||(j->>'id')),'{}') into keys from jsonb_array_elements(us||icons||meds) j;
 select keys||coalesce(array_agg('audit:'||(j->>'id')),'{}') into keys from jsonb_array_elements(audits) j;
 if coalesce(d.praktika_letter_icon_appointment_id,'')<>'' then keys:=array_append(keys,'appointment:'||d.praktika_letter_icon_appointment_id);end if;
 other_branches:=jsonb_build_object('praktika','unknown','icon','unknown','periodontal','unknown');
 if d.workflow_periodontal_chart_status in ('skipped','not_requested') and coalesce(d.periodontal_chart_attachment_error,'')='' then
   other_branches:=other_branches||'{"periodontal":"skipped"}'::jsonb;end if;
 -- Preserve the existing explicit unavailable-chart skip, never infer chart transmission.
 if d.workflow_periodontal_chart_status='skipped'
   and d.periodontal_chart_attachment_error='Periodontal chart was requested, but no periodontal chart was found.'
   and d.periodontal_chart_attached_at is null and coalesce(d.periodontal_chart_attachment_name,'')='' then
   other_branches:=other_branches||'{"periodontal":"skipped"}'::jsonb;end if;
 <<other_evidence>> begin
 if jsonb_array_length(us)<>1 or jsonb_array_length(audits)<>1
   or d.workflow_praktika_upload_status is distinct from 'completed'
   or coalesce(d.workflow_icon_update_status,'') not in ('completed','skipped','not_requested') then exit other_evidence;end if;
 select * into u from jsonb_populate_record(null::public.praktika_helper_jobs,us->0);
 select * into a from jsonb_populate_record(null::public.report_writing_audit_events,audits->0);
 if u.status<>'completed' or jsonb_typeof(u.response)<>'object'
   or coalesce(u.response->>'success','')='false' or coalesce(u.response->'error','null') not in ('null','false','""','0')
   or coalesce(u.response->'errors','null') not in ('null','false','""','0')
   or coalesce(u.response#>>'{patient_communication,iFileId}','') !~ '^[1-9][0-9]*$'
   or jsonb_typeof(u.response#>'{patient_communication,iFileId}') not in ('string','number')
   or (jsonb_typeof(u.response#>'{patient_communication,iFileId}')='number' and (u.response#>>'{patient_communication,iFileId}')::numeric>9007199254740991)
   or u.request ?| array['reportDraftId','continuationId','manualRetry','retryUploadId','retryExecutionUserId','replacementJobId']
   or u.response ?| array['reportDraftId','continuationId','manualRetry','retryUploadId','retryExecutionUserId','replacementJobId']
   or u.request->>'method' is distinct from 'POST' or u.request->>'path' is distinct from '/php/forms/db_updateFormData.php'
   or u.request->>'contentType' is distinct from 'multipart_storage'
   or (d.provider_approved_at is not null and (u.created_at is null or u.created_at<d.provider_approved_at)) then
   exit other_evidence; end if;
 file:=u.request#>'{body,file}';fields:=u.request#>'{body,fields}';parts:=string_to_array(file->>'path','/');
 if coalesce(array_length(parts,1),0)<>4 or parts[1]<>'report-uploads' or parts[2]<>coalesce(u.app_user_id::text,'practice')
   or parts[3]<>d.id::text or parts[4] !~* '^[0-9]+-[^/\\?#]+\.pdf$'
   or coalesce(file->>'fileName','')='' or right(parts[4],length(file->>'fileName')+1)<>'-'||(file->>'fileName')
   or file->>'contentType' is distinct from 'application/pdf' or file->>'fieldName' is distinct from 'patient_communication[file][file]'
   or coalesce(file->>'bucket','')='' or fields->>'patient_communication[file][name]' is distinct from file->>'fileName'
   or coalesce(d.praktika_patient_id,'')='' or fields->>'patient_id' is distinct from d.praktika_patient_id
   or a.entity_type is distinct from 'report_draft' or a.entity_id<>d.id::text
   or a.details->>'helperJobId' is distinct from u.id::text or a.details#>>'{stagedPdf,storagePath}' is distinct from file->>'path'
   or a.details#>>'{stagedPdf,bucket}' is distinct from file->>'bucket' or a.details#>>'{stagedPdf,fileName}' is distinct from file->>'fileName'
   or a.details#>>'{stagedPdf,contentType}' is distinct from file->>'contentType'
   or a.details->>'praktikaPatientId' is distinct from d.praktika_patient_id
   or coalesce(a.details->>'actorUserId','') !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
   or (u.app_user_id is not null and a.details->>'actorUserId'<>u.app_user_id::text)
   or u.request ?| array['revision','reportRevision','artifactId','artifactHash','pdfHash']
   or (u.request->'body') ?| array['revision','reportRevision','artifactId','artifactHash','pdfHash']
   or file ?| array['revision','reportRevision','artifactId','artifactHash','pdfHash'] then
   exit other_evidence; end if;
 other_branches:=other_branches||'{"praktika":"completed"}'::jsonb;
 icon_outcome:='skipped';
 if d.workflow_icon_update_status in ('skipped','not_requested') then
   if icons<>'[]' then exit other_evidence; end if;
 else
   if duplicate_icons<>'[]' or coalesce(d.praktika_letter_icon_appointment_id,'')='' or coalesce(d.praktika_letter_icon_update_response_preview,'')='' then
     exit other_evidence; end if;
   begin rec:=d.praktika_letter_icon_update_response_preview::jsonb;
   exception when invalid_text_representation then exit other_evidence; end;
   select count(*) into matches from jsonb_array_elements(icons) j where j->>'status'='completed'
     and j->>'app_user_id' is not distinct from u.app_user_id::text and j->'response'=rec and jsonb_typeof(rec)='object' and rec<>'{}'::jsonb
     and coalesce(rec->>'success','')<>'false' and coalesce(rec->>'empty','')<>'true'
     and coalesce(rec->'error','null') in ('null','false','""','0')
     and not ((j->'request') ?| array['reportDraftId','continuationId','manualRetry','retryUploadId','retryExecutionUserId','replacementJobId'])
     and not ((j->'response') ?| array['reportDraftId','continuationId','manualRetry','retryUploadId','retryExecutionUserId','replacementJobId'])
     and jsonb_typeof(j#>'{request,body}')='array' and jsonb_array_length(j#>'{request,body}')=1
     and j#>>'{request,body,0,appointment_id}'=d.praktika_letter_icon_appointment_id
     and coalesce((j->>'completed_at')::timestamptz,(j->>'updated_at')::timestamptz)<=d.praktika_letter_icon_updated_at
     and d.praktika_letter_icon_updated_at-coalesce((j->>'completed_at')::timestamptz,(j->>'updated_at')::timestamptz)<=interval '60 seconds';
   if matches<>1 then exit other_evidence; end if;
   select * into i from jsonb_populate_record(null::public.praktika_helper_jobs,(select j from jsonb_array_elements(icons) j
      where j->'response'=rec and j->>'status'='completed' and j->>'app_user_id' is not distinct from u.app_user_id::text
      and coalesce((j->>'completed_at')::timestamptz,(j->>'updated_at')::timestamptz)<=d.praktika_letter_icon_updated_at
      and d.praktika_letter_icon_updated_at-coalesce((j->>'completed_at')::timestamptz,(j->>'updated_at')::timestamptz)<=interval '60 seconds' limit 1));
   if exists(select 1 from jsonb_array_elements(icons) j where j->>'id'<>i.id::text and
     ((j->'request') ?| array['reportDraftId','continuationId','manualRetry','retryUploadId','retryExecutionUserId','replacementJobId']
      or (j->>'created_at')::timestamptz>=d.praktika_letter_icon_updated_at)) then
     exit other_evidence; end if;
   icon_outcome:='completed';
 end if;
 other_branches:=other_branches||jsonb_build_object('icon',icon_outcome);
 end other_evidence;
 return jsonb_build_object('ok',true,'code','eligible','draftId',d.id,'epoch',epoch,
   'eventId',public.manual_historical_mediref_id(d.id,epoch),'fingerprint',fingerprint,
   'contract','manual-historical-mediref-v1','failedJobIds',job_ids,'fenceKeys',to_jsonb(keys),
   'pdfFingerprint',encode(sha256(convert_to('manual-historical-mediref-pdf:v1'||chr(10)||(pdf_names->>0),'UTF8')),'hex'),
   'otherBranches',other_branches,
   -- Failed helper timestamps cannot establish when the human-observed letter arrived.
   'historicalCompletedAt',null,'recordedWorkflowCompletedAt',d.workflow_completed_at);
end $$;

create unique index manual_historical_mediref_epoch_idx on public.report_writing_audit_events(entity_id,(details->>'epoch'),action)
 where action in ('manual_historical_mediref_verification','manual_historical_mediref_invalidated','manual_historical_mediref_retention_released');
-- The combined runtime action predicate cannot rely on either disjoint partial index.
create index historical_verification_runtime_idx on public.report_writing_audit_events(entity_id,action)
 where action in ('system_historical_reconciliation','system_historical_reconciliation_invalidated','system_historical_retention_released',
 'manual_historical_mediref_verification','manual_historical_mediref_invalidated','manual_historical_mediref_retention_released');
create index manual_historical_mediref_fences_idx on public.report_writing_audit_events using gin ((details->'fenceKeys'))
 where action='manual_historical_mediref_verification';

create function public.protect_manual_historical_mediref_event()
returns trigger language plpgsql security invoker set search_path='' as $$
begin
 if TG_OP='TRUNCATE' then raise exception 'Manual historical evidence is immutable';end if;
 if TG_OP in ('UPDATE','DELETE') and old.action in ('manual_historical_mediref_verification','manual_historical_mediref_invalidated','manual_historical_mediref_retention_released') then
   raise exception 'Manual historical evidence is immutable';end if;
 if TG_OP in ('INSERT','UPDATE') and new.action in ('manual_historical_mediref_verification','manual_historical_mediref_invalidated','manual_historical_mediref_retention_released') then
   if current_user<>'postgres' or TG_OP<>'INSERT' or new.entity_type is distinct from 'report_draft'
     or new.details->>'contract' is distinct from 'manual-historical-mediref-v1'
     or new.details->>'source' is distinct from 'human_external_verification'
     or coalesce(new.details->>'epoch','')='' or new.patient_name is not null or new.actor_email is not null then
     raise exception 'Reserved manual historical evidence';end if;
   if new.action='manual_historical_mediref_verification' then
     if new.id is distinct from public.manual_historical_mediref_id(new.entity_id::uuid,new.details->>'epoch')
       or new.details->>'eventId' is distinct from new.id::text or new.details->>'draftId' is distinct from new.entity_id
       or new.details->>'integration' is distinct from 'mediref' or new.details->>'outcome' is distinct from 'completed'
       or new.details->>'verifierUserId' is null or new.details->>'importedAt' is null
       or new.details->>'verifiedAt' is null or new.details->'version' is distinct from '1'::jsonb
       or coalesce(new.details->>'fingerprint','') !~ '^[a-f0-9]{64}$'
       or coalesce(new.details->>'pdfFingerprint','') !~ '^[a-f0-9]{64}$'
       or coalesce(new.details->>'workbookFingerprint','') !~ '^[a-f0-9]{64}$'
       or coalesce(new.details->>'manifestFingerprint','') !~ '^[a-f0-9]{64}$'
       or jsonb_typeof(new.details->'failedJobIds') is distinct from 'array'
       or jsonb_array_length(new.details->'failedJobIds') not between 1 and 2
       or jsonb_typeof(new.details->'otherBranches') is distinct from 'object'
       or not ((new.details->'otherBranches') ?& array['praktika','icon','periodontal'])
       or (select count(*) from jsonb_object_keys(new.details->'otherBranches'))<>3
       or exists(select 1 from jsonb_each_text(new.details->'otherBranches') b where b.value not in ('completed','skipped','unknown'))
       or new.details->'historicalCompletedAt' is distinct from 'null'::jsonb then raise exception 'Invalid manual historical evidence';end if;
   elsif new.details->>'verificationId' is null then raise exception 'Missing manual historical verification identity';
   elsif new.action='manual_historical_mediref_retention_released' and
     (coalesce(new.details->>'reviewReference','') !~ '^[a-zA-Z0-9._-]{1,80}$' or new.details->>'releasedAt' is null) then
     raise exception 'Invalid manual historical retention release';end if;
 end if;
 if TG_OP='DELETE' then return old;end if;return new;
end $$;
create trigger a_protect_manual_historical_mediref before insert or update or delete on public.report_writing_audit_events
 for each row execute function public.protect_manual_historical_mediref_event();

create function public.fence_manual_historical_mediref_write()
returns trigger language plpgsql security definer set search_path='' as $$
declare oldj jsonb:=case when TG_OP='INSERT' then '{}'::jsonb else to_jsonb(old) end;
 newj jsonb:=case when TG_OP='DELETE' then '{}'::jsonb else to_jsonb(new) end;
 keys text[]:='{}'; k text; j jsonb; candidate text; event record; invalid_id uuid;
begin
 if TG_TABLE_NAME='report_writing_audit_events' and coalesce(newj->>'action',oldj->>'action') in
   ('manual_historical_mediref_verification','manual_historical_mediref_invalidated','manual_historical_mediref_retention_released') then
   if TG_OP='DELETE' then return old; end if;return new;
 end if;
 -- Unrelated administrative audit events do not supersede human verification.
 if TG_TABLE_NAME='report_writing_audit_events' and not exists(select 1 from unnest(array[oldj,newj]) x
   where x->>'action' in ('Queued report upload to Praktika','Manual workflow verification','manually_verified_completed',
     'system_historical_reconciliation','system_historical_reconciliation_invalidated')
     or (x->'details') ? 'manualVerification') then
   if TG_OP='DELETE' then return old;end if;return new;end if;
 if TG_TABLE_NAME='report_drafts' and TG_OP='UPDATE' then
   -- Normal retention clearing only, not letter editing; preserve deployed retention semantics.
   if (oldj-array['updated_at','completed_at','retention_status','source_text','ai_generated_text','edited_text','sensitive_source_deleted_at','ai_text_deleted_at','final_text_deleted_at'])=
      (newj-array['updated_at','completed_at','retention_status','source_text','ai_generated_text','edited_text','sensitive_source_deleted_at','ai_text_deleted_at','final_text_deleted_at'])
      and (new.source_text is not distinct from old.source_text or (new.source_text is null and new.sensitive_source_deleted_at is not null))
      and (new.ai_generated_text is not distinct from old.ai_generated_text or (new.ai_generated_text is null and new.ai_text_deleted_at is not null))
      and (new.edited_text is not distinct from old.edited_text or (new.edited_text is null and new.final_text_deleted_at is not null)) then return new; end if;
 end if;
 foreach j in array array[oldj,newj] loop
   if j='{}' then continue; end if;
   if TG_TABLE_NAME='report_drafts' then keys:=array_append(keys,'draft:'||(j->>'id'));
     if coalesce(j->>'praktika_letter_icon_appointment_id','')<>'' and
       (TG_OP<>'UPDATE' or oldj->'praktika_letter_icon_appointment_id' is distinct from newj->'praktika_letter_icon_appointment_id'
        or oldj->'praktika_letter_icon_updated_at' is distinct from newj->'praktika_letter_icon_updated_at') then
       keys:=array_append(keys,'appointment:'||(j->>'praktika_letter_icon_appointment_id'));end if;
   elsif TG_TABLE_NAME='praktika_helper_jobs' then
     keys:=array_append(keys,'job:'||(j->>'id'));
     for candidate in select j#>>'{request,reportDraftId}' union
       select v from regexp_split_to_table(coalesce(j#>>'{request,body,file,path}',''),'/') v loop
       if candidate ~ '^[0-9a-f-]{36}$' then keys:=array_append(keys,'draft:'||candidate);end if;
     end loop;
     if coalesce(j#>>'{request,body,0,appointment_id}','')<>'' then keys:=array_append(keys,'appointment:'||(j#>>'{request,body,0,appointment_id}'));end if;
   elsif TG_TABLE_NAME='mediref_helper_jobs' then keys:=array_append(keys,'job:'||(j->>'id'));
     if coalesce(j#>>'{payload,draftId}','')<>'' then keys:=array_append(keys,'draft:'||(j#>>'{payload,draftId}'));end if;
   else
     keys:=array_append(keys,'audit:'||(j->>'id'));
     if coalesce(j#>>'{details,helperJobId}','')<>'' then keys:=array_append(keys,'job:'||(j#>>'{details,helperJobId}'));end if;
     if coalesce(j->>'entity_id','') ~ '^[0-9a-f-]{36}$' then keys:=array_append(keys,'draft:'||(j->>'entity_id'));end if;
   end if;
 end loop;
 for k in select distinct v from unnest(keys) v where v is not null order by v loop
   perform pg_advisory_xact_lock_shared(hashtextextended('historical-reconciliation:'||k,0));
 end loop;
 -- A later relevant mutation atomically supersedes, never edits, the completion event.
 for event in select * from public.report_writing_audit_events a where a.action='manual_historical_mediref_verification'
   and (a.details->'fenceKeys') ?| keys loop
   invalid_id:=extensions.uuid_generate_v5(event.id,'invalidated');
   insert into public.report_writing_audit_events(id,action,entity_type,entity_id,provider_id,details)
   values(invalid_id,'manual_historical_mediref_invalidated','report_draft',event.entity_id,event.provider_id,
     jsonb_build_object('source','human_external_verification','contract','manual-historical-mediref-v1','epoch',event.details->>'epoch',
       'verificationId',event.id,'reason','superseding_database_activity')) on conflict(id) do nothing;

 end loop;
 if TG_OP='DELETE' then return old;end if;return new;
end $$;
create trigger manual_historical_mediref_fence before insert or update or delete on public.report_drafts for each row execute function public.fence_manual_historical_mediref_write();
create trigger manual_historical_mediref_fence before insert or update or delete on public.praktika_helper_jobs for each row execute function public.fence_manual_historical_mediref_write();
create trigger manual_historical_mediref_fence before insert or update or delete on public.mediref_helper_jobs for each row execute function public.fence_manual_historical_mediref_write();
create trigger manual_historical_mediref_fence before insert or update or delete on public.report_writing_audit_events for each row execute function public.fence_manual_historical_mediref_write();

create function public.protect_manual_historical_source_truncate()
returns trigger language plpgsql security definer set search_path='' as $$
begin
 if exists(select 1 from public.report_writing_audit_events where action='manual_historical_mediref_verification') then
   raise exception 'Manual historical evidence protects source tables';end if;return null;
end $$;
create trigger manual_historical_source_truncate before truncate on public.report_drafts for each statement execute function public.protect_manual_historical_source_truncate();
create trigger manual_historical_source_truncate before truncate on public.praktika_helper_jobs for each statement execute function public.protect_manual_historical_source_truncate();
create trigger manual_historical_source_truncate before truncate on public.mediref_helper_jobs for each statement execute function public.protect_manual_historical_source_truncate();

create function public.verify_historical_mediref_completion(p_draft_id uuid,p_epoch text,p_expected_fingerprint text,
 p_pdf_fingerprint text,p_workbook_fingerprint text,p_manifest_fingerprint text,p_verifier_user_id uuid,
 p_verified_at timestamptz,p_dry_run boolean default true)
returns jsonb language plpgsql security definer set search_path='' as $$
declare d public.report_drafts%rowtype; e public.report_writing_audit_events%rowtype; proposal jsonb; fresh jsonb;
 event_id uuid; k text;
begin
 if p_dry_run is null or p_verified_at is null or p_verified_at>clock_timestamp() or p_verified_at<='1970-01-01'
   or p_epoch is null or exists(select 1 from unnest(array[p_expected_fingerprint,p_pdf_fingerprint,p_workbook_fingerprint,p_manifest_fingerprint]) v
     where v is null or v !~ '^[a-f0-9]{64}$') then return jsonb_build_object('ok',false,'code','invalid_evidence');end if;
 if current_setting('transaction_isolation')<>'read committed' then return jsonb_build_object('ok',false,'code','isolation_not_supported');end if;
 -- The trusted server resolves getUser(token); authorization is rechecked here.
 if p_verifier_user_id is null or not exists(select 1 from auth.users where id=p_verifier_user_id)
   or (select count(*) from public.user_status where user_id=p_verifier_user_id)<>1
   or not exists(select 1 from public.user_status where user_id=p_verifier_user_id and is_active is true)
   or (select count(*) from public.user_roles where user_id=p_verifier_user_id)<>1
   or not exists(select 1 from public.user_roles where user_id=p_verifier_user_id and role::text in ('admin','super_admin','practice_manager','typist')) then
   return jsonb_build_object('ok',false,'code','forbidden');end if;
 if not pg_try_advisory_xact_lock(hashtextextended('historical-reconciliation:draft:'||p_draft_id::text,0)) then
   return jsonb_build_object('ok',false,'code','busy');end if;
 select * into d from public.report_drafts where id=p_draft_id for update nowait;
 if not found or d.deleted_at is not null or not exists(select 1 from public.providers where id=d.provider_id and is_active is true) then
   return jsonb_build_object('ok',false,'code','blocked');end if;
 if p_epoch is distinct from public.historical_reconciliation_epoch(d.created_at,d.provider_approved_at) then
   return jsonb_build_object('ok',false,'code','state_changed');end if;
 event_id:=public.manual_historical_mediref_id(d.id,p_epoch);
 select * into e from public.report_writing_audit_events where id=event_id;
 if found then
   if e.action is distinct from 'manual_historical_mediref_verification'
     or e.details->>'fingerprint' is distinct from p_expected_fingerprint
     or e.details->>'pdfFingerprint' is distinct from p_pdf_fingerprint
     or e.details->>'workbookFingerprint' is distinct from p_workbook_fingerprint
     or e.details->>'manifestFingerprint' is distinct from p_manifest_fingerprint
     or (e.details->>'verifiedAt')::timestamptz is distinct from p_verified_at then return jsonb_build_object('ok',false,'code','conflicting');end if;
   if exists(select 1 from public.report_writing_audit_events where action='manual_historical_mediref_invalidated' and details->>'verificationId'=e.id::text) then
     return jsonb_build_object('ok',false,'code','superseded');end if;
   return jsonb_build_object('ok',true,'code','already_verified','eventId',e.id);end if;
 proposal:=public.inspect_manual_historical_mediref(d.id);
 if proposal->>'ok' is distinct from 'true' then return proposal;end if;
 for k in select jsonb_array_elements_text(proposal->'fenceKeys') order by 1 loop
   if not pg_try_advisory_xact_lock(hashtextextended('historical-reconciliation:'||k,0)) then return jsonb_build_object('ok',false,'code','busy');end if;
 end loop;
 fresh:=public.inspect_manual_historical_mediref(d.id);
 if fresh is distinct from proposal or fresh->>'fingerprint' is distinct from p_expected_fingerprint
   or fresh->>'pdfFingerprint' is distinct from p_pdf_fingerprint then return jsonb_build_object('ok',false,'code','state_changed');end if;
 if p_dry_run then return jsonb_build_object('ok',true,'code','eligible','proposal',fresh);end if;
 insert into public.report_writing_audit_events(id,entity_type,entity_id,provider_id,action,details)
 values(event_id,'report_draft',d.id::text,d.provider_id,'manual_historical_mediref_verification',
   (fresh-'ok'-'code')||jsonb_build_object('source','human_external_verification','version',1,
     'integration','mediref','outcome','completed','verifierUserId',p_verifier_user_id,
     'verifiedAt',p_verified_at,'importedAt',clock_timestamp(),
     'workbookFingerprint',p_workbook_fingerprint,'manifestFingerprint',p_manifest_fingerprint));
 return jsonb_build_object('ok',true,'code','verified','eventId',event_id);
exception when lock_not_available then return jsonb_build_object('ok',false,'code','busy');
end $$;

-- Separate provenance-specific release. No completion date is invented: unknown
-- historical completion time continues to deny retention even after explicit release.
create function public.release_manual_historical_mediref_retention(p_draft_id uuid,p_verification_id uuid,
 p_review_reference text,p_release boolean default false)
returns jsonb language plpgsql security definer set search_path='' as $$
declare d public.report_drafts%rowtype; e public.report_writing_audit_events%rowtype; release_id uuid; k text;
begin
 if p_release is null or p_review_reference is null or p_review_reference !~ '^[a-zA-Z0-9._-]{1,80}$'
   or current_setting('transaction_isolation')<>'read committed' then return jsonb_build_object('ok',false,'code','invalid_release');end if;
 if not pg_try_advisory_xact_lock(hashtextextended('historical-reconciliation:draft:'||p_draft_id::text,0)) then
   return jsonb_build_object('ok',false,'code','busy');end if;
 select * into d from public.report_drafts where id=p_draft_id for update nowait;
 select * into e from public.report_writing_audit_events where id=p_verification_id and entity_id=p_draft_id::text and action='manual_historical_mediref_verification';
 if not found or d.id is null or d.deleted_at is not null or e.details->>'epoch' is distinct from public.historical_reconciliation_epoch(d.created_at,d.provider_approved_at) then
   return jsonb_build_object('ok',false,'code','blocked');end if;
 for k in select jsonb_array_elements_text(e.details->'fenceKeys') order by 1 loop
   if not pg_try_advisory_xact_lock(hashtextextended('historical-reconciliation:'||k,0)) then return jsonb_build_object('ok',false,'code','busy');end if;
 end loop;
 if exists(select 1 from public.report_writing_audit_events where action='manual_historical_mediref_invalidated' and details->>'verificationId'=e.id::text) then
   return jsonb_build_object('ok',false,'code','superseded');end if;
 release_id:=extensions.uuid_generate_v5(e.id,'retention-released');
 if exists(select 1 from public.report_writing_audit_events where id=release_id) then
   if not exists(select 1 from public.report_writing_audit_events where id=release_id and action='manual_historical_mediref_retention_released'
     and entity_id=e.entity_id and details->>'verificationId'=e.id::text and details->>'reviewReference'=p_review_reference) then
     return jsonb_build_object('ok',false,'code','conflicting');end if;
   return jsonb_build_object('ok',true,'code','already_released','eventId',release_id);end if;
 if not p_release then return jsonb_build_object('ok',true,'code','release_eligible','eventId',release_id);end if;
 insert into public.report_writing_audit_events(id,action,entity_type,entity_id,provider_id,details)
 values(release_id,'manual_historical_mediref_retention_released','report_draft',e.entity_id,e.provider_id,
   jsonb_build_object('contract','manual-historical-mediref-v1','source','human_external_verification','epoch',e.details->>'epoch',
     'verificationId',e.id,'reviewReference',p_review_reference,'releasedAt',clock_timestamp()));
 return jsonb_build_object('ok',true,'code','released','eventId',release_id);
exception when lock_not_available then return jsonb_build_object('ok',false,'code','busy');
end $$;

revoke all on function public.manual_historical_mediref_id(uuid,text),public.inspect_manual_historical_mediref(uuid),
 public.protect_manual_historical_mediref_event(),public.fence_manual_historical_mediref_write(),public.protect_manual_historical_source_truncate(),
 public.verify_historical_mediref_completion(uuid,text,text,text,text,text,uuid,timestamptz,boolean),
 public.release_manual_historical_mediref_retention(uuid,uuid,text,boolean) from public,anon,authenticated,service_role;
grant execute on function public.inspect_manual_historical_mediref(uuid),
 public.verify_historical_mediref_completion(uuid,text,text,text,text,text,uuid,timestamptz,boolean),
 public.release_manual_historical_mediref_retention(uuid,uuid,text,boolean) to service_role;
commit;
