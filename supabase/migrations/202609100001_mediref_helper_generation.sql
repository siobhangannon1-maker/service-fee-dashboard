-- Current practice helper evidence only; never backfill historical authentication.
begin;
alter table public.mediref_sessions
  add column helper_stopping_at timestamptz,
  add column helper_instance_id uuid,
  add column helper_heartbeat_at timestamptz,
  add column helper_expires_at timestamptz,
  add column authenticated_instance_id uuid,
  add column authenticated_at timestamptz;

-- Staff reconnect/challenge writes invalidate proof without changing credentials storage.
create function public.invalidate_mediref_authentication()
returns trigger language plpgsql security invoker set search_path = public, pg_temp as $$
begin
  if new.helper_instance_id is distinct from old.helper_instance_id
    or new.status in ('refresh_requested','refreshing','waiting_for_credentials','waiting_for_mfa','expired','error','not_started') then
    new.authenticated_instance_id := null;
    new.authenticated_at := null;
  end if;
  return new;
end $$;
create trigger invalidate_mediref_authentication before update of status, helper_instance_id
  on public.mediref_sessions for each row execute function public.invalidate_mediref_authentication();

create function public.claim_mediref_helper(p_session_id uuid)
returns uuid language plpgsql security invoker set search_path = public, pg_temp as $$
declare owner_id uuid := gen_random_uuid(); t timestamptz := clock_timestamp();
begin
  update public.mediref_sessions set helper_stopping_at=null, helper_instance_id=owner_id, helper_heartbeat_at=t,
    helper_expires_at=t + interval '120 seconds', authenticated_instance_id=null, authenticated_at=null,
    status='refreshing', updated_at=t
  where id=p_session_id and scope='practice' and app_user_id is null
    and (helper_instance_id is null or helper_expires_at is null or helper_expires_at <= t);
  if not found then return null; end if;
  return owner_id;
end $$;

create function public.mediref_helper_write(p_session_id uuid, p_instance_id uuid,
  p_action text, p_values jsonb default '{}'::jsonb)
returns boolean language plpgsql security invoker set search_path = public, pg_temp as $$
declare s public.mediref_sessions%rowtype; n public.mediref_sessions%rowtype; t timestamptz;
begin
  select * into s from public.mediref_sessions where id=p_session_id for update;
  t := clock_timestamp();
  if not found or p_instance_id is null or s.helper_instance_id is distinct from p_instance_id
    or s.scope is distinct from 'practice' or s.app_user_id is not null
    or s.helper_expires_at is null or s.helper_expires_at <= t then return false; end if;
  if s.helper_stopping_at is not null and p_action not in ('stop','release') then return false; end if;
  if p_action='check' then return true; end if;
  if p_action='heartbeat' then
    update public.mediref_sessions set helper_heartbeat_at=t, helper_expires_at=t+interval '120 seconds' where id=p_session_id;
    return true;
  end if;
  if p_action in ('stop','release') then
    update public.mediref_sessions set helper_stopping_at=t, authenticated_at=null, authenticated_instance_id=null,
      helper_instance_id=case when p_action='release' then null else s.helper_instance_id end,
      helper_heartbeat_at=case when p_action='release' then null else s.helper_heartbeat_at end,
      helper_expires_at=case when p_action='release' then null else s.helper_expires_at end,
      status=case when s.status in ('waiting_for_credentials','waiting_for_mfa','error','refresh_requested') then s.status else 'not_started' end,
      updated_at=t where id=p_session_id;
    return true;
  end if;
  if p_action is null or p_action not in ('update','authenticate') or jsonb_typeof(p_values) is distinct from 'object' then raise exception 'Invalid helper action'; end if;
  if exists(select 1 from jsonb_object_keys(p_values) k where k not in
    ('status','message','cookie','current_url','mediref_email','pending_mediref_email','pending_mediref_password',
     'mfa_code','mfa_code_updated_at','refresh_requested_at','refreshed_at','last_used_at')) then raise exception 'Invalid helper field'; end if;
  select * into n from jsonb_populate_record(s,p_values);
  if p_action='update' and p_values->>'status'='connected' then raise exception 'Authentication action required'; end if;
  update public.mediref_sessions set status=case when p_action='authenticate' then 'connected' else n.status end,
    message=n.message, cookie=n.cookie, current_url=n.current_url, mediref_email=n.mediref_email,
    pending_mediref_email=n.pending_mediref_email, pending_mediref_password=n.pending_mediref_password,
    mfa_code=n.mfa_code, mfa_code_updated_at=n.mfa_code_updated_at,
    refresh_requested_at=n.refresh_requested_at, refreshed_at=case when p_action='authenticate' then t else n.refreshed_at end,
    last_used_at=n.last_used_at, updated_at=t,
    authenticated_instance_id=case when p_action='authenticate' then p_instance_id else s.authenticated_instance_id end,
    authenticated_at=case when p_action='authenticate' then t else s.authenticated_at end where id=p_session_id;
  return true;
end $$;
revoke all on function public.invalidate_mediref_authentication() from public,anon,authenticated;
revoke all on function public.claim_mediref_helper(uuid) from public,anon,authenticated;
revoke all on function public.mediref_helper_write(uuid,uuid,text,jsonb) from public,anon,authenticated;
grant execute on function public.claim_mediref_helper(uuid) to service_role;
grant execute on function public.mediref_helper_write(uuid,uuid,text,jsonb) to service_role;
-- Browser actions use authorized server routes. Preserve SELECT and service_role access.
alter table public.mediref_sessions enable row level security;
revoke insert, update, delete, truncate, references, trigger
  on public.mediref_sessions from public, anon, authenticated;
do $$
declare columns_sql text;
begin
  select string_agg(quote_ident(attname), ', ' order by attnum) into columns_sql
    from pg_attribute where attrelid='public.mediref_sessions'::regclass
      and attnum > 0 and not attisdropped;
  execute format('revoke insert (%s), update (%s), references (%s) on public.mediref_sessions from public, anon, authenticated',
    columns_sql, columns_sql, columns_sql);
  -- Effective privileges include inherited and table grants, independently of RLS.
  -- Check every column, including all six ownership/authentication fields.
  if exists (
    select 1 from pg_attribute
    where attrelid='public.mediref_sessions'::regclass and attnum > 0 and not attisdropped
      and (has_column_privilege('anon','public.mediref_sessions',attname,'INSERT,UPDATE,REFERENCES')
        or has_column_privilege('authenticated','public.mediref_sessions',attname,'INSERT,UPDATE,REFERENCES'))
  ) or has_table_privilege('anon','public.mediref_sessions','INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
    or has_table_privilege('authenticated','public.mediref_sessions','INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER') then
    raise exception 'MediRef evidence is client writable; review session grants before rollout';
  end if;
end $$;
commit;
