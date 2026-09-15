-- READ ONLY. Run in the trusted Supabase SQL Editor. No identity columns returned.
-- Results reproduce the preceding preflight's exact role comparisons; no automatic
-- case/whitespace normalization or assumption that either source is authoritative.
begin transaction isolation level repeatable read read only;
do $$ begin
  if exists(select 1 from public.profiles group by id having count(*)>1)
    or exists(select 1 from public.user_roles group by user_id having count(*)>1) then
    raise exception 'Role cardinality changed; repeat structural review before interpreting pair counts';
  end if;
end $$;
with compared as (
 select p.role::text as profile_role,r.role::text as canonical_role
 from auth.users u left join public.profiles p on p.id=u.id
 left join public.user_roles r on r.user_id=u.id
), categories as (
 select 'source_disagreement'::text as category,profile_role,canonical_role
 from compared where profile_role is not null and canonical_role is not null
   and profile_role<>canonical_role
 union all
 select 'billing_permission_only_in_profile',profile_role,canonical_role
 from compared
 where profile_role in ('staff','billing_staff','practice_manager','admin','super_admin')
   and coalesce(canonical_role in ('staff','billing_staff','practice_manager','admin','super_admin'),false)=false
)
select category,profile_role as "profiles.role",canonical_role as "user_roles.role",count(*) as user_count
from categories group by category,profile_role,canonical_role
order by category,profile_role,canonical_role nulls first;
-- Sum source_disagreement counts should reproduce 16 if production is unchanged.
-- Sum billing_permission_only_in_profile counts should reproduce 4.
-- Categories overlap: do NOT add those totals to count distinct affected users.
commit;
