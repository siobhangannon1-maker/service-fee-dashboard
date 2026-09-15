-- DESIGN: READ-ONLY baseline capture. No SQL from output is executed here.
-- Run all statements as postgres. Save metadata AND all generated SQL rows.
-- Snapshot is repeatable-read; deployment must be in a controlled no-DDL window.
-- FULL HISTORICAL RESTORATION IS UNSAFE; output requires separate approval GUC.
begin transaction isolation level repeatable read read only;
do $$
declare tab text; op text;
begin
  if current_user <> 'postgres' then raise exception 'Trusted baseline capture required'; end if;
  foreach tab in array array['imports','import_rows_raw','import_rows_normalized','billing_period_imports',
    'patient_financial_entries','billing_detail_entries','user_roles','user_status'] loop
    if not exists(select 1 from pg_class where oid=to_regclass('public.'||tab) and relkind='r') then raise exception 'Incomplete relation baseline'; end if;
    foreach op in array array['SELECT','INSERT','UPDATE','DELETE'] loop
      if not has_table_privilege('service_role','public.'||tab,op) then raise exception 'Incomplete service CRUD baseline'; end if;
    end loop;
  end loop;
  if exists(select 1 from pg_proc where pronamespace='public'::regnamespace and proname='billing_access_level_v1')
    or exists(select 1 from pg_policy where polname like 'billing\_v1\_%' escape '\') then
    raise exception 'Not a pristine baseline: helper/policy collision or partial migration';
  end if;
  -- Generated GRANTs execute as postgres. Refuse unsupported grantor chains rather
  -- than silently producing an inexact ACL restoration or using CASCADE.
  if exists(
    select 1 from pg_class c cross join lateral aclexplode(coalesce(c.relacl,acldefault('r',c.relowner))) x
    where c.oid=any(array['public.imports'::regclass,'public.import_rows_raw'::regclass,'public.import_rows_normalized'::regclass,'public.billing_period_imports'::regclass,'public.patient_financial_entries'::regclass,'public.billing_detail_entries'::regclass,'public.user_roles'::regclass,'public.user_status'::regclass])
    and x.grantee in (0,'anon'::regrole,'authenticated'::regrole) and x.grantor <> 'postgres'::regrole
  ) or exists(
    select 1 from pg_attribute a cross join lateral aclexplode(a.attacl) x
    where a.attrelid=any(array['public.imports'::regclass,'public.import_rows_raw'::regclass,'public.import_rows_normalized'::regclass,'public.billing_period_imports'::regclass,'public.patient_financial_entries'::regclass,'public.billing_detail_entries'::regclass,'public.user_roles'::regclass,'public.user_status'::regclass])
    and x.grantee in (0,'anon'::regrole,'authenticated'::regrole) and x.grantor <> 'postgres'::regrole
  ) then raise exception 'Non-postgres grantor requires bespoke reviewed restoration'; end if;
  if not exists(select 1 from pg_roles where rolname='service_role' and rolbypassrls) then raise exception 'Service role baseline lacks bypass'; end if;
end $$;

-- Metadata snapshot: raw ACLs retain grantors; policies/owners/FORCE captured too.
with targets as (select c.* from pg_class c where c.oid=any(array[
 'public.imports'::regclass,'public.import_rows_raw'::regclass,'public.import_rows_normalized'::regclass,
 'public.billing_period_imports'::regclass,'public.patient_financial_entries'::regclass,
 'public.billing_detail_entries'::regclass,'public.user_roles'::regclass,'public.user_status'::regclass]))
select jsonb_build_object('captured_at',transaction_timestamp(),'database',current_database(),
 'helper_exists',false,'helper_owner',null,'helper_acl',null,
 'relations',(select jsonb_agg(jsonb_build_object('name',c.relname,'owner',pg_get_userbyid(c.relowner),
 'rls',c.relrowsecurity,'force_rls',c.relforcerowsecurity,'acl',c.relacl,
 'columns',(select jsonb_agg(jsonb_build_object('name',a.attname,'acl',a.attacl,'type',format_type(a.atttypid,a.atttypmod),'not_null',a.attnotnull) order by a.attnum) from pg_attribute a where a.attrelid=c.oid and a.attnum>0 and not a.attisdropped),
 'policies',(select jsonb_agg(to_jsonb(p)) from pg_policies p where p.schemaname='public' and p.tablename=c.relname),
 'service_crud',(select jsonb_object_agg(op,has_table_privilege('service_role',c.oid,op)) from unnest(array['SELECT','INSERT','UPDATE','DELETE']) op)
 ) order by c.relname) from targets c)) as baseline;

-- Save the following ordered rows separately as the emergency historical SQL.
with targets(name) as (values ('imports'),('import_rows_raw'),('import_rows_normalized'),
 ('billing_period_imports'),('patient_financial_entries'),('billing_detail_entries'),
 ('user_roles'),('user_status')),
rels as (select c.* from targets t join pg_class c on c.oid=to_regclass('public.'||t.name)),
principals as (select oid,quote_ident(rolname) as name from pg_roles where rolname in ('anon','authenticated')
 union all select 0::oid,'PUBLIC'),
lines(priority,sql) as (
 select 0,'begin;'
 union all select 1,'set local lock_timeout = ''5s'';'
 union all select 2,'do $approval$ begin if current_setting(''billing_v1.allow_unsafe_restore'',true) is distinct from ''yes'' then raise exception ''Unsafe historical restoration requires explicit approval''; end if; end $approval$;'
 union all select 3,format('lock table public.%I in access exclusive mode;',relname) from rels
 union all select 4,'do $version$ declare fingerprint text; begin select md5(string_agg(v, E''\n'' order by v)) into fingerprint from (
 select pg_get_functiondef(p.oid)||p.proowner::text||coalesce(p.proacl::text,'''') as v
 from pg_proc p where p.oid=to_regprocedure(''public.billing_access_level_v1()'')
 union all select c.relname||c.relowner::text||c.relrowsecurity::text||c.relforcerowsecurity::text||coalesce(c.relacl::text,'''')
 from pg_class c where c.oid=any(array(select to_regclass(''public.''||t) from unnest(array[''imports'',''import_rows_raw'',''import_rows_normalized'',''billing_period_imports'',''patient_financial_entries'',''billing_detail_entries'',''user_roles'',''user_status'']) t))
 union all select a.attrelid::text||a.attname||coalesce(a.attacl::text,'''')
 from pg_attribute a where a.attrelid=any(array(select to_regclass(''public.''||t) from unnest(array[''imports'',''import_rows_raw'',''import_rows_normalized'',''billing_period_imports'',''patient_financial_entries'',''billing_detail_entries'',''user_roles'',''user_status'']) t)) and a.attnum>0 and not a.attisdropped
 union all select p.polrelid::text||p.polname||p.polcmd::text||p.polpermissive::text||p.polroles::text||coalesce(p.polqual::text,'''')||coalesce(p.polwithcheck::text,'''')
 from pg_policy p where p.polrelid=any(array(select to_regclass(''public.''||t) from unnest(array[''imports'',''import_rows_raw'',''import_rows_normalized'',''billing_period_imports'',''patient_financial_entries'',''billing_detail_entries'',''user_roles'',''user_status'']) t))
 union all select r.rolname||r.rolsuper::text||r.rolbypassrls::text||r.rolcreaterole::text||r.rolinherit::text from pg_roles r
 union all select ''membership:''||to_jsonb(m)::text from pg_auth_members m
 union all select n.nspname||n.nspowner::text||coalesce(n.nspacl::text,'''') from pg_namespace n where n.nspname in (''public'',''auth'')
 union all select pg_get_functiondef(p.oid)||p.proowner::text||coalesce(p.proacl::text,'''') from pg_proc p where p.oid=''auth.uid()''::regprocedure
) q; if obj_description(to_regprocedure(''public.billing_access_level_v1()''),''pg_proc'') is distinct from ''billing_v1:revision2:complete:''||fingerprint then raise exception ''Revision2 state drifted or incomplete; inspect before rollback''; end if; end $version$;'

 union all
 select 10,format('drop policy if exists %I on public.%I;',p,c.relname)
 from rels c cross join unnest(array['billing_v1_anon_deny','billing_v1_server_only','billing_v1_read',
 'billing_v1_role_guard','billing_v1_no_insert','billing_v1_no_update','billing_v1_no_delete',
 'billing_v1_insert','billing_v1_update','billing_v1_review_update','billing_v1_review_insert',
 'billing_v1_delete_attribution','billing_v1_active_insert']) p where c.relname not in ('user_roles','user_status')
 union all select 20,'drop function if exists public.billing_access_level_v1();'
 union all select 30,format('revoke all on public.%I from public,anon,authenticated;',relname) from rels
 union all select 31,format('revoke select (%s), insert (%s), update (%s), references (%s) on public.%I from public,anon,authenticated;',
 cols,cols,cols,cols,relname) from (
 select c.relname,string_agg(quote_ident(a.attname),',' order by a.attnum) as cols
 from rels c join pg_attribute a on a.attrelid=c.oid and a.attnum>0 and not a.attisdropped group by c.relname) q
 union all
 select 40,format('grant %s on public.%I to %s%s;',x.privilege_type,c.relname,p.name,
 case when x.is_grantable then ' with grant option' else '' end)
 from rels c cross join lateral aclexplode(coalesce(c.relacl,acldefault('r',c.relowner))) x
 join principals p on p.oid=x.grantee
 union all
 select 41,format('grant %s (%I) on public.%I to %s%s;',x.privilege_type,a.attname,c.relname,p.name,
 case when x.is_grantable then ' with grant option' else '' end)
 from rels c join pg_attribute a on a.attrelid=c.oid and a.attnum>0 and not a.attisdropped
 cross join lateral aclexplode(a.attacl) x join principals p on p.oid=x.grantee
 union all
 select 50,format('alter table public.%I %s row level security;',relname,case when relrowsecurity then 'enable' else 'disable' end)
 from rels
 union all select 51,format('alter table public.%I %s force row level security;',relname,case when relforcerowsecurity then '' else 'no' end) from rels
 union all select 100,'commit;'
)
select sql from lines order by priority,sql;

commit;
