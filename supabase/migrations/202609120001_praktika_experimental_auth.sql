-- Temporary opt-in evidence, independent of strict authentication. No backfill.
begin;
alter table public.praktika_sessions
  add column experimental_auth_status text,
  add column experimental_auth_at timestamptz,
  add column experimental_helper_instance_id uuid;

create function public.invalidate_praktika_experimental_auth()
returns trigger language plpgsql security invoker set search_path = public, pg_temp as $$
begin
  if new.helper_instance_id is distinct from old.helper_instance_id
    or new.status in ('waiting_for_credentials','waiting_for_mfa','refresh_requested','error','expired','not_started')
    or new.pending_praktika_username is distinct from old.pending_praktika_username
    or new.pending_praktika_password is distinct from old.pending_praktika_password then
    new.experimental_auth_status := null;
    new.experimental_auth_at := null;
    new.experimental_helper_instance_id := null;
  end if;
  return new;
end $$;
create trigger invalidate_praktika_experimental_auth
  before update of helper_instance_id, status, pending_praktika_username, pending_praktika_password
  on public.praktika_sessions for each row execute function public.invalidate_praktika_experimental_auth();

create function public.record_praktika_experimental_auth(p_session_id uuid, p_instance_id uuid, p_status text)
returns boolean language plpgsql security invoker set search_path = public, pg_temp as $$
declare s public.praktika_sessions%rowtype; t timestamptz;
begin
  select * into s from public.praktika_sessions where id=p_session_id for update;
  t := clock_timestamp();
  if not found or p_instance_id is null or s.helper_instance_id is distinct from p_instance_id
    or s.helper_heartbeat_at is null or s.helper_heartbeat_at <= t - interval '90 seconds' then return false; end if;
  if p_status is null or p_status not in ('eligible_307','ineligible','challenge') then
    raise exception 'Invalid experimental evidence';
  end if;
  -- Staff challenges take precedence over an in-flight probe result.
  if p_status = 'eligible_307' and (s.status is null or s.status not in ('connected','refreshing')) then return false; end if;
  update public.praktika_sessions set experimental_auth_status=p_status,
    experimental_auth_at=t, experimental_helper_instance_id=p_instance_id where id=p_session_id;
  return true;
end $$;
revoke all on function public.invalidate_praktika_experimental_auth() from public, anon, authenticated;
revoke all on function public.record_praktika_experimental_auth(uuid,uuid,text) from public, anon, authenticated;
grant execute on function public.record_praktika_experimental_auth(uuid,uuid,text) to service_role;
do $$
begin
  if exists(select 1 from pg_attribute where attrelid='public.praktika_sessions'::regclass
    and attname in ('experimental_auth_status','experimental_auth_at','experimental_helper_instance_id')
    and (has_column_privilege('anon','public.praktika_sessions',attname,'INSERT,UPDATE')
      or has_column_privilege('authenticated','public.praktika_sessions',attname,'INSERT,UPDATE'))) then
    raise exception 'Experimental evidence must not be client writable';
  end if;
end $$;
commit;
