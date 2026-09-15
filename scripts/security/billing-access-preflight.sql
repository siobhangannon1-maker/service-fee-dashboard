-- Batch 2 preflight: METADATA ONLY. Run as the database administrator in SQL Editor.
-- No patient records, object contents, function bodies or secrets are selected.
-- Run each SELECT separately if your SQL editor displays only the last result.
-- These are inspection queries, NOT a migration or proof of runtime policy behavior.
begin transaction read only;

-- 1. Existence, owners, RLS flags and relation options (also distinguishes views).
with targets(name) as (values
  ('imports'),
  ('import_rows_raw'),
  ('import_rows_normalized'),
  ('billing_period_imports'),
  ('patient_financial_entries'),
  ('billing_detail_entries'),
  ('patient_cost_entries'),
  ('billing_periods'),
  ('providers'),
  ('provider_monthly_records'),
  ('provider_monthly_summaries'),
  ('provider_item_totals'),
  ('provider_period_metrics'),
  ('material_cost_items'),
  ('afterpay_imports'),
  ('xero_imports'),
  ('user_roles'),
  ('user_status'),
  ('profiles'))
select t.name, c.relkind, c.relrowsecurity, c.relforcerowsecurity,
  pg_get_userbyid(c.relowner) as owner, c.reloptions
from targets t left join pg_class c on c.oid = to_regclass('public.' || t.name)
order by t.name;

-- 2. Column types/nullability; no row values or defaults.
with targets(name) as (values
  ('imports'),
  ('import_rows_raw'),
  ('import_rows_normalized'),
  ('billing_period_imports'),
  ('patient_financial_entries'),
  ('billing_detail_entries'),
  ('patient_cost_entries'),
  ('billing_periods'),
  ('providers'),
  ('provider_monthly_records'),
  ('provider_monthly_summaries'),
  ('provider_item_totals'),
  ('provider_period_metrics'),
  ('material_cost_items'),
  ('afterpay_imports'),
  ('xero_imports'),
  ('user_roles'),
  ('user_status'),
  ('profiles'))
select c.relname, a.attname, format_type(a.atttypid, a.atttypmod) as data_type, a.attnotnull
from targets t join pg_class c on c.oid = to_regclass('public.' || t.name)
join pg_attribute a on a.attrelid=c.oid and a.attnum>0 and not a.attisdropped
order by c.relname,a.attnum;

-- 3. Effective table privileges (includes inherited/public privileges).
with targets(name) as (values
  ('imports'),
  ('import_rows_raw'),
  ('import_rows_normalized'),
  ('billing_period_imports'),
  ('patient_financial_entries'),
  ('billing_detail_entries'),
  ('patient_cost_entries'),
  ('billing_periods'),
  ('providers'),
  ('provider_monthly_records'),
  ('provider_monthly_summaries'),
  ('provider_item_totals'),
  ('provider_period_metrics'),
  ('material_cost_items'),
  ('afterpay_imports'),
  ('xero_imports'),
  ('user_roles'),
  ('user_status'),
  ('profiles'))
select t.name, r.rolname, p.privilege,
  has_table_privilege(r.oid,c.oid,p.privilege) as allowed
from targets t join pg_class c on c.oid=to_regclass('public.' || t.name)
cross join pg_roles r cross join (values ('SELECT'),('INSERT'),('UPDATE'),('DELETE'),('TRUNCATE'),('REFERENCES'),('TRIGGER')) p(privilege)
where r.rolname in ('anon','authenticated','service_role') order by 1,2,3;

-- 4. Effective column grants can survive a table-level REVOKE.
with targets(name) as (values
  ('imports'),
  ('import_rows_raw'),
  ('import_rows_normalized'),
  ('billing_period_imports'),
  ('patient_financial_entries'),
  ('billing_detail_entries'),
  ('patient_cost_entries'),
  ('billing_periods'),
  ('providers'),
  ('provider_monthly_records'),
  ('provider_monthly_summaries'),
  ('provider_item_totals'),
  ('provider_period_metrics'),
  ('material_cost_items'),
  ('afterpay_imports'),
  ('xero_imports'),
  ('user_roles'),
  ('user_status'),
  ('profiles'))
select t.name, a.attname, r.rolname, p.privilege,
  has_column_privilege(r.oid,c.oid,a.attnum,p.privilege) as allowed
from targets t join pg_class c on c.oid=to_regclass('public.' || t.name)
join pg_attribute a on a.attrelid=c.oid and a.attnum>0 and not a.attisdropped
cross join pg_roles r cross join (values ('SELECT'),('INSERT'),('UPDATE'),('REFERENCES')) p(privilege)
where r.rolname in ('anon','authenticated','service_role') order by 1,2,3,4;

-- 5. Explicit table ACLs, including PUBLIC (grantee=0).
with targets(name) as (values
  ('imports'),
  ('import_rows_raw'),
  ('import_rows_normalized'),
  ('billing_period_imports'),
  ('patient_financial_entries'),
  ('billing_detail_entries'),
  ('patient_cost_entries'),
  ('billing_periods'),
  ('providers'),
  ('provider_monthly_records'),
  ('provider_monthly_summaries'),
  ('provider_item_totals'),
  ('provider_period_metrics'),
  ('material_cost_items'),
  ('afterpay_imports'),
  ('xero_imports'),
  ('user_roles'),
  ('user_status'),
  ('profiles'))
select t.name, case when x.grantee=0 then 'PUBLIC' else pg_get_userbyid(x.grantee) end as grantee,
  x.privilege_type,x.is_grantable
