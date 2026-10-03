-- Candidate only: apply after separate production approval.
-- Existing rows remain unenrolled because next_attempt_at defaults to NULL.
begin;

alter table public.provider_report_edit_examples
  add column next_attempt_at timestamptz,
  add column claim_token uuid,
  add column lease_expires_at timestamptz;

create index edit_learning_due_idx
  on public.provider_report_edit_examples (next_attempt_at, id)
  where next_attempt_at is not null and analysis_status in ('pending', 'failed');

create index edit_learning_expired_idx
  on public.provider_report_edit_examples (lease_expires_at, id)
  where claim_token is not null and analysis_status = 'processing';

create function public.claim_typist_edit_learning(p_token uuid)
returns setof public.provider_report_edit_examples
language plpgsql security invoker
set search_path = ''
as $$
declare picked uuid;
begin
  if p_token is null then raise exception 'Claim token required'; end if;

  -- Do not block another worker's completion while reaping exhausted crashes.
  with exhausted as (
    select id from public.provider_report_edit_examples
    where next_attempt_at is not null and analysis_status = 'processing'
      and claim_token is not null and lease_expires_at <= clock_timestamp()
      and analysis_attempts >= 3
      and source in ('typist_direct_approval', 'typist_image_workspace_final_save',
        'typist_existing_draft_approval')
    order by lease_expires_at, id limit 50 for update skip locked
  )
  update public.provider_report_edit_examples e
  set analysis_status = 'failed', analysis_error = 'worker_lease_expired',
      next_attempt_at = null, claim_token = null, lease_expires_at = null,
      updated_at = clock_timestamp()
  from exhausted where e.id = exhausted.id;

  select e.id into picked from public.provider_report_edit_examples e
  where e.next_attempt_at is not null and e.analysis_attempts < 3
    and e.source in ('typist_direct_approval', 'typist_image_workspace_final_save',
      'typist_existing_draft_approval')
    and (
      (e.analysis_status in ('pending', 'failed') and e.claim_token is null
        and e.next_attempt_at <= clock_timestamp())
      or (e.analysis_status = 'processing' and e.claim_token is not null
        and e.lease_expires_at <= clock_timestamp())
    )
  order by e.next_attempt_at, e.id limit 1 for update skip locked;
  if picked is null then return; end if;

  return query update public.provider_report_edit_examples
  set analysis_status = 'processing', analysis_attempts = analysis_attempts + 1,
      analysis_error = null, claim_token = p_token,
      lease_expires_at = clock_timestamp() + interval '45 minutes',
      updated_at = clock_timestamp()
  where id = picked returning *;
end;
$$;

create function public.finish_typist_edit_learning(
  p_id uuid, p_token uuid, p_analysis jsonb, p_failure_code text, p_retryable boolean
)
returns boolean
language plpgsql security invoker
set search_path = ''
set lock_timeout = '5s'
as $$
declare
  e public.provider_report_edit_examples%rowtype;
  b jsonb;
  weight integer;
  increase integer;
  reusable boolean;
  -- ECMAScript String.trim whitespace, matching the existing clean() helper.
  trim_chars text := U&'\0009\000A\000B\000C\000D\0020\00A0\1680\2000\2001\2002\2003\2004\2005\2006\2007\2008\2009\200A\2028\2029\202F\205F\3000\FEFF';
