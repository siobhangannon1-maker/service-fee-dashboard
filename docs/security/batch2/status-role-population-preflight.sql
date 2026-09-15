-- READ ONLY, aggregate counts only. Includes BOTH role sources so the four
-- profile-only Billing permissions are not omitted from active-status assessment.
begin transaction isolation level repeatable read read only;
with role_population as (
 select u.id,
 exists(select 1 from public.user_roles r where r.user_id=u.id and r.role is not null)
   or exists(select 1 from public.profiles p where p.id=u.id and p.role is not null) as represented,
 exists(select 1 from public.user_roles r where r.user_id=u.id and r.role::text in
   ('staff','billing_staff','practice_manager','admin','super_admin')) as canonical_billing,
 exists(select 1 from public.profiles p where p.id=u.id and p.role::text in
   ('staff','billing_staff','practice_manager','admin','super_admin')) as profile_billing
 from auth.users u
), per_user as (
 select r.*,s.status_rows,s.null_rows,s.has_inactive
 from role_population r cross join lateral (
   select count(*) as status_rows,count(*) filter(where is_active is null) as null_rows,
     coalesce(bool_or(is_active is false),false) as has_inactive
   from public.user_status where user_id=r.id
 ) s
), populations as (
 select 'all_auth_users'::text as population,* from per_user
 union all select 'represented_in_either_role_source',* from per_user where represented
)
select population,count(*) as total_users,
 count(*) filter(where status_rows=1) as exactly_one_status_row,
 count(*) filter(where status_rows=0) as zero_status_rows,
 count(*) filter(where status_rows>1) as users_with_duplicate_status_rows,
 coalesce(sum(null_rows),0) as null_is_active_rows,
 count(*) filter(where null_rows>0) as users_with_null_is_active,
 count(*) filter(where (canonical_billing or profile_billing) and status_rows=0) as billing_either_source_zero_status,
 count(*) filter(where (canonical_billing or profile_billing) and has_inactive) as billing_either_source_inactive,
 count(*) filter(where canonical_billing and status_rows=0) as billing_canonical_zero_status,
 count(*) filter(where canonical_billing and has_inactive) as billing_canonical_inactive
from populations group by population order by population;
-- "Inactive" means at least one explicit false, including conflicting duplicate
-- records. NULL is counted separately; absence is NOT counted as a NULL row.
-- Populations overlap; do not add their totals. Empty/nonstandard role strings
-- count as represented but do not acquire Billing permission here.
commit;