from targets t join pg_class c on c.oid=to_regclass('public.' || t.name)
cross join lateral aclexplode(coalesce(c.relacl,acldefault('r',c.relowner))) x order by 1,2,3;

-- 6. Existing policy expressions are schema metadata. Review before replacing:
-- permissive policies OR together, so adding a restrictive-looking permissive
-- policy does not remove an existing broad allow policy.
with targets(name) as (values
  ('imports'),
  ('import_rows_raw'),
  ('import_rows_normalized'),
  ('billing_period_imports'),
  ('patient_financial_entries'),
  ('billing_detail_entries'),
  ('patient_cost_entries'),
  ('billing_periods'),
  ('providers'),
  ('provider_monthly_records'),
  ('provider_monthly_summaries'),
  ('provider_item_totals'),
  ('provider_period_metrics'),
  ('material_cost_items'),
  ('afterpay_imports'),
  ('xero_imports'),
  ('user_roles'),
  ('user_status'),
  ('profiles'))
select p.schemaname,p.tablename,p.policyname,p.permissive,p.roles,p.cmd,p.qual,p.with_check
from pg_policies p join targets t on t.name=p.tablename where p.schemaname='public'
order by p.tablename,p.policyname;

-- 7. Role properties and inherited memberships; no auth.users/profile records.
select rolname,rolsuper,rolinherit,rolbypassrls from pg_roles
where rolname in ('anon','authenticated','service_role') order by rolname;
select member.rolname as member, parent.rolname as inherited_role
from pg_auth_members m join pg_roles member on member.oid=m.member
join pg_roles parent on parent.oid=m.roleid
where member.rolname in ('anon','authenticated','service_role');

-- 8. Constraints and trigger identities needed for lock/creator/review protection.
with targets(name) as (values
  ('imports'),
  ('import_rows_raw'),
  ('import_rows_normalized'),
  ('billing_period_imports'),
  ('patient_financial_entries'),
  ('billing_detail_entries'),
  ('patient_cost_entries'),
  ('billing_periods'),
  ('providers'),
  ('provider_monthly_records'),
  ('provider_monthly_summaries'),
  ('provider_item_totals'),
  ('provider_period_metrics'),
  ('material_cost_items'),
  ('afterpay_imports'),
  ('xero_imports'),
  ('user_roles'),
  ('user_status'),
  ('profiles'))
select t.name, k.conname,k.contype,pg_get_constraintdef(k.oid) as definition
from targets t join pg_constraint k on k.conrelid=to_regclass('public.'||t.name)
order by 1,2;
with targets(name) as (values
  ('imports'),
  ('import_rows_raw'),
  ('import_rows_normalized'),
  ('billing_period_imports'),
  ('patient_financial_entries'),
  ('billing_detail_entries'),
  ('patient_cost_entries'),
  ('billing_periods'),
  ('providers'),
  ('provider_monthly_records'),
  ('provider_monthly_summaries'),
  ('provider_item_totals'),
  ('provider_period_metrics'),
  ('material_cost_items'),
  ('afterpay_imports'),
  ('xero_imports'),
  ('user_roles'),
  ('user_status'),
  ('profiles'))
select t.name,g.tgname,g.tgenabled,p.oid::regprocedure as trigger_function,p.prosecdef
from targets t join pg_trigger g on g.tgrelid=to_regclass('public.'||t.name)
join pg_proc p on p.oid=g.tgfoid where not g.tgisinternal order by 1,2;

-- 9. Public function privileges. Include security-definer functions even where
-- PostgreSQL does not track table dependencies in string/dynamic SQL bodies.
-- Do NOT return function bodies; named candidates need a separate private audit.
select p.oid::regprocedure as function_signature,p.prosecdef,p.provolatile,
  pg_get_userbyid(p.proowner) as owner,r.rolname,
  has_function_privilege(r.oid,p.oid,'EXECUTE') as executable
from pg_proc p join pg_namespace n on n.oid=p.pronamespace cross join pg_roles r
where n.nspname='public' and r.rolname in ('anon','authenticated','service_role')
order by 1,5;

-- 10. Recursively find dependent views; ordinary owner-executed views may expose
-- base tables despite table RLS/grants. Security-invoker behavior needs review.
with recursive targets(name) as (values
 ('imports'),
 ('import_rows_raw'),
 ('import_rows_normalized'),
 ('billing_period_imports'),
 ('patient_financial_entries'),
 ('billing_detail_entries'),
 ('patient_cost_entries'),
 ('billing_periods'),
 ('providers'),
 ('provider_monthly_records'),
 ('provider_monthly_summaries'),
 ('provider_item_totals'),
 ('provider_period_metrics'),
 ('material_cost_items'),
 ('afterpay_imports'),
 ('xero_imports'),
 ('user_roles'),
 ('user_status'),
 ('profiles')
), relations(oid) as (
 select to_regclass('public.'||name)::oid from targets where to_regclass('public.'||name) is not null
 union
 select rw.ev_class from relations base join pg_depend d on d.refobjid=base.oid
   and d.refclassid='pg_class'::regclass and d.classid='pg_rewrite'::regclass
 join pg_rewrite rw on rw.oid=d.objid where rw.ev_class<>base.oid
)
select n.nspname,c.relname,c.relkind,c.reloptions,pg_get_userbyid(c.relowner) as owner,
 has_table_privilege('anon',c.oid,'SELECT') as anon_select,
 has_table_privilege('authenticated',c.oid,'SELECT') as authenticated_select
from relations b join pg_class c on c.oid=b.oid join pg_namespace n on n.oid=c.relnamespace
where c.relkind in ('v','m') order by 1,2;

commit;
