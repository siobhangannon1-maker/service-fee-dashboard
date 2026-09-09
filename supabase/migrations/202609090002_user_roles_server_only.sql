-- Role writes are server-only. Deploy the authorized admin role route before applying.
begin;
alter table public.user_roles enable row level security;
revoke insert, update, delete, truncate, references, trigger
  on table public.user_roles from public, anon, authenticated;
do $$
declare columns_sql text;
begin
  select string_agg(quote_ident(attname), ', ' order by attnum) into columns_sql
  from pg_attribute where attrelid = 'public.user_roles'::regclass
    and attnum > 0 and not attisdropped;
  execute format('revoke insert (%s), update (%s), references (%s) on table public.user_roles from public, anon, authenticated',
    columns_sql, columns_sql, columns_sql);
  -- Reject unexpected inherited mutation privileges rather than silently leaving
  -- a route around the server authorization. No row data is read.
  if exists (
    select 1 from pg_attribute
    where attrelid = 'public.user_roles'::regclass and attnum > 0 and not attisdropped
      and (has_column_privilege('anon', 'public.user_roles', attname, 'INSERT,UPDATE')
        or has_column_privilege('authenticated', 'public.user_roles', attname, 'INSERT,UPDATE'))
  ) or has_table_privilege('anon', 'public.user_roles', 'DELETE,TRUNCATE')
    or has_table_privilege('authenticated', 'public.user_roles', 'DELETE,TRUNCATE') then
    raise exception 'Client role mutation privileges remain; review role inheritance before rollout';
  end if;
end $$;
grant select, insert, update, delete on table public.user_roles to service_role;

drop policy if exists "authenticated users can insert roles" on public.user_roles;
drop policy if exists "authenticated users can update roles" on public.user_roles;
-- Preserve existing SELECT grants/policies and the staff default. No role rows changed.
commit;
