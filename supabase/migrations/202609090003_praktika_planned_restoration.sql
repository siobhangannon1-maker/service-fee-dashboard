-- Planned-shutdown intents only. No historical sessions are backfilled.
begin;
create table public.praktika_helper_restorations (
  session_id uuid primary key references public.praktika_sessions(id) on delete cascade,
  source_instance_id uuid not null,
  requested_at timestamptz not null,
  expires_at timestamptz not null,
  idle_deadline_at timestamptz not null,
  consumed_at timestamptz,
  consumed_instance_id uuid,
  check ((consumed_at is null) = (consumed_instance_id is null))
);
alter table public.praktika_helper_restorations enable row level security;
revoke all on public.praktika_helper_restorations from public, anon, authenticated;
grant select, insert, update, delete on public.praktika_helper_restorations to service_role;

-- Session row is always locked before its intent: same lock order in both RPCs
-- and this trigger. Explicit staff requests/challenges supersede warm restoration.
create function public.invalidate_praktika_restoration()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if new.status in ('refresh_requested','waiting_for_credentials','waiting_for_mfa','error','expired')
    or new.pending_praktika_username is distinct from old.pending_praktika_username
    or new.pending_praktika_password is distinct from old.pending_praktika_password then
    delete from public.praktika_helper_restorations where session_id = new.id;
  elsif new.helper_instance_id is not null and new.helper_instance_id is distinct from old.helper_instance_id then
    delete from public.praktika_helper_restorations where session_id = new.id
      and consumed_instance_id is distinct from new.helper_instance_id;
  end if;
  return new;
end $$;
create trigger invalidate_praktika_restoration
  after update of status, helper_instance_id, pending_praktika_username, pending_praktika_password
  on public.praktika_sessions for each row execute function public.invalidate_praktika_restoration();

-- Caller has stopped work and closed Chromium. Remaining useful-work lifetime
-- is measured by the helper; durable deadlines and expiry use the database clock.
create function public.request_praktika_restoration(p_session_id uuid, p_instance_id uuid, p_idle_remaining_ms bigint)
returns boolean language plpgsql security invoker set search_path = public, pg_temp as $$
declare s public.praktika_sessions%rowtype; t timestamptz; idle_deadline timestamptz;
begin
  select * into s from public.praktika_sessions where id = p_session_id for update;
  t := clock_timestamp();
  if not found or p_instance_id is null or s.helper_instance_id is distinct from p_instance_id
    or s.helper_heartbeat_at is null or s.helper_heartbeat_at <= t - interval '90 seconds'
    or s.status <> 'connected' or p_idle_remaining_ms is null or p_idle_remaining_ms <= 0
    or exists (select 1 from public.praktika_helper_jobs where status = 'processing'
      and app_user_id is not distinct from s.app_user_id) then return false; end if;
  idle_deadline := t + least(p_idle_remaining_ms, 5400000) * interval '1 millisecond';
  -- Existing generation-fenced release clears ownership/proof, preserves cookies.
  if not public.praktika_helper_write(p_session_id, p_instance_id, 'release') then return false; end if;
  insert into public.praktika_helper_restorations
    (session_id, source_instance_id, requested_at, expires_at, idle_deadline_at)
    values (p_session_id, p_instance_id, t, least(t + interval '10 minutes', idle_deadline), idle_deadline)
    on conflict (session_id) do update set source_instance_id = excluded.source_instance_id,
      requested_at = excluded.requested_at, expires_at = excluded.expires_at,
      idle_deadline_at = excluded.idle_deadline_at, consumed_at = null, consumed_instance_id = null;
  return true;
end $$;

create function public.claim_praktika_restoration(p_session_id uuid, p_source_instance_id uuid)
returns jsonb language plpgsql security invoker set search_path = public, pg_temp as $$
declare s public.praktika_sessions%rowtype; r public.praktika_helper_restorations%rowtype;
  t timestamptz; owner_id uuid := gen_random_uuid();
begin
  select * into s from public.praktika_sessions where id = p_session_id for update;
  if not found then return null; end if;
  select * into r from public.praktika_helper_restorations where session_id = p_session_id for update;
  t := clock_timestamp();
  if not found or r.source_instance_id is distinct from p_source_instance_id or r.consumed_at is not null
    or r.expires_at <= t or r.idle_deadline_at <= t or s.status <> 'not_started'
    or s.helper_instance_id is not null
    or exists (select 1 from public.praktika_helper_jobs where status = 'processing'
      and app_user_id is not distinct from s.app_user_id) then return null; end if;
  update public.praktika_helper_restorations set consumed_at = t, consumed_instance_id = owner_id
    where session_id = p_session_id;
  update public.praktika_sessions set helper_instance_id = owner_id, helper_heartbeat_at = t,
    authenticated_at = null, status = 'refreshing', updated_at = t,
    message = 'Cloud Praktika helper is starting.' where id = p_session_id;
  return jsonb_build_object('instance_id', owner_id,
    'idle_remaining_ms', floor(extract(epoch from (r.idle_deadline_at - clock_timestamp())) * 1000));
end $$;
revoke all on function public.invalidate_praktika_restoration() from public, anon, authenticated;
revoke all on function public.request_praktika_restoration(uuid,uuid,bigint) from public, anon, authenticated;
revoke all on function public.claim_praktika_restoration(uuid,uuid) from public, anon, authenticated;
grant execute on function public.request_praktika_restoration(uuid,uuid,bigint) to service_role;
grant execute on function public.claim_praktika_restoration(uuid,uuid) to service_role;
commit;
