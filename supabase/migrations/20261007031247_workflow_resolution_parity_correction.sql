-- Additive parity correction. No data changes or lock cleanup.
-- Existing installed migrations remain byte-for-byte unchanged.
begin;
-- Canonical read ID: positive safe integer number or ASCII digit string.
-- Leading zeros denote the same integer; whitespace/signs/decimal strings fail.
create function public.workflow_resolution_positive_read_id(v jsonb)
returns boolean language plpgsql immutable security invoker set search_path=public,pg_temp as $$
declare n numeric;
begin
 if jsonb_typeof(v)='number' then n:=(v#>>'{}')::numeric;
 elsif jsonb_typeof(v)='string' and (v#>>'{}') ~ '^[0-9]+$' then
  if length(ltrim(v#>>'{}','0'))>16 then return false; end if;
  n:=coalesce(nullif(ltrim(v#>>'{}','0'),''),'0')::numeric;
 else return false; end if;
 return n>0 and n<=9007199254740991 and n=trunc(n);
end $$;
-- Null/missing is legacy absence. Arrays contain read-row objects only.
create function public.workflow_resolution_response_container(v jsonb)
returns boolean language sql immutable security invoker set search_path=public,pg_temp as $$
 select v is null or v='null'::jsonb or jsonb_typeof(v)='object' or
 (jsonb_typeof(v)='array' and not exists(select 1 from jsonb_array_elements(case when jsonb_typeof(v)='array' then v else '[]'::jsonb end) x where jsonb_typeof(x) is distinct from 'object'));
$$;
create or replace function public.workflow_resolution_execution_conflict(v jsonb)
returns boolean language sql immutable security invoker set search_path=public,pg_temp as $$
 with recursive nodes(value) as (
  select v union all
  select child.value from nodes n cross join lateral (
   select value from jsonb_each(case when jsonb_typeof(n.value)='object' then n.value else '{}'::jsonb end)
   union all select value from jsonb_array_elements(case when jsonb_typeof(n.value)='array' then n.value else '[]'::jsonb end)
  ) child
 )
 select exists(select 1 from nodes where jsonb_typeof(value)='object' and (
  (value ? 'requestInvoked' and value->'requestInvoked' is distinct from 'false'::jsonb)
  or (value ? 'externalExecution' and value->'externalExecution' is distinct from '"not_started"'::jsonb)
  or (value ? 'deadlineExceeded' and value->'deadlineExceeded' is distinct from 'false'::jsonb)
  or (value ? 'dispatched' and value->'dispatched' is distinct from 'false'::jsonb)
  or (value ? 'insertionOutcome' and value->'insertionOutcome' is distinct from '"not_attempted"'::jsonb)
  or exists(select 1 from unnest(array['uploadFailure','medirefPreparationFailure','manualWorkflowCompletion']) k where value ? k and jsonb_typeof(value->k) is distinct from 'object')
 ));
$$;
create or replace function public.workflow_resolution_periodontal_read(j jsonb)
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
  if (select count(*) from jsonb_object_keys(p))<>2 or not public.workflow_resolution_positive_read_id(p->'practice_id') or not public.workflow_resolution_positive_read_id(p->idkey) then return false; end if;
 end loop;
 return true;
end $$;
create or replace function public.workflow_resolution_legacy_execution_safe(j jsonb)
returns boolean language plpgsql immutable security invoker set search_path=public,pg_temp as $$
declare r jsonb:=coalesce(nullif(j->'response','null'::jsonb),nullif(j->'result','null'::jsonb),'{}'); f jsonb; kind text:=j->>'job_type';
begin
 -- Status/result are evaluated before retained terminal locks. Uncertainty wins.
 -- A validated read request cannot mutate externally, but active reads still block.
 if not public.workflow_resolution_response_container(j->'response') or not public.workflow_resolution_response_container(j->'result')
   or public.workflow_resolution_execution_conflict(j->'response') or public.workflow_resolution_execution_conflict(j->'result') then return false; end if;
 if public.workflow_resolution_periodontal_read(j) then
   return coalesce(j->>'status' in ('completed','failed'),false);
 end if;
 if j->>'status'='completed' then
   if kind='upload_report_to_praktika' then
     return (jsonb_typeof(r#>'{patient_communication,iFileId}')='number' and public.workflow_resolution_positive_read_id(r#>'{patient_communication,iFileId}') or jsonb_typeof(r#>'{patient_communication,iFileId}')='string' and coalesce(r#>>'{patient_communication,iFileId}','') ~ '^[1-9][0-9]*$')
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
revoke all on function public.workflow_resolution_positive_read_id(jsonb) from public,anon,authenticated;
grant execute on function public.workflow_resolution_positive_read_id(jsonb) to service_role;
revoke all on function public.workflow_resolution_response_container(jsonb) from public,anon,authenticated;
grant execute on function public.workflow_resolution_response_container(jsonb) to service_role;
commit;
