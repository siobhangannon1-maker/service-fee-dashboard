-- No historical backfill. No external work. Apply once through migration tracking.
begin;
set local lock_timeout = '3s';
do $$ begin
 if current_user<>'postgres' then raise exception 'Historical reconciliation migration requires postgres ownership';end if;
 if not exists(select 1 from pg_class where oid='public.report_writing_audit_events'::regclass
   and relrowsecurity and pg_get_userbyid(relowner)='postgres') then raise exception 'Audit ownership/RLS baseline differs';end if;
 if exists(select 1 from unnest(array['SELECT','INSERT','UPDATE','DELETE']) p
   where not has_table_privilege('service_role','public.report_writing_audit_events',p)) then
   raise exception 'Service audit privileges differ';end if;
end $$;

-- Ordinary audit logging is server-side. Preserve service-role CRUD; reserve
-- authoritative events to SECURITY DEFINER functions and deny client mutation.
revoke insert,update,delete,truncate,references,trigger on public.report_writing_audit_events from public,anon,authenticated;
revoke truncate on public.report_writing_audit_events from service_role;
do $$ declare cols text; begin
  select string_agg(quote_ident(attname),',') into cols from pg_attribute
    where attrelid='public.report_writing_audit_events'::regclass and attnum>0 and not attisdropped;
  execute format('revoke insert (%s), update (%s), references (%s) on public.report_writing_audit_events from public,anon,authenticated',cols,cols,cols);
  if exists(select 1 from pg_attribute where attrelid='public.report_writing_audit_events'::regclass and attnum>0 and not attisdropped
    and (has_column_privilege('anon','public.report_writing_audit_events',attname,'INSERT,UPDATE,REFERENCES')
      or has_column_privilege('authenticated','public.report_writing_audit_events',attname,'INSERT,UPDATE,REFERENCES')))
    or has_table_privilege('anon','public.report_writing_audit_events','DELETE,TRUNCATE,TRIGGER')
    or has_table_privilege('authenticated','public.report_writing_audit_events','DELETE,TRUNCATE,TRIGGER') then
    raise exception 'Historical reconciliation client privileges remain';
  end if;
end $$;

create unique index report_historical_reconciliation_epoch_idx
 on public.report_writing_audit_events (entity_id,(details->>'epoch'),action)
 where action in ('system_historical_reconciliation','system_historical_reconciliation_invalidated','system_historical_retention_released');

create index report_historical_reconciliation_fences_idx on public.report_writing_audit_events using gin ((details->'fenceKeys')) where action='system_historical_reconciliation';

create function public.historical_reconciliation_id(p_draft uuid,p_epoch text)
returns uuid language sql immutable strict set search_path='' as $$
 select extensions.uuid_generate_v5('66d895a8-f955-5e36-a98c-62791e7d92bf'::uuid,p_draft::text||':'||p_epoch||':workflow');
$$;

