-- DESIGN FOR REVIEW ONLY. Not in supabase/migrations. Do not apply yet.
-- Run capture-rollback.sql FIRST and retain its complete output privately.
-- Requires an owner that can read user_roles/user_status independently of RLS.
-- No patient backfill. Existing policies remain, constrained by RESTRICTIVE guards.
begin;
set local lock_timeout = '5s';
-- Refuse execution until aggregate preflight and role-source decisions are reviewed.
-- This custom transaction-local setting is an operator acknowledgement, not auth.
-- Before future approved execution: SET LOCAL billing_v1.preflight_reviewed='yes';
do $$
declare tab text; fingerprint text; marker text;
begin
  if current_user <> 'postgres' or not exists(select 1 from pg_roles where rolname='postgres' and (rolsuper or rolbypassrls)) then
    raise exception 'Expected trusted postgres migration owner with RLS bypass';
  end if;
  foreach tab in array array['imports','import_rows_raw','import_rows_normalized','billing_period_imports','patient_financial_entries','billing_detail_entries','user_roles','user_status'] loop
    if not exists(select 1 from pg_class where oid=to_regclass('public.'||tab) and relkind='r') then
      raise exception 'Incomplete/unexpected target relation baseline';
    end if;
    execute format('lock table public.%I in access exclusive mode',tab);
  end loop;
  if exists(select 1 from pg_proc where pronamespace='public'::regnamespace and proname='billing_access_level_v1') then
    if (select count(*) from pg_proc where pronamespace='public'::regnamespace and proname='billing_access_level_v1')<>1
      or to_regprocedure('public.billing_access_level_v1()') is null then
      raise exception 'Unexpected helper overload collision';
    end if;
    if exists(select 1 from pg_policy where polname like 'billing\_v1\_%' escape '\'
      and polrelid<>all(array['public.imports'::regclass,'public.import_rows_raw'::regclass,'public.import_rows_normalized'::regclass,'public.billing_period_imports'::regclass,'public.patient_financial_entries'::regclass,'public.billing_detail_entries'::regclass])) then
      raise exception 'Unexpected reserved policy outside target relations';
    end if;
    marker := obj_description(to_regprocedure('public.billing_access_level_v1()'),'pg_proc');
    select md5(string_agg(v, E'\n' order by v)) into fingerprint from (
 select pg_get_functiondef(p.oid)||p.proowner::text||coalesce(p.proacl::text,'') as v
 from pg_proc p where p.oid=to_regprocedure('public.billing_access_level_v1()')
 union all select c.relname||c.relowner::text||c.relrowsecurity::text||c.relforcerowsecurity::text||coalesce(c.relacl::text,'')
 from pg_class c where c.oid=any(array(select to_regclass('public.'||t) from unnest(array['imports','import_rows_raw','import_rows_normalized','billing_period_imports','patient_financial_entries','billing_detail_entries','user_roles','user_status']) t))
 union all select a.attrelid::text||a.attname||coalesce(a.attacl::text,'')
 from pg_attribute a where a.attrelid=any(array(select to_regclass('public.'||t) from unnest(array['imports','import_rows_raw','import_rows_normalized','billing_period_imports','patient_financial_entries','billing_detail_entries','user_roles','user_status']) t)) and a.attnum>0 and not a.attisdropped
 union all select p.polrelid::text||p.polname||p.polcmd::text||p.polpermissive::text||p.polroles::text||coalesce(p.polqual::text,'')||coalesce(p.polwithcheck::text,'')
 from pg_policy p where p.polrelid=any(array(select to_regclass('public.'||t) from unnest(array['imports','import_rows_raw','import_rows_normalized','billing_period_imports','patient_financial_entries','billing_detail_entries','user_roles','user_status']) t))
 union all select r.rolname||r.rolsuper::text||r.rolbypassrls::text||r.rolcreaterole::text||r.rolinherit::text from pg_roles r
 union all select 'membership:'||to_jsonb(m)::text from pg_auth_members m
 union all select n.nspname||n.nspowner::text||coalesce(n.nspacl::text,'') from pg_namespace n where n.nspname in ('public','auth')
 union all select pg_get_functiondef(p.oid)||p.proowner::text||coalesce(p.proacl::text,'') from pg_proc p where p.oid='auth.uid()'::regprocedure
) q;
    if marker='billing_v1:revision2:complete:'||fingerprint then
      raise exception 'billing_v1 revision2 already applied; no changes made';
    end if;
    raise exception 'Existing helper is unexpected, partial, or drifted; no replacement allowed';
  end if;
  if exists(select 1 from pg_policy where polname like 'billing\_v1\_%' escape '\') then
    raise exception 'Existing billing_v1 policies indicate collision/partial state';
  end if;
  if current_setting('billing_v1.preflight_reviewed',true) is distinct from 'yes'
    or current_setting('billing_v1.canonical_billing_reviewed',true) is distinct from 'yes' then
    raise exception 'Review aggregate status/role preflight before enabling database policies';
  end if;
end $$;

-- Preflight: all eight tables require CRUD (including admin account deletion).
do $$
declare tab text; op text;
begin
  if not exists(select 1 from pg_roles where rolname='service_role' and rolbypassrls and not rolsuper) then
    raise exception 'Expected service_role RLS bypass configuration';
  end if;
  if not has_schema_privilege('service_role','public','USAGE') then raise exception 'Service schema access missing'; end if;
  foreach tab in array array['imports','import_rows_raw','import_rows_normalized','billing_period_imports','patient_financial_entries','billing_detail_entries','user_roles','user_status'] loop
    foreach op in array array['SELECT','INSERT','UPDATE','DELETE'] loop
      if not has_table_privilege('service_role','public.'||tab,op) then
        raise exception 'Required effective service-role CRUD missing';
      end if;
    end loop;
  end loop;
end $$;

-- Permission-bearing sources must not be directly client writable. This includes
-- TRUNCATE, which RLS does not protect. Preserve authenticated SELECT and service-role access.
revoke select on public.user_roles from anon;
revoke select on public.user_status from anon;
do $$
declare tab text; cols text;
begin
  foreach tab in array array['user_roles','user_status'] loop
    execute format('revoke insert, update, delete, truncate, references, trigger on public.%I from public, anon, authenticated',tab);
    select string_agg(quote_ident(attname),',') into cols from pg_attribute
      where attrelid=to_regclass('public.'||tab) and attnum>0 and not attisdropped;
    execute format('revoke insert (%s), update (%s), references (%s) on public.%I from public, anon, authenticated',cols,cols,cols,tab);
  end loop;
end $$;

-- No caller-supplied user ID or role. Roles are enum-cast to text, not profiles.
-- Strict active status: exactly one row with is_active IS TRUE is required.
-- Missing/duplicate/null/inactive status and query errors deny access.
-- No PII or upstream errors emitted.
create function public.billing_access_level_v1()
returns integer language plpgsql stable security definer
set search_path = pg_catalog, pg_temp as $$
declare uid uuid := auth.uid(); active boolean; matches bigint; level integer;
begin
  if uid is null then return 0; end if;
  select count(*), bool_and(s.is_active is true) into matches,active
    from public.user_status s where s.user_id=uid;
  if matches <> 1 or active is not true then return 0; end if;
  select coalesce(max(case when r.role::text in ('admin','super_admin') then 2
    when r.role::text in ('staff','billing_staff','practice_manager') then 1 else 0 end),0)
    into level from public.user_roles r where r.user_id=uid;
  return level;
exception when others then return 0;
end $$;
alter function public.billing_access_level_v1() owner to postgres;
revoke all on function public.billing_access_level_v1() from public,anon;
grant execute on function public.billing_access_level_v1() to authenticated,service_role;

-- Normalize client privileges, including column ACLs. Owner/service ACLs retained.
-- patient_cost_entries deliberately EXCLUDED pending its actual schema/consumers.
do $$
declare tab text; cols text;
begin
  foreach tab in array array['imports','import_rows_raw','import_rows_normalized',
    'billing_period_imports','patient_financial_entries','billing_detail_entries'] loop
    execute format('alter table public.%I enable row level security',tab);
    execute format('revoke all on public.%I from public, anon, authenticated',tab);
    select string_agg(quote_ident(attname),',') into cols from pg_attribute
      where attrelid=to_regclass('public.'||tab) and attnum>0 and not attisdropped;
    execute format('revoke select (%s), insert (%s), update (%s), references (%s) on public.%I from public, anon, authenticated',cols,cols,cols,cols,tab);
    -- A restrictive false gate protects against old permissive policies even if
    -- anon later receives a table grant accidentally. No grant is added to anon.
    execute format('create policy billing_v1_anon_deny on public.%I as restrictive for all to anon using (false) with check (false)',tab);
  end loop;
end $$;

-- Server-only imported source/normalized data. Existing service-role privileges
-- are preserved, never revoked. Existing authenticated policies cannot bypass this.
do $$
declare tab text;
begin
  foreach tab in array array['imports','import_rows_raw','import_rows_normalized'] loop
    execute format('create policy billing_v1_server_only on public.%I as restrictive for all to authenticated using (false) with check (false)',tab);
  end loop;
end $$;

grant select on public.billing_period_imports to authenticated;
create policy billing_v1_read on public.billing_period_imports for select to authenticated
using ((select public.billing_access_level_v1())=2);
create policy billing_v1_role_guard on public.billing_period_imports as restrictive for select to authenticated
using ((select public.billing_access_level_v1())=2);
create policy billing_v1_no_insert on public.billing_period_imports as restrictive for insert to authenticated with check (false);
create policy billing_v1_no_update on public.billing_period_imports as restrictive for update to authenticated using (false) with check (false);
create policy billing_v1_no_delete on public.billing_period_imports as restrictive for delete to authenticated using (false);

-- Staff can work across providers as the existing entry screens require.
-- provider_readonly/typist do not receive patient-level billing access.
grant select on public.patient_financial_entries,public.billing_detail_entries to authenticated;
grant insert (provider_id,related_provider_id,billing_period_id,patient_name,entry_date,category,amount,notes)
  on public.patient_financial_entries to authenticated;
grant update (provider_id,related_provider_id,billing_period_id,patient_name,entry_date,category,amount,notes,deleted_at,deleted_by)
  on public.patient_financial_entries to authenticated;
grant insert (provider_id,billing_period_id,patient_name,entry_date,category,amount,notes)
  on public.billing_detail_entries to authenticated;
grant update (provider_id,billing_period_id,patient_name,entry_date,category,amount,notes,deleted_at,deleted_by)
  on public.billing_detail_entries to authenticated;

do $$
declare tab text;
begin
  foreach tab in array array['patient_financial_entries','billing_detail_entries'] loop
    -- An explicit permissive policy supplies access if the historical ones are
    -- removed later. Restrictive policies enforce the ceiling while they remain.
    execute format('create policy billing_v1_role_guard on public.%I as restrictive for all to authenticated using ((select public.billing_access_level_v1())>=1) with check ((select public.billing_access_level_v1())>=1)',tab);
    execute format('create policy billing_v1_read on public.%I for select to authenticated using ((select public.billing_access_level_v1())>=1)',tab);
    execute format('create policy billing_v1_insert on public.%I for insert to authenticated with check ((select public.billing_access_level_v1())>=1)',tab);
    execute format('create policy billing_v1_update on public.%I for update to authenticated using ((select public.billing_access_level_v1())>=1) with check ((select public.billing_access_level_v1())>=1)',tab);
    execute format('create policy billing_v1_no_delete on public.%I as restrictive for delete to authenticated using (false)',tab);
  end loop;
end $$;
create policy billing_v1_review_update on public.patient_financial_entries as restrictive for update to authenticated
using (is_review_locked is not true and deleted_at is null and deleted_by is null)
with check (is_review_locked is not true and ((deleted_at is null and deleted_by is null) or (deleted_at is not null and deleted_by=auth.uid())));
create policy billing_v1_review_insert on public.patient_financial_entries as restrictive for insert to authenticated
with check (is_review_locked is not true and is_verified is not true and deleted_at is null and deleted_by is null);
create policy billing_v1_delete_attribution on public.billing_detail_entries as restrictive for update to authenticated
using (deleted_at is null and deleted_by is null)
with check ((deleted_at is null and deleted_by is null) or (deleted_at is not null and deleted_by=auth.uid()));
create policy billing_v1_active_insert on public.billing_detail_entries as restrictive for insert to authenticated
with check (deleted_at is null and deleted_by is null);
-- Existing screens SELECT with deleted_at IS NULL. Retain authorized SQL SELECT
-- visibility to avoid changing UPDATE/RETURNING behavior; deletion is not erasure.
-- No browser restoration: already deleted/inconsistently attributed rows cannot UPDATE.

-- Abort on inherited/table/column grants that would bypass the intended ACLs.
do $$
declare tab text; col record; rol text;
begin
  foreach tab in array array['imports','import_rows_raw','import_rows_normalized',
    'billing_period_imports','patient_financial_entries','billing_detail_entries'] loop
    if has_table_privilege('anon','public.'||tab,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER') then
      raise exception 'Unexpected inherited anonymous privileges; migration rolled back';
    end if;
    for col in select attname from pg_attribute where attrelid=to_regclass('public.'||tab) and attnum>0 and not attisdropped loop
      if has_column_privilege('anon','public.'||tab,col.attname,'SELECT,INSERT,UPDATE,REFERENCES') then
        raise exception 'Unexpected inherited anonymous column privileges; migration rolled back';
      end if;
      if has_column_privilege('authenticated','public.'||tab,col.attname,'REFERENCES')
        or (tab in ('imports','import_rows_raw','import_rows_normalized')
          and has_column_privilege('authenticated','public.'||tab,col.attname,'SELECT'))
        or (has_column_privilege('authenticated','public.'||tab,col.attname,'INSERT') and not (
          tab in ('patient_financial_entries','billing_detail_entries') and
          (col.attname = any(array['provider_id','billing_period_id','patient_name','entry_date','category','amount','notes'])
            or (tab='patient_financial_entries' and col.attname='related_provider_id'))))
        or (has_column_privilege('authenticated','public.'||tab,col.attname,'UPDATE') and not (
          tab in ('patient_financial_entries','billing_detail_entries') and
          (col.attname = any(array['provider_id','billing_period_id','patient_name','entry_date','category','amount','notes','deleted_at','deleted_by'])
            or (tab='patient_financial_entries' and col.attname='related_provider_id')))) then
        raise exception 'Unexpected inherited authenticated column privileges; migration rolled back';
      end if;
    end loop;
    if has_table_privilege('authenticated','public.'||tab,'INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER') then
      raise exception 'Unexpected inherited browser mutation privileges; migration rolled back';
    end if;
  end loop;
  foreach tab in array array['user_roles','user_status'] loop
    if has_table_privilege('anon','public.'||tab,'SELECT')
      or has_any_column_privilege('anon','public.'||tab,'SELECT') then
      raise exception 'Permission sources remain anonymously readable; migration rolled back';
    end if;
    foreach rol in array array['anon','authenticated'] loop
      if has_table_privilege(rol,'public.'||tab,'INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER') then
        raise exception 'Permission sources remain client writable; migration rolled back';
      end if;
      for col in select attname from pg_attribute where attrelid=to_regclass('public.'||tab) and attnum>0 and not attisdropped loop
        if has_column_privilege(rol,'public.'||tab,col.attname,'INSERT,UPDATE,REFERENCES') then
          raise exception 'Permission-source columns remain client writable; migration rolled back';
        end if;
      end loop;
    end loop;
  end loop;
end $$;

-- Function and trust-boundary postconditions: direct plus inherited capabilities.
do $$
declare client text; tab text; f oid := 'public.billing_access_level_v1()'::regprocedure; owner_id oid;
begin
  select proowner into owner_id from pg_proc where oid=f;
  if owner_id <> 'postgres'::regrole or not exists(select 1 from pg_proc where oid=f and prosecdef and provolatile='s'
    and proconfig=array['search_path=pg_catalog, pg_temp']) then raise exception 'Helper definition/owner mismatch'; end if;
  foreach client in array array['anon','authenticated'] loop
    if exists(select 1 from pg_roles where rolname=client and (rolsuper or rolbypassrls or rolcreaterole))
      or pg_has_role(client,owner_id,'MEMBER') or pg_has_role(client,'service_role','MEMBER')
      or pg_has_role(client,(select proowner from pg_proc where oid='auth.uid()'::regprocedure),'MEMBER')
      or has_schema_privilege(client,'public','CREATE') or has_schema_privilege(client,'auth','CREATE') then
      raise exception 'Client can bypass or replace trusted policy dependencies';
    end if;
    foreach tab in array array['imports','import_rows_raw','import_rows_normalized','billing_period_imports','patient_financial_entries','billing_detail_entries','user_roles','user_status'] loop
      if pg_has_role(client,(select relowner from pg_class where oid=to_regclass('public.'||tab)),'MEMBER') then
        raise exception 'Client inherits target ownership';
      end if;
    end loop;
  end loop;
  if has_function_privilege('anon',f,'EXECUTE') then raise exception 'Anonymous helper execution remains'; end if;
  if not has_function_privilege('authenticated',f,'EXECUTE')
    or has_function_privilege('authenticated',f,'EXECUTE WITH GRANT OPTION') then raise exception 'Unexpected authenticated helper privilege'; end if;
  if exists(select 1 from pg_proc p cross join lateral aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) x
    where p.oid=f and (x.grantee=0 or x.grantee not in (owner_id,'authenticated'::regrole,'service_role'::regrole))) then
    raise exception 'Unexpected helper ACL including PUBLIC/default grants';
  end if;
  foreach tab in array array['user_roles','user_status'] loop
    if not has_table_privilege('postgres','public.'||tab,'SELECT') then raise exception 'Helper owner cannot read dependencies'; end if;
  end loop;
  if not has_function_privilege('postgres','auth.uid()','EXECUTE') then raise exception 'Helper identity dependency unavailable'; end if;
end $$;

-- Recheck service permissions after PUBLIC/client revocations.
do $$
declare tab text; op text;
begin
  if not exists(select 1 from pg_roles where rolname='service_role' and rolbypassrls and not rolsuper) then
    raise exception 'Expected service_role RLS bypass configuration';
  end if;
  if not has_schema_privilege('service_role','public','USAGE') then raise exception 'Service schema access missing'; end if;
  foreach tab in array array['imports','import_rows_raw','import_rows_normalized','billing_period_imports','patient_financial_entries','billing_detail_entries','user_roles','user_status'] loop
    foreach op in array array['SELECT','INSERT','UPDATE','DELETE'] loop
      if not has_table_privilege('service_role','public.'||tab,op) then
        raise exception 'Required effective service-role CRUD missing';
      end if;
    end loop;
  end loop;
end $$;

-- Completion marker written only after all assertions; no new state table.
do $$ declare fingerprint text; begin
select md5(string_agg(v, E'\n' order by v)) into fingerprint from (
 select pg_get_functiondef(p.oid)||p.proowner::text||coalesce(p.proacl::text,'') as v
 from pg_proc p where p.oid=to_regprocedure('public.billing_access_level_v1()')
 union all select c.relname||c.relowner::text||c.relrowsecurity::text||c.relforcerowsecurity::text||coalesce(c.relacl::text,'')
 from pg_class c where c.oid=any(array(select to_regclass('public.'||t) from unnest(array['imports','import_rows_raw','import_rows_normalized','billing_period_imports','patient_financial_entries','billing_detail_entries','user_roles','user_status']) t))
 union all select a.attrelid::text||a.attname||coalesce(a.attacl::text,'')
 from pg_attribute a where a.attrelid=any(array(select to_regclass('public.'||t) from unnest(array['imports','import_rows_raw','import_rows_normalized','billing_period_imports','patient_financial_entries','billing_detail_entries','user_roles','user_status']) t)) and a.attnum>0 and not a.attisdropped
 union all select p.polrelid::text||p.polname||p.polcmd::text||p.polpermissive::text||p.polroles::text||coalesce(p.polqual::text,'')||coalesce(p.polwithcheck::text,'')
 from pg_policy p where p.polrelid=any(array(select to_regclass('public.'||t) from unnest(array['imports','import_rows_raw','import_rows_normalized','billing_period_imports','patient_financial_entries','billing_detail_entries','user_roles','user_status']) t))
 union all select r.rolname||r.rolsuper::text||r.rolbypassrls::text||r.rolcreaterole::text||r.rolinherit::text from pg_roles r
 union all select 'membership:'||to_jsonb(m)::text from pg_auth_members m
 union all select n.nspname||n.nspowner::text||coalesce(n.nspacl::text,'') from pg_namespace n where n.nspname in ('public','auth')
 union all select pg_get_functiondef(p.oid)||p.proowner::text||coalesce(p.proacl::text,'') from pg_proc p where p.oid='auth.uid()'::regprocedure
) q;
execute format('comment on function public.billing_access_level_v1() is %L','billing_v1:revision2:complete:'||fingerprint);
end $$;
commit;
