-- Phase 1A ownership plus Phase 1B authentication proof. Apply separately before deploying the new watcher/helper together.
-- No authentication proof is backfilled. Existing not_started is used for idle.
begin;
alter table public.praktika_sessions
  add column helper_instance_id uuid,
  add column helper_heartbeat_at timestamptz,
  add column authenticated_at timestamptz;

-- Session mutation is server-only. Credential/MFA/refresh UI uses authenticated
-- Next.js routes backed by service_role, not direct browser table writes.
-- Table revokes alone do not remove existing column grants.
revoke insert, update, delete, truncate, references, trigger
  on table public.praktika_sessions from public, anon, authenticated;
do $$
declare columns_sql text;
begin
  select string_agg(quote_ident(attname), ', ' order by attnum) into columns_sql
  from pg_attribute where attrelid = 'public.praktika_sessions'::regclass
    and attnum > 0 and not attisdropped;
  execute format('revoke insert (%s), update (%s), references (%s) on table public.praktika_sessions from public, anon, authenticated',
    columns_sql, columns_sql, columns_sql);
  -- Reject unexpected inherited mutation privileges rather than silently leaving
  -- a route around the lease/proof RPC. No row data is read.
  if exists (
    select 1 from pg_attribute
    where attrelid = 'public.praktika_sessions'::regclass and attnum > 0 and not attisdropped
      and (has_column_privilege('anon', 'public.praktika_sessions', attname, 'INSERT,UPDATE')
        or has_column_privilege('authenticated', 'public.praktika_sessions', attname, 'INSERT,UPDATE'))
  ) or has_table_privilege('anon', 'public.praktika_sessions', 'DELETE,TRUNCATE')
    or has_table_privilege('authenticated', 'public.praktika_sessions', 'DELETE,TRUNCATE') then
    raise exception 'Client session mutation privileges remain; review role inheritance before rollout';
  end if;
end $$;
grant select, insert, update, delete on table public.praktika_sessions to service_role;
-- Existing SELECT privileges and RLS policies are intentionally unchanged.

create function public.claim_praktika_helper(p_session_id uuid)
returns uuid language plpgsql security invoker set search_path = public, pg_temp as $$
declare v_owner uuid := gen_random_uuid();
begin
  update public.praktika_sessions set helper_instance_id = v_owner,
    helper_heartbeat_at = clock_timestamp(), authenticated_at = null,
    status = 'refreshing', updated_at = clock_timestamp(),
    message = 'Cloud Praktika helper is starting.'
  where id = p_session_id and (helper_instance_id is null or helper_heartbeat_at is null
    or helper_heartbeat_at <= clock_timestamp() - interval '90 seconds');
  if not found then return null; end if;
  return v_owner;
end $$;

-- All helper-owned writes use the same row lock and database-clock lease check.
-- p_values cannot write ownership or authentication proof, even for service-role callers.
create function public.praktika_helper_write(p_session_id uuid, p_instance_id uuid,
  p_action text, p_values jsonb default '{}'::jsonb)
returns boolean language plpgsql security invoker set search_path = public, pg_temp as $$
declare v_row public.praktika_sessions%rowtype; v_next public.praktika_sessions%rowtype;
begin
  select * into v_row from public.praktika_sessions where id = p_session_id for update;
  if not found or v_row.helper_instance_id is distinct from p_instance_id
    or p_instance_id is null or v_row.helper_heartbeat_at is null
    or v_row.helper_heartbeat_at <= clock_timestamp() - interval '90 seconds' then return false; end if;
  if p_action = 'check' then return true; end if;
  if p_action = 'heartbeat' then
    update public.praktika_sessions set helper_heartbeat_at = clock_timestamp() where id = p_session_id;
    return true;
  end if;
  -- Only the dedicated GST verifier may invoke these actions. Database clock,
  -- current generation and unexpired lease are checked above for both results.
  if p_action = 'authenticate' then
    update public.praktika_sessions set authenticated_at = clock_timestamp(),
      status = 'connected', message = 'Praktika authentication verified.',
      updated_at = clock_timestamp() where id = p_session_id;
    return true;
  end if;
  if p_action = 'authentication_failed' then
    update public.praktika_sessions set authenticated_at = null,
      status = case when p_values->>'status' = 'waiting_for_mfa' then 'waiting_for_mfa'
        when p_values->>'status' = 'waiting_for_credentials' then 'waiting_for_credentials' else 'error' end,
      message = 'Praktika authentication could not be verified. Reconnect before retrying work.',
      updated_at = clock_timestamp() where id = p_session_id;
    return true;
  end if;
  if p_action = 'release' then
    update public.praktika_sessions set helper_instance_id = null, helper_heartbeat_at = null,
      authenticated_at = null, updated_at = clock_timestamp(),
      status = case when status in ('error', 'waiting_for_credentials', 'waiting_for_mfa', 'refresh_requested') then status
        when p_values->>'status' = 'error' then 'error' else 'not_started' end,
      message = case when status in ('error', 'waiting_for_credentials', 'waiting_for_mfa', 'refresh_requested') then message
        when p_values->>'status' = 'error' then 'Cloud Praktika helper stopped unexpectedly.'
        else 'Praktika helper is idle. Saved session retained; reconnect or queue work to start it.' end
    where id = p_session_id;
    return true;
  end if;
  if p_action <> 'update' or jsonb_typeof(p_values) <> 'object' then raise exception 'Invalid helper action'; end if;
  if exists (select 1 from jsonb_object_keys(p_values) as keys(key) where key not in
    ('status','message','cookie','current_url','praktika_username','pending_praktika_username',
     'pending_praktika_password','mfa_code','mfa_code_updated_at','refresh_requested_at','refreshed_at','last_used_at'))
    then raise exception 'Invalid helper update field'; end if;
  select * into v_next from jsonb_populate_record(v_row, p_values);
  update public.praktika_sessions set status=v_next.status, message=v_next.message,
    cookie=v_next.cookie, current_url=v_next.current_url, praktika_username=v_next.praktika_username,
    pending_praktika_username=v_next.pending_praktika_username, pending_praktika_password=v_next.pending_praktika_password,
    mfa_code=v_next.mfa_code, mfa_code_updated_at=v_next.mfa_code_updated_at,
    refresh_requested_at=v_next.refresh_requested_at, refreshed_at=v_next.refreshed_at,
    last_used_at=v_next.last_used_at,
    authenticated_at=case when v_next.status in ('refreshing','refresh_requested','waiting_for_credentials','waiting_for_mfa','expired','error')
      then null else v_row.authenticated_at end,
    updated_at=clock_timestamp()
  where id=p_session_id;
  return true;
end $$;
revoke all on function public.claim_praktika_helper(uuid) from public, anon, authenticated;
revoke all on function public.praktika_helper_write(uuid,uuid,text,jsonb) from public, anon, authenticated;
grant execute on function public.claim_praktika_helper(uuid) to service_role;
grant execute on function public.praktika_helper_write(uuid,uuid,text,jsonb) to service_role;
commit;
