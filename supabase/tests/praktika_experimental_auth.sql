-- Isolated PostgreSQL only: run against an empty disposable database.
\set ON_ERROR_STOP on
create role anon;
create role authenticated;
create role service_role;
create table public.praktika_sessions (
 id uuid primary key, helper_instance_id uuid, helper_heartbeat_at timestamptz,
 authenticated_at timestamptz, status text, pending_praktika_username text,
 pending_praktika_password text
);
grant select, insert, update, delete on public.praktika_sessions to service_role;
\ir ../migrations/202609120001_praktika_experimental_auth.sql
insert into public.praktika_sessions(id, helper_instance_id, helper_heartbeat_at, authenticated_at, status)
values ('00000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000002',clock_timestamp(), '2020-01-01', 'connected');
do $$
declare sid uuid := '00000000-0000-4000-8000-000000000001'; owner uuid := '00000000-0000-4000-8000-000000000002'; r public.praktika_sessions%rowtype;
begin
 select * into r from public.praktika_sessions where id=sid;
 assert r.experimental_auth_at is null, 'nullable old insert compatibility';
 assert public.record_praktika_experimental_auth(sid, owner, 'eligible_307'), 'current owner accepted';
 select * into r from public.praktika_sessions where id=sid;
 assert r.authenticated_at = '2020-01-01'::timestamptz, '307 must not modify strict proof';
 assert r.experimental_auth_status='eligible_307' and r.experimental_helper_instance_id=owner and r.experimental_auth_at is not null, 'evidence bound';
 assert not public.record_praktika_experimental_auth(sid, gen_random_uuid(), 'eligible_307'), 'old owner rejected';
 update public.praktika_sessions set helper_heartbeat_at=clock_timestamp()-interval '91 seconds' where id=sid;
 assert not public.record_praktika_experimental_auth(sid, owner, 'eligible_307'), 'expired lease rejected';
 update public.praktika_sessions set helper_heartbeat_at=clock_timestamp(), status='waiting_for_mfa' where id=sid;
 assert not public.record_praktika_experimental_auth(sid, owner, 'eligible_307'), 'challenge race rejected';
 assert (select experimental_auth_at is null from public.praktika_sessions where id=sid), 'challenge invalidates';
 update public.praktika_sessions set status='refreshing' where id=sid;
 assert public.record_praktika_experimental_auth(sid, owner, 'eligible_307');
 update public.praktika_sessions set helper_instance_id=gen_random_uuid() where id=sid;
 assert (select experimental_auth_at is null from public.praktika_sessions where id=sid), 'generation invalidates';
 assert not has_function_privilege('authenticated','public.record_praktika_experimental_auth(uuid,uuid,text)','EXECUTE'), 'client RPC forbidden';
 assert has_function_privilege('service_role','public.record_praktika_experimental_auth(uuid,uuid,text)','EXECUTE'), 'server RPC permitted';
end $$;