begin
  select * into e from public.provider_report_edit_examples where id = p_id for update;
  if not found then return false; end if;
  if p_token is null or e.analysis_status <> 'processing'
    or e.claim_token is distinct from p_token or e.next_attempt_at is null
    or e.lease_expires_at is null or e.lease_expires_at <= clock_timestamp()
    or e.source not in ('typist_direct_approval', 'typist_image_workspace_final_save',
      'typist_existing_draft_approval') then return false; end if;

  if p_failure_code is not null then
    -- Only controlled, non-patient-bearing categories may be stored here.
    if p_failure_code not in ('invalid_saved_input', 'analysis_rejected',
      'learning_execution_failed', 'worker_configuration_missing') then
      raise exception 'Invalid failure category';
    end if;
    update public.provider_report_edit_examples
    set analysis_status = 'failed', analysis_error = p_failure_code,
        next_attempt_at = case when p_retryable and e.analysis_attempts < 3
          then clock_timestamp() + case when e.analysis_attempts = 1
            then interval '1 minute' else interval '5 minutes' end else null end,
        claim_token = null, lease_expires_at = null, updated_at = clock_timestamp()
    where id = e.id;
    return true;
  end if;

  if jsonb_typeof(p_analysis) is distinct from 'object'
    or jsonb_typeof(p_analysis->'reusable') is distinct from 'boolean'
    or jsonb_typeof(p_analysis->'behaviours') is distinct from 'array'
    or jsonb_typeof(p_analysis->'summary') is distinct from 'string'
    or not (p_analysis ? 'ignore_reason')
    or jsonb_typeof(p_analysis->'ignore_reason') not in ('string', 'null') then
    raise exception 'Invalid normalized analysis';
  end if;
  if jsonb_array_length(p_analysis->'behaviours') > 5 then
    raise exception 'Too many behaviours';
  end if;
  if e.provider_id is null or nullif(btrim(e.report_type), '') is null
    or nullif(btrim(e.original_text), '') is null
    or nullif(btrim(e.final_text), '') is null
    or btrim(e.original_text) = btrim(e.final_text) then
    raise exception 'Invalid saved input';
  end if;

  -- Validate every normalized behaviour before any mutation.
  for b in select value from jsonb_array_elements(p_analysis->'behaviours') loop
    if jsonb_typeof(b) is distinct from 'object'
      or jsonb_typeof(b->'behaviour_key') is distinct from 'string'
      or (b->>'behaviour_key') !~ '^[a-z0-9_]{1,120}$'
      or jsonb_typeof(b->'behaviour_text') is distinct from 'string'
      or nullif(btrim(b->>'behaviour_text'), '') is null
      or jsonb_typeof(b->'category') is distinct from 'string'
      or nullif(btrim(b->>'category'), '') is null
      or jsonb_typeof(b->'evidence_summary') is distinct from 'string'
      or nullif(btrim(b->>'evidence_summary'), '') is null
      or jsonb_typeof(b->'knowledge_type') is distinct from 'string'
      or (b->>'knowledge_type') not in ('behaviour', 'preferred_phrase', 'template_block')
      or jsonb_typeof(b->'confidence_delta') is distinct from 'number'
      or (b->>'confidence_delta') !~ '^[1-5]$'
      or not (b ?& array['preferred_phrase', 'template_block', 'applies_when'])
      or jsonb_typeof(b->'preferred_phrase') not in ('string', 'null')
      or jsonb_typeof(b->'template_block') not in ('string', 'null')
      or jsonb_typeof(b->'applies_when') not in ('string', 'null')
      or ((b->>'knowledge_type') <> 'preferred_phrase'
        and b->'preferred_phrase' <> 'null'::jsonb)
      or ((b->>'knowledge_type') <> 'template_block'
        and b->'template_block' <> 'null'::jsonb) then
      raise exception 'Invalid normalized behaviour';
    end if;
  end loop;

  reusable := (p_analysis->>'reusable')::boolean
    and jsonb_array_length(p_analysis->'behaviours') > 0;
  weight := case when e.editor_role = 'provider' then 12
    when e.editor_role = 'admin' then 9
    when e.editor_role = 'typist' and position('provider_approval' in lower(e.source)) > 0 then 9
    when e.editor_role = 'typist' then 6 when e.editor_role = 'staff' then 4 else 3 end;

  if reusable then
    for b in select value from jsonb_array_elements(p_analysis->'behaviours') loop
      increase := greatest(1, round(weight * (b->>'confidence_delta')::integer / 5.0)::integer);
      insert into public.provider_behaviours as existing (
        provider_id, report_type, behaviour_key, category, knowledge_type, behaviour_text,
        preferred_phrase, template_block, applies_when, evidence_summary,
        confidence, support_count, status, source, created_at, updated_at
      ) values (
        e.provider_id, e.report_type, b->>'behaviour_key', b->>'category',
        b->>'knowledge_type', b->>'behaviour_text', b->>'preferred_phrase',
        b->>'template_block', b->>'applies_when', b->>'evidence_summary',
        least(90, 45 + increase), 1, 'active', 'approved_edit_learning',
        clock_timestamp(), clock_timestamp()
      ) on conflict (provider_id, report_type, behaviour_key) do update set
        category = excluded.category, knowledge_type = excluded.knowledge_type,
        behaviour_text = excluded.behaviour_text, preferred_phrase = excluded.preferred_phrase,
        template_block = excluded.template_block, applies_when = excluded.applies_when,
        evidence_summary = concat_ws(' | ', nullif(btrim(existing.evidence_summary, trim_chars), ''),
          nullif(btrim(excluded.evidence_summary, trim_chars), '')),
        confidence = least(100, coalesce(nullif(existing.confidence, 0), 50) + increase),
        support_count = coalesce(nullif(existing.support_count, 0), 1) + 1,
        status = 'active', source = 'approved_edit_learning', updated_at = clock_timestamp();
    end loop;
  end if;

  update public.provider_report_edit_examples
  set analysis_status = case when reusable then 'processed' else 'ignored' end,
      analysis_json = p_analysis,
      analysis_error = case when reusable then null else p_analysis->>'ignore_reason' end,
      analysed_at = clock_timestamp(), next_attempt_at = null, claim_token = null,
      lease_expires_at = null, updated_at = clock_timestamp()
  where id = e.id;
  return true;
end;
$$;

revoke all on function public.claim_typist_edit_learning(uuid) from public, anon, authenticated;
revoke all on function public.finish_typist_edit_learning(uuid, uuid, jsonb, text, boolean)
  from public, anon, authenticated;
grant execute on function public.claim_typist_edit_learning(uuid) to service_role;
grant execute on function public.finish_typist_edit_learning(uuid, uuid, jsonb, text, boolean)
  to service_role;
commit;
