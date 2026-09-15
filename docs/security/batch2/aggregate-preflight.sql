-- READ ONLY; aggregate counts only. Run as trusted SQL Editor administrator.
-- No identities, names, emails, phone numbers or clinical data returned.
begin transaction isolation level repeatable read read only;
with status_counts as (
 select u.id,count(s.user_id) as n,
   count(s.user_id) filter (where s.is_active is null) as null_count,
   bool_or(s.is_active is false) as has_inactive
 from auth.users u left join public.user_status s on s.user_id=u.id group by u.id
), billing as (
 select distinct user_id from public.user_roles
 where role::text in ('staff','billing_staff','practice_manager','admin','super_admin')
)
select count(*) as auth_users,
 count(*) filter(where n=1) as exactly_one_status,
 count(*) filter(where n=0) as zero_status,
 count(*) filter(where n>1) as duplicate_status,
 count(*) filter(where null_count>0) as users_with_null_status,
 count(*) filter(where b.user_id is not null and n=0) as billing_users_zero_status,
 count(*) filter(where b.user_id is not null and has_inactive) as billing_users_inactive
from status_counts s left join billing b on b.user_id=s.id;

-- Distinct non-null role sets: exact canonical spelling, no silent normalization.
-- Separate duplicate assignments from multiple DISTINCT role assignments.
with roles as (
 select user_id, array_agg(distinct role::text order by role::text) filter(where role is not null) as role_set,
 count(*) as row_count,count(distinct role::text) as distinct_count
 from public.user_roles group by user_id
), compared as (
 select u.id,r.role_set,r.row_count,r.distinct_count,p.role::text as profile_role,
 coalesce(p.role::text in ('staff','billing_staff','practice_manager','admin','super_admin'),false) as profile_billing,
 coalesce(r.role_set && array['staff','billing_staff','practice_manager','admin','super_admin'],false) as canonical_billing
 from auth.users u left join roles r on r.user_id=u.id left join public.profiles p on p.id=u.id
)
select count(*) filter(where cardinality(role_set)>0 and profile_role is null) as canonical_only,
 count(*) filter(where coalesce(cardinality(role_set),0)=0 and profile_role is not null) as profile_only,
 count(*) filter(where cardinality(role_set)>0 and profile_role is not null and role_set<>array[profile_role]) as sources_disagree,
 count(*) filter(where profile_billing and not canonical_billing) as billing_permission_only_in_profile,
 count(*) filter(where row_count>distinct_count) as duplicate_role_assignments,
 count(*) filter(where distinct_count>1) as multiple_distinct_roles
from compared;
commit;
