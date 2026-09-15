-- RUNBOOK ONLY: not executed by this task. Post-migration metadata checks.
-- Run only after explicit production approval. No patient rows or mutations.
begin transaction read only;

-- Eight rows required. Every rls_enabled / postgres_owner must be true.
with targets(name) as (values ('imports'),('import_rows_raw'),('import_rows_normalized'),
 ('billing_period_imports'),('patient_financial_entries'),('billing_detail_entries'),
 ('user_roles'),('user_status'))
select t.name, c.oid is not null as exists, c.relrowsecurity as rls_enabled,
 c.relforcerowsecurity as force_rls, pg_get_userbyid(c.relowner)='postgres' as postgres_owner
from targets t left join pg_class c on c.oid=to_regclass('public.'||t.name) order by 1;

-- All allowed values must be false (table AND column privileges checked).
with targets(name) as (values ('imports'),('import_rows_raw'),('import_rows_normalized'),
 ('billing_period_imports'),('patient_financial_entries'),('billing_detail_entries'),
 ('user_roles'),('user_status'))
select name, op, has_table_privilege('anon',to_regclass('public.'||name),op) as allowed
from targets cross join unnest(array['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER']) op order by 1,2;
with targets(name) as (values ('imports'),('import_rows_raw'),('import_rows_normalized'),
 ('billing_period_imports'),('patient_financial_entries'),('billing_detail_entries'),
 ('user_roles'),('user_status'))
select name, op, has_any_column_privilege('anon',to_regclass('public.'||name),op) as allowed
from targets cross join unnest(array['SELECT','INSERT','UPDATE','REFERENCES']) op order by 1,2;

-- All service_role allowed values must be true; four separate operations per table.
with targets(name) as (values ('imports'),('import_rows_raw'),('import_rows_normalized'),
 ('billing_period_imports'),('patient_financial_entries'),('billing_detail_entries'),
 ('user_roles'),('user_status'))
select name, op, has_table_privilege('service_role',to_regclass('public.'||name),op) as allowed
from targets cross join unnest(array['SELECT','INSERT','UPDATE','DELETE']) op order by 1,2;
select rolbypassrls, has_schema_privilege('service_role','public','USAGE') as public_usage
from pg_roles where rolname='service_role';

-- Exactly one row, every *_ok true. No arbitrary user-id argument.
select p.oid::regprocedure as signature,
 pg_get_userbyid(p.proowner)='postgres' as owner_ok,
 p.prosecdef as security_definer_ok, p.provolatile='s' as stable_ok,
 p.pronargs=0 as no_actor_argument_ok,
 p.proconfig=array['search_path=pg_catalog, pg_temp'] as search_path_ok,
 not has_function_privilege('anon',p.oid,'EXECUTE') as anon_denied_ok,
 has_function_privilege('authenticated',p.oid,'EXECUTE') as authenticated_execute_ok,
 not has_function_privilege('authenticated',p.oid,'EXECUTE WITH GRANT OPTION') as no_grant_option_ok,
 has_function_privilege('service_role',p.oid,'EXECUTE') as service_execute_ok,
 not exists(select 1 from aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a
   where a.grantee not in ('postgres'::regrole,'authenticated'::regrole,'service_role'::regrole)) as acl_allowlist_ok,
 obj_description(p.oid,'pg_proc') like 'billing_v1:revision2:complete:%' as completion_marker_present
from pg_proc p where p.pronamespace='public'::regnamespace and p.proname='billing_access_level_v1';
-- Marker presence is not fingerprint verification. Compare actual metadata to the
-- reviewed migration; never reapply the migration as a verification command.

-- All values false for server-only source tables, including column SELECT.
select t, op, has_table_privilege('authenticated','public.'||t,op) as allowed
from unnest(array['imports','import_rows_raw','import_rows_normalized']) t
cross join unnest(array['SELECT','INSERT','UPDATE','DELETE','TRUNCATE']) op order by 1,2;
select t, has_any_column_privilege('authenticated','public.'||t,'SELECT') as any_column_select
from unnest(array['imports','import_rows_raw','import_rows_normalized']) t;

-- Metadata for exact policy/column-allowlist comparison with approved SQL.
-- Historic permissive policies may remain: restrictive policies must also exist.
select tablename,policyname,permissive,roles,cmd,qual,with_check
from pg_policies where schemaname='public' and tablename in
 ('imports','import_rows_raw','import_rows_normalized','billing_period_imports',
  'patient_financial_entries','billing_detail_entries','user_roles','user_status')
order by tablename,policyname;
select c.relname,a.attname,
 has_column_privilege('authenticated',c.oid,a.attnum,'INSERT') as can_insert,
 has_column_privilege('authenticated',c.oid,a.attnum,'UPDATE') as can_update
from pg_class c join pg_attribute a on a.attrelid=c.oid and a.attnum>0 and not a.attisdropped
where c.oid in ('public.patient_financial_entries'::regclass,'public.billing_detail_entries'::regclass)
order by c.relname,a.attnum;
select t,has_table_privilege('authenticated','public.'||t,'DELETE') as hard_delete,
 has_table_privilege('authenticated','public.'||t,'TRUNCATE') as truncate_allowed
from unnest(array['patient_financial_entries','billing_detail_entries','billing_period_imports']) t;
commit;