-- Canonical epoch is independent of reconciliation/cleanup implementation version.
create function public.historical_reconciliation_epoch(p_created timestamptz,p_approved timestamptz)
returns text language sql immutable set search_path='' as $$
 select to_char(p_created at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"')||'/'||
   coalesce(to_char(p_approved at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),'unrecorded');
$$;

-- Exact database snapshot digest: never returned as raw clinical/job payloads.
-- Used only by offline inspection/reconciliation, never by normal list loading.
create function public.inspect_historical_workflow(p_draft_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare d public.report_drafts%rowtype; u public.praktika_helper_jobs%rowtype;
 i public.praktika_helper_jobs%rowtype; m public.mediref_helper_jobs%rowtype;
 a public.report_writing_audit_events%rowtype; us jsonb; icons jsonb; meds jsonb; audits jsonb;
 parents jsonb; duplicate_icons jsonb; all_audits jsonb; file jsonb; fields jsonb; parts text[];
 snapshot jsonb; fingerprint text; epoch text; branches jsonb; icon_outcome text; med_outcome text;
 chart_outcome text; chart_required boolean; historical_time timestamptz; upload_time timestamptz;
 icon_time timestamptz; med_time timestamptz; good_med boolean; matches integer; rec jsonb;
 reconciliation_state text:='none'; reconciled_fingerprint text;
begin
 select * into d from public.report_drafts where id=p_draft_id;
 if not found or d.deleted_at is not null or d.status not in ('approved','uploaded_to_praktika')
   or lower(btrim(d.patient_name, E' \t\n\r\v\f'||chr(160)||chr(5760)||chr(8192)||chr(8193)||chr(8194)||chr(8195)||chr(8196)||chr(8197)||chr(8198)||chr(8199)||chr(8200)||chr(8201)||chr(8202)||chr(8232)||chr(8233)||chr(8239)||chr(8287)||chr(12288)||chr(65279))) in ('test test','testing testing','siobhan gannon') then
   return jsonb_build_object('ok',false,'code','not_eligible'); end if;
 epoch:=public.historical_reconciliation_epoch(d.created_at,d.provider_approved_at);
 if epoch is null then return jsonb_build_object('ok',false,'code','missing_epoch'); end if;
 select case when exists(select 1 from public.report_writing_audit_events z where z.action='system_historical_reconciliation_invalidated'
   and z.details->>'reconciliationId'=ev.id::text) then 'invalidated' else 'active' end,ev.details->>'fingerprint'
 into reconciliation_state,reconciled_fingerprint from public.report_writing_audit_events ev
 where ev.id=public.historical_reconciliation_id(d.id,epoch) and ev.action='system_historical_reconciliation';
 reconciliation_state:=coalesce(reconciliation_state,'none');
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
  where x.entity_id=d.id::text and x.action not in ('system_historical_reconciliation','system_historical_reconciliation_invalidated','system_historical_retention_released');
 snapshot:=jsonb_build_object('draft',to_jsonb(d),'parents',parents,'uploads',us,'icons',icons,
  'mediref',meds,'uploadAudits',audits,'otherAudits',all_audits,'duplicateIcons',duplicate_icons);
 fingerprint:=encode(sha256(convert_to(snapshot::text,'UTF8')),'hex');
 if parents<>'[]' or jsonb_array_length(us)<>1 or jsonb_array_length(audits)<>1
   or jsonb_array_length(meds)>1 or d.workflow_status is distinct from 'completed'
   or d.workflow_praktika_upload_status is distinct from 'completed'
   or coalesce(d.workflow_icon_update_status,'') not in ('completed','skipped','not_requested')
   or coalesce(d.workflow_mediref_status,'') not in ('completed','skipped','not_requested') then
   return jsonb_build_object('ok',false,'code','ambiguous_or_nonterminal'); end if;
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
   return jsonb_build_object('ok',false,'code','upload_not_proven'); end if;
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
   return jsonb_build_object('ok',false,'code','association_not_proven'); end if;
 icon_outcome:='skipped';
 if d.workflow_icon_update_status in ('skipped','not_requested') then
   if icons<>'[]' then return jsonb_build_object('ok',false,'code','icon_ambiguous'); end if;
 else
   if duplicate_icons<>'[]' or coalesce(d.praktika_letter_icon_appointment_id,'')='' or coalesce(d.praktika_letter_icon_update_response_preview,'')='' then
     return jsonb_build_object('ok',false,'code','icon_not_proven'); end if;
   begin rec:=d.praktika_letter_icon_update_response_preview::jsonb;
   exception when invalid_text_representation then return jsonb_build_object('ok',false,'code','icon_not_proven'); end;
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
   if matches<>1 then return jsonb_build_object('ok',false,'code','icon_not_proven'); end if;
   select * into i from jsonb_populate_record(null::public.praktika_helper_jobs,(select j from jsonb_array_elements(icons) j
      where j->'response'=rec and j->>'status'='completed' and j->>'app_user_id' is not distinct from u.app_user_id::text
      and coalesce((j->>'completed_at')::timestamptz,(j->>'updated_at')::timestamptz)<=d.praktika_letter_icon_updated_at
      and d.praktika_letter_icon_updated_at-coalesce((j->>'completed_at')::timestamptz,(j->>'updated_at')::timestamptz)<=interval '60 seconds' limit 1));
   if exists(select 1 from jsonb_array_elements(icons) j where j->>'id'<>i.id::text and
     ((j->'request') ?| array['reportDraftId','continuationId','manualRetry','retryUploadId','retryExecutionUserId','replacementJobId']
      or (j->>'created_at')::timestamptz>=d.praktika_letter_icon_updated_at)) then
     return jsonb_build_object('ok',false,'code','icon_ambiguous'); end if;
   icon_outcome:='completed';
 end if;
 med_outcome:='skipped';good_med:=false;
 if jsonb_array_length(meds)=1 then
   select * into m from jsonb_populate_record(null::public.mediref_helper_jobs,meds->0);
   good_med:=m.status='completed' and (m.result->'prepared'='true' or m.result->'sent'='true')
     and coalesce(m.result->>'success','')<>'false' and coalesce(m.result->'error','null') in ('null','false','""','0')
     and coalesce(m.result->'errors','null') in ('null','false','""','0');
   if not coalesce(good_med,false) or coalesce(m.payload->>'workflowContinuationId','')<>'' or coalesce(m.payload->>'retryMediref','') not in ('','false') then
     return jsonb_build_object('ok',false,'code','mediref_not_proven'); end if;
   med_outcome:='completed';
 elsif d.workflow_mediref_status not in ('skipped','not_requested') then
   return jsonb_build_object('ok',false,'code','mediref_not_proven');
 end if;
 chart_outcome:='unknown';
 chart_required:=coalesce(d.periodontal_chart_attachment_error,'')<>'' or
   (coalesce(d.workflow_periodontal_chart_status,'') not in ('skipped','not_requested') and
     (coalesce(d.periodontal_chart_attachment_name,'')<>'' or d.periodontal_chart_attached_at is not null or
      d.workflow_periodontal_chart_status in ('pending','running','completed','failed','error')));
 if not chart_required and d.workflow_periodontal_chart_status in ('skipped','not_requested') then chart_outcome:='skipped'; end if;
 if d.workflow_periodontal_chart_status in ('pending','completed') and good_med and d.periodontal_chart_attached_at is not null
   and coalesce(d.periodontal_chart_attachment_name,'')<>'' and coalesce(d.periodontal_chart_attachment_error,'')=''
   and jsonb_typeof(m.payload->'attachments')='array' and
     (select count(*) from jsonb_array_elements(m.payload->'attachments') x where x->>'fileName'=d.periodontal_chart_attachment_name)=1 then chart_outcome:='completed'; end if;
 if good_med and d.workflow_periodontal_chart_status='skipped'
   and d.periodontal_chart_attachment_error='Periodontal chart was requested, but no periodontal chart was found.'
   and d.periodontal_chart_attached_at is null and coalesce(d.periodontal_chart_attachment_name,'')='' then chart_outcome:='skipped'; end if;
 if chart_outcome='unknown' then return jsonb_build_object('ok',false,'code','chart_not_proven'); end if;
 upload_time:=coalesce(u.completed_at,u.updated_at);icon_time:=coalesce(i.completed_at,i.updated_at);med_time:=m.updated_at;
 historical_time:=greatest(upload_time,case when icon_outcome='completed' then icon_time end,
   case when med_outcome='completed' then med_time end,case when chart_outcome='completed' then d.periodontal_chart_attached_at end);
 if upload_time is null or (icon_outcome='completed' and icon_time is null) or (med_outcome='completed' and med_time is null)
   or historical_time>clock_timestamp() or historical_time<='1970-01-01' then historical_time:=null; end if;
 branches:=jsonb_build_object(
   'praktika',jsonb_build_object('outcome','completed','basis','system_verified_historical_completion','jobId',u.id,'auditId',a.id),
   'mediref',jsonb_build_object('outcome',med_outcome,'basis',case when good_med then 'historical_result' else 'historical_skip' end,'jobId',m.id),
   'icon',jsonb_build_object('outcome',icon_outcome,'basis',case when i.id is not null then 'historical_result' else 'historical_skip' end,'jobId',i.id),
   'periodontal',jsonb_build_object('outcome',chart_outcome,'basis',case when chart_outcome='completed' then 'historical_attachment' else 'historical_skip' end,'jobId',case when chart_outcome='completed' then m.id end));
 return jsonb_build_object('ok',true,'draftId',d.id,'epoch',epoch,'eventId',public.historical_reconciliation_id(d.id,epoch),
   'fingerprint',fingerprint,'contract','historical-v1','branches',branches,'historicalCompletedAt',historical_time,
   'appointmentId',d.praktika_letter_icon_appointment_id,'jobIds',jsonb_build_array(u.id,i.id,m.id)-'null',
   'auditIds',jsonb_build_array(a.id),'reconciliationState',reconciliation_state,'reconciledFingerprint',reconciled_fingerprint);
end $$;

-- Exact retention route INSERT contract, corroborated against durable state.
-- No clinical content is copied into audit evidence. UPDATE/DELETE never use this exemption.
create function public.is_historical_retention_audit(p_event jsonb,p_reconciliation_id uuid)
returns boolean language plpgsql security invoker set search_path='' as $$
declare e public.report_writing_audit_events%rowtype; d public.report_drafts%rowtype;
 details jsonb:=p_event->'details'; field text; marker timestamptz; days numeric; completed timestamptz;
begin
 if p_event->>'action' is distinct from 'Retention cleanup deleted sensitive text'
   or p_event->>'entity_type' is distinct from 'report_draft'
   or p_event->>'actor_full_name' is distinct from 'System retention cleanup'
   or p_event->>'actor_initials' is distinct from 'SYS'
   or p_event->>'actor_email' is not null or p_event->>'patient_name' is not null
   or p_event->>'provider_id' is not null or jsonb_typeof(details) is distinct from 'object' then return false;end if;
 if not (details ?& array['deletedFields','sourceDays','aiDays','finalDays','deleteFinalText','authoritativeCompletedAt'])
   or (select count(*) from jsonb_object_keys(details))<>6
   or jsonb_typeof(details->'deletedFields') is distinct from 'array'
   or jsonb_typeof(details->'deleteFinalText') is distinct from 'boolean' then return false;end if;
 if jsonb_array_length(details->'deletedFields') not between 1 and 3
   or (select count(distinct v) from jsonb_array_elements_text(details->'deletedFields') v)<>jsonb_array_length(details->'deletedFields') then return false;end if;
 foreach field in array array['sourceDays','aiDays','finalDays'] loop
   if jsonb_typeof(details->field) is distinct from 'number' or (details->>field) !~ '^[1-9][0-9]*$'
     or (details->>field)::numeric>9007199254740991 then return false;end if;
 end loop;
 select * into e from public.report_writing_audit_events where id=p_reconciliation_id and action='system_historical_reconciliation';
 if not found or p_event->>'entity_id' is distinct from e.entity_id then return false;end if;
 select * into d from public.report_drafts where id::text=e.entity_id and deleted_at is null;
 if not found or e.details->>'epoch' is distinct from public.historical_reconciliation_epoch(d.created_at,d.provider_approved_at) then return false;end if;
 if exists(select 1 from public.report_writing_audit_events a where a.action='system_historical_reconciliation_invalidated' and a.details->>'reconciliationId'=e.id::text)
   or not exists(select 1 from public.report_writing_audit_events a where a.id=extensions.uuid_generate_v5(e.id,'retention-released')
     and a.action='system_historical_retention_released' and a.details->>'reconciliationId'=e.id::text) then return false;end if;
 -- Match JavaScript Date precision used by the existing retention route.
 completed:=date_trunc('milliseconds',(e.details->>'historicalCompletedAt')::timestamptz);
 if completed is null or completed<='1970-01-01' or completed>clock_timestamp()
   or (details->>'authoritativeCompletedAt')::timestamptz is distinct from completed then return false;end if;
 for field in select jsonb_array_elements_text(details->'deletedFields') loop
   if field='source_text' then marker:=d.sensitive_source_deleted_at;days:=(details->>'sourceDays')::numeric;
   elsif field='ai_generated_text' then marker:=d.ai_text_deleted_at;days:=(details->>'aiDays')::numeric;
   elsif field='edited_text' and details->'deleteFinalText'='true'::jsonb then marker:=d.final_text_deleted_at;days:=(details->>'finalDays')::numeric;
   else return false;end if;
   if to_jsonb(d)->>field is not null or marker is null or marker>clock_timestamp()
     or extract(epoch from (marker-completed))/86400<days then return false;end if;
 end loop;
 return true;
exception when data_exception then return false;
end $$;

create function public.protect_historical_reconciliation_event()
returns trigger language plpgsql security invoker set search_path='' as $$
begin
 if TG_OP='TRUNCATE' then raise exception 'Audit truncation is protected'; end if;
 if TG_OP in ('UPDATE','DELETE') and old.action in ('system_historical_reconciliation','system_historical_reconciliation_invalidated','system_historical_retention_released') then
   raise exception 'Historical reconciliation is immutable'; end if;
 if TG_OP in ('INSERT','UPDATE') and new.action in ('system_historical_reconciliation','system_historical_reconciliation_invalidated','system_historical_retention_released') then
   if current_user<>'postgres' or new.entity_type<>'report_draft' or new.details->>'source' is distinct from 'controlled_historical_cleanup'
     or new.details->>'contract' is distinct from 'historical-v1' or coalesce(new.details->>'epoch','')=''
     or new.patient_name is not null or new.actor_email is not null then raise exception 'Reserved historical reconciliation event'; end if;
   if new.action='system_historical_reconciliation' then
     if new.details->>'eventId' is distinct from new.id::text or new.details->>'draftId' is distinct from new.entity_id
       or new.details->'reconciliationVersion' is distinct from '1'::jsonb
       or coalesce(new.details->>'fingerprint','') !~ '^[a-f0-9]{64}$'
       or coalesce(new.details->>'executionVersion','') !~ '^[a-zA-Z0-9._-]{1,80}$'
       or jsonb_typeof(new.details->'branches') is distinct from 'object'
       or not ((new.details->'branches') ?& array['praktika','mediref','icon','periodontal'])
       or (select count(*) from jsonb_object_keys(new.details->'branches'))<>4
       or exists(select 1 from jsonb_each(new.details->'branches') b where coalesce(b.value->>'outcome','') not in ('completed','skipped'))
       or new.details#>>'{branches,praktika,outcome}' is distinct from 'completed'
       or new.details#>>'{branches,praktika,basis}' is distinct from 'system_verified_historical_completion'
       or coalesce(new.details->>'reconciledAt','')='' then raise exception 'Invalid historical reconciliation structure';end if;
   elsif new.action='system_historical_retention_released' then
     if new.details->>'reconciliationId' is null or new.details->>'reason' is distinct from 'verified_historical_cleanup'
       or coalesce(new.details->>'reviewReference','') !~ '^[a-zA-Z0-9._-]{1,80}$'
       or new.details->>'releasedAt' is null then raise exception 'Invalid historical retention release';end if;
   elsif new.details->>'reconciliationId' is null or new.details->>'reason' is distinct from 'superseding_database_activity' then
     raise exception 'Invalid historical invalidation structure';
   end if;
 end if;
 if TG_OP='DELETE' then return old; end if;return new;
end $$;
create trigger protect_historical_reconciliation_event before insert or update or delete on public.report_writing_audit_events
 for each row execute function public.protect_historical_reconciliation_event();
create trigger protect_historical_reconciliation_truncate before truncate on public.report_writing_audit_events
 for each statement execute function public.protect_historical_reconciliation_event();

-- All relevant writers participate, including direct service-role job inserts.
-- Shared advisory fences do not serialize ordinary writers with each other.
-- The cleanup takes exclusive TRY locks and rejects busy workflows, never broad table locks.
create function public.fence_historical_workflow_write()
returns trigger language plpgsql security definer set search_path='' as $$
declare oldj jsonb:=case when TG_OP='INSERT' then '{}'::jsonb else to_jsonb(old) end;
 newj jsonb:=case when TG_OP='DELETE' then '{}'::jsonb else to_jsonb(new) end;
 keys text[]:='{}'; k text; j jsonb; candidate text; event record; invalid_id uuid;
begin
 if TG_TABLE_NAME='report_writing_audit_events' and coalesce(newj->>'action',oldj->>'action') in
   ('system_historical_reconciliation','system_historical_reconciliation_invalidated','system_historical_retention_released') then
   if TG_OP='DELETE' then return old; end if;return new;
 end if;
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
 for event in select * from public.report_writing_audit_events a where a.action='system_historical_reconciliation'
   and (a.details->'fenceKeys') ?| keys loop
   if TG_TABLE_NAME='report_writing_audit_events' and TG_OP='INSERT'
     and public.is_historical_retention_audit(newj,event.id) then continue;end if;
   invalid_id:=extensions.uuid_generate_v5(event.id,'invalidated');
   insert into public.report_writing_audit_events(id,action,entity_type,entity_id,provider_id,details)
   values(invalid_id,'system_historical_reconciliation_invalidated','report_draft',event.entity_id,event.provider_id,
     jsonb_build_object('source','controlled_historical_cleanup','contract','historical-v1','epoch',event.details->>'epoch',
       'reconciliationId',event.id,'reason','superseding_database_activity')) on conflict(id) do nothing;
   if found then
     if TG_TABLE_NAME='report_drafts' and event.entity_id=coalesce(newj->>'id',oldj->>'id') then
       if TG_OP='UPDATE' then new.updated_at:=clock_timestamp();end if;
     else update public.report_drafts set updated_at=clock_timestamp() where id::text=event.entity_id;end if;
   end if;
 end loop;
 if TG_OP='DELETE' then return old;end if;return new;
end $$;
create trigger historical_workflow_fence before insert or update or delete on public.praktika_helper_jobs for each row execute function public.fence_historical_workflow_write();
create trigger historical_workflow_fence before insert or update or delete on public.mediref_helper_jobs for each row execute function public.fence_historical_workflow_write();
create trigger historical_workflow_fence before insert or update or delete on public.report_drafts for each row execute function public.fence_historical_workflow_write();
create trigger historical_workflow_fence before insert or update or delete on public.report_writing_audit_events for each row execute function public.fence_historical_workflow_write();

create function public.protect_historical_source_truncate()
returns trigger language plpgsql security definer set search_path='' as $$
begin
 if exists(select 1 from public.report_writing_audit_events where action='system_historical_reconciliation') then
   raise exception 'Historical reconciliation evidence protects source tables';end if;
 return null;
end $$;
create trigger historical_source_truncate before truncate on public.report_drafts for each statement execute function public.protect_historical_source_truncate();
create trigger historical_source_truncate before truncate on public.praktika_helper_jobs for each statement execute function public.protect_historical_source_truncate();
create trigger historical_source_truncate before truncate on public.mediref_helper_jobs for each statement execute function public.protect_historical_source_truncate();

create function public.reconcile_historical_workflow(p_draft_id uuid,p_expected_fingerprint text,p_execution_version text,p_dry_run boolean default true)
returns jsonb language plpgsql security definer set search_path='' as $$
declare proposal jsonb; fresh jsonb; existing public.report_writing_audit_events%rowtype; keys text[]; k text; event_id uuid; epoch text;
begin
 if p_dry_run is null or p_expected_fingerprint is null or p_expected_fingerprint !~ '^[0-9a-f]{64}$'
   or p_execution_version is null or p_execution_version !~ '^[a-zA-Z0-9._-]{1,80}$' then return jsonb_build_object('ok',false,'code','invalid_manifest');end if;
 if current_setting('transaction_isolation')<>'read committed' then return jsonb_build_object('ok',false,'code','isolation_not_supported');end if;
 -- The primary draft fence precedes inspection. Relevant referenced resources follow.
 if not pg_try_advisory_xact_lock(hashtextextended('historical-reconciliation:draft:'||p_draft_id::text,0)) then
   return jsonb_build_object('ok',false,'code','busy');end if;
 perform 1 from public.report_drafts where id=p_draft_id for update nowait;
 select public.historical_reconciliation_epoch(created_at,provider_approved_at) into epoch from public.report_drafts where id=p_draft_id and deleted_at is null;
 if epoch is null then return jsonb_build_object('ok',false,'code','not_eligible');end if;
 event_id:=public.historical_reconciliation_id(p_draft_id,epoch);
 select * into existing from public.report_writing_audit_events where id=event_id;
 if found then
   if existing.action<>'system_historical_reconciliation' or existing.details->>'fingerprint' is distinct from p_expected_fingerprint
     or exists(select 1 from public.report_writing_audit_events where action='system_historical_reconciliation_invalidated' and details->>'reconciliationId'=event_id::text)
     then return jsonb_build_object('ok',false,'code','superseded_or_conflicting');end if;
   return jsonb_build_object('ok',true,'code','already_reconciled','eventId',event_id);
 end if;
 proposal:=public.inspect_historical_workflow(p_draft_id);
 if proposal->>'ok' is distinct from 'true' then return proposal;end if;
 keys:=array['draft:'||p_draft_id::text,'job:'||md5('praktika-complete-workflow:v1:'||p_draft_id::text)::uuid::text];
 select keys||coalesce(array_agg('job:'||v),'{}') into keys from jsonb_array_elements_text(proposal->'jobIds') v where v is not null;
 select keys||coalesce(array_agg('audit:'||v),'{}') into keys from jsonb_array_elements_text(proposal->'auditIds') v;
 if coalesce(proposal->>'appointmentId','')<>'' then keys:=array_append(keys,'appointment:'||(proposal->>'appointmentId'));end if;
 for k in select distinct v from unnest(keys) v order by v loop
   if not pg_try_advisory_xact_lock(hashtextextended('historical-reconciliation:'||k,0)) then return jsonb_build_object('ok',false,'code','busy');end if;
 end loop;
 fresh:=public.inspect_historical_workflow(p_draft_id);
 if fresh->>'ok' is distinct from 'true' or fresh->>'fingerprint' is distinct from p_expected_fingerprint
   or fresh is distinct from proposal then return jsonb_build_object('ok',false,'code','state_changed');end if;
 if p_dry_run then return jsonb_build_object('ok',true,'code','eligible','proposal',fresh);end if;
 insert into public.report_writing_audit_events(id,action,entity_type,entity_id,provider_id,details)
 select event_id,'system_historical_reconciliation','report_draft',d.id::text,d.provider_id,
   (fresh-'ok'-'appointmentId')||jsonb_build_object('source','controlled_historical_cleanup','reconciliationVersion',1,
      'executionVersion',p_execution_version,'reconciledAt',clock_timestamp(),'fenceKeys',to_jsonb(keys))
 from public.report_drafts d where d.id=p_draft_id;
 return jsonb_build_object('ok',true,'code','reconciled','eventId',event_id);
exception when lock_not_available then return jsonb_build_object('ok',false,'code','busy');
end $$;

-- Separate reviewed operation: never called by reconciliation or ordinary runtime.
create function public.release_historical_retention(p_draft_id uuid,p_reconciliation_id uuid,p_review_reference text,p_release boolean default false)
returns jsonb language plpgsql security definer set search_path='' as $$
declare e public.report_writing_audit_events%rowtype; d public.report_drafts%rowtype; k text; release_id uuid;
begin
 if p_release is null or p_review_reference is null or p_review_reference !~ '^[a-zA-Z0-9._-]{1,80}$'
   or current_setting('transaction_isolation')<>'read committed' then return jsonb_build_object('ok',false,'code','invalid_release');end if;
 if not pg_try_advisory_xact_lock(hashtextextended('historical-reconciliation:draft:'||p_draft_id::text,0)) then
   return jsonb_build_object('ok',false,'code','busy');end if;
 select * into d from public.report_drafts where id=p_draft_id for update nowait;
 if not found or d.deleted_at is not null then return jsonb_build_object('ok',false,'code','not_eligible');end if;
 select * into e from public.report_writing_audit_events where id=p_reconciliation_id and entity_id=p_draft_id::text
   and action='system_historical_reconciliation';
 if not found or e.details->>'epoch' is distinct from public.historical_reconciliation_epoch(d.created_at,d.provider_approved_at)
   or e.details->>'historicalCompletedAt' is null or (e.details->>'historicalCompletedAt')::timestamptz<='1970-01-01'
   or (e.details->>'historicalCompletedAt')::timestamptz>clock_timestamp() then
   return jsonb_build_object('ok',false,'code','not_eligible');end if;
 for k in select jsonb_array_elements_text(e.details->'fenceKeys') order by 1 loop
   if not pg_try_advisory_xact_lock(hashtextextended('historical-reconciliation:'||k,0)) then return jsonb_build_object('ok',false,'code','busy');end if;
 end loop;
 if exists(select 1 from public.report_writing_audit_events where action='system_historical_reconciliation_invalidated'
   and details->>'reconciliationId'=e.id::text) then return jsonb_build_object('ok',false,'code','superseded');end if;
 release_id:=extensions.uuid_generate_v5(e.id,'retention-released');
 if exists(select 1 from public.report_writing_audit_events where id=release_id) then
   if not exists(select 1 from public.report_writing_audit_events where id=release_id and action='system_historical_retention_released'
     and entity_id=e.entity_id and details->>'reconciliationId'=e.id::text) then return jsonb_build_object('ok',false,'code','conflicting_release');end if;
   return jsonb_build_object('ok',true,'code','already_released','eventId',release_id);end if;
 if not p_release then return jsonb_build_object('ok',true,'code','release_eligible','eventId',release_id);end if;
 insert into public.report_writing_audit_events(id,action,entity_type,entity_id,provider_id,details)
 values(release_id,'system_historical_retention_released','report_draft',e.entity_id,e.provider_id,
   jsonb_build_object('source','controlled_historical_cleanup','contract','historical-v1','epoch',e.details->>'epoch',
     'reconciliationId',e.id,'reason','verified_historical_cleanup','reviewReference',p_review_reference,'releasedAt',clock_timestamp()));
 return jsonb_build_object('ok',true,'code','released','eventId',release_id);
exception when lock_not_available then return jsonb_build_object('ok',false,'code','busy');
end $$;

revoke all on function public.is_historical_retention_audit(jsonb,uuid),public.release_historical_retention(uuid,uuid,text,boolean),
 public.historical_reconciliation_id(uuid,text),public.historical_reconciliation_epoch(timestamptz,timestamptz),
 public.inspect_historical_workflow(uuid),public.protect_historical_reconciliation_event(),public.fence_historical_workflow_write(),
 public.protect_historical_source_truncate(),public.reconcile_historical_workflow(uuid,text,text,boolean) from public,anon,authenticated,service_role;
grant execute on function public.inspect_historical_workflow(uuid),public.reconcile_historical_workflow(uuid,text,text,boolean) to service_role;
grant execute on function public.release_historical_retention(uuid,uuid,text,boolean) to service_role;
commit;
