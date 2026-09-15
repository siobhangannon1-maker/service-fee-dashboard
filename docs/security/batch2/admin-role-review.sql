-- READ ONLY, PRIVATE ADMIN REVIEW ONLY. Do not paste results into public reports.
-- Returns auth user UUIDs and role labels, NEVER names/emails/phones/patient data.
-- Map UUIDs privately through existing authorized user administration if needed.
begin transaction isolation level repeatable read read only;
do $$ begin
 if exists(select 1 from public.profiles group by id having count(*)>1)
   or exists(select 1 from public.user_roles group by user_id having count(*)>1) then
   raise exception 'Role cardinality changed; review schema/assignments first';
 end if;
end $$;
with compared as (
 select u.id as user_id,p.role::text as profile_role,r.role::text as canonical_role
 from auth.users u left join public.profiles p on p.id=u.id
 left join public.user_roles r on r.user_id=u.id
)
select user_id,profile_role,canonical_role,
 profile_role is not null and canonical_role is not null and profile_role<>canonical_role as sources_disagree,
 coalesce(profile_role in ('staff','billing_staff','practice_manager','admin','super_admin'),false)
 and not coalesce(canonical_role in ('staff','billing_staff','practice_manager','admin','super_admin'),false)
 as billing_permission_only_in_profile
from compared
where (profile_role is not null and canonical_role is not null and profile_role<>canonical_role)
 or (profile_role in ('staff','billing_staff','practice_manager','admin','super_admin')
   and not coalesce(canonical_role in ('staff','billing_staff','practice_manager','admin','super_admin'),false))
order by profile_role,canonical_role,user_id;
commit;
