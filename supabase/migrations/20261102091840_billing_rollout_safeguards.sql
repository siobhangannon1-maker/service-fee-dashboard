-- Independent of receipt tables: can bootstrap safeguards before receipt rollout.
begin;
create table public.billing_maintenance_control (
  id smallint primary key check(id=1), enabled boolean not null default false,
  changed_at timestamptz not null default now(), changed_by uuid references auth.users(id)
);
insert into public.billing_maintenance_control(id) values(1);
create table public.billing_export_requests (
  id uuid primary key default gen_random_uuid(), billing_period_id uuid not null references public.billing_periods(id),
  started_at timestamptz not null default now(), finished_at timestamptz
);
create index billing_export_requests_active on public.billing_export_requests(started_at) where finished_at is null;
create table public.billing_export_period_holds (
  year integer not null, month integer not null check(month between 1 and 12), reason text not null,
  primary key(year,month)
);
insert into public.billing_export_period_holds values(2026,7,
 'July 2026 exports are held pending reconciliation of Dr Tom Briggs INV-0507 and Dr Omar Breik INV-0505. Do not create replacement invoices.');
create table public.billing_maintenance_events (
  id bigint generated always as identity primary key, enabled boolean not null,
  actor_id uuid not null references auth.users(id), created_at timestamptz not null default now()
);
alter table public.billing_maintenance_control enable row level security;
alter table public.billing_export_requests enable row level security;
alter table public.billing_export_period_holds enable row level security;
alter table public.billing_maintenance_events enable row level security;
revoke all on public.billing_maintenance_control,public.billing_export_requests,public.billing_export_period_holds,public.billing_maintenance_events from public,anon,authenticated;
grant all on public.billing_maintenance_control,public.billing_export_requests,public.billing_export_period_holds,public.billing_maintenance_events to service_role;
grant usage,select on sequence public.billing_maintenance_events_id_seq to service_role;

create function public.billing_rollout_status() returns jsonb
language plpgsql set search_path=pg_catalog,public as $$
declare paused boolean; active jsonb; locks integer:=0;
begin
 select enabled into strict paused from public.billing_maintenance_control where id=1;
 select coalesce(jsonb_agg(jsonb_build_object('id',id,'billing_period_id',billing_period_id,'started_at',started_at)),'[]'::jsonb)
 into active from public.billing_export_requests where finished_at is null;
 if to_regclass('public.billing_xero_invoice_runs') is not null then
   execute 'select count(*) from public.billing_xero_invoice_runs where lock_token is not null' into locks;
 end if;
 return jsonb_build_object('enabled',paused,'active_exports',active,'invoice_locks',locks,
   'drained',paused and jsonb_array_length(active)=0 and locks=0,
   'period_holds',(select jsonb_agg(to_jsonb(h)) from public.billing_export_period_holds h));
end $$;
create function public.set_billing_rollout_maintenance(p_enabled boolean,p_actor uuid) returns jsonb
language plpgsql set search_path=pg_catalog,public as $$
begin
 if not exists(select 1 from public.user_status where user_id=p_actor and is_active=true) or
    not exists(select 1 from public.user_roles where user_id=p_actor and role::text in ('admin','super_admin')) then
   raise exception 'Active administrator required';
 end if;
 -- Exclusive gate waits for entry-write transactions and export registration to commit.
 perform 1 from public.billing_maintenance_control where id=1 for update;
 if not found then raise exception 'Maintenance control unavailable'; end if;
 if not p_enabled and (jsonb_array_length(public.billing_rollout_status()->'active_exports')<>0 or
   (public.billing_rollout_status()->>'invoice_locks')::integer<>0) then
   raise exception 'Exports have not drained; reconcile outstanding requests and locks before disabling maintenance';
 end if;
 update public.billing_maintenance_control set enabled=p_enabled,changed_at=now(),changed_by=p_actor where id=1;
 insert into public.billing_maintenance_events(enabled,actor_id) values(p_enabled,p_actor);
 return public.billing_rollout_status();
end $$;
create function public.begin_billing_export(p_period uuid) returns uuid
language plpgsql set search_path=pg_catalog,public as $$
declare paused boolean; token uuid;
begin
 select enabled into strict paused from public.billing_maintenance_control where id=1 for share;
 if paused then raise exception 'Billing exports are paused for maintenance' using errcode='P0001'; end if;
 if not exists(select 1 from public.billing_periods where id=p_period) then raise exception 'Invalid billing period'; end if;
 if exists(select 1 from public.billing_periods p join public.billing_export_period_holds h on h.year=p.year and h.month=p.month where p.id=p_period) then
   raise exception 'July 2026 exports are held pending reconciliation of INV-0507 and INV-0505. Do not create replacement invoices' using errcode='P0002';
 end if;
 insert into public.billing_export_requests(billing_period_id) values(p_period) returning id into token;
 return token;
end $$;
create function public.finish_billing_export(p_request uuid) returns void
language sql set search_path=pg_catalog,public as $$
 update public.billing_export_requests set finished_at=coalesce(finished_at,now()) where id=p_request
$$;

-- Narrow definer function: browser roles have no access to the maintenance table.
-- Holding SHARE until transaction end means enabling maintenance drains earlier writes.
create function public.guard_incorrect_payment_maintenance() returns trigger
language plpgsql security definer set search_path=pg_catalog,public as $$
declare paused boolean; relevant boolean;
begin
 relevant:=case when TG_OP='INSERT' then new.category='paid_to_wrong_provider'
   when TG_OP='DELETE' then old.category='paid_to_wrong_provider'
   else old.category='paid_to_wrong_provider' or new.category='paid_to_wrong_provider' end;
 if relevant then
   select enabled into strict paused from public.billing_maintenance_control where id=1 for share;
   if paused then raise exception 'Incorrect-payment entries are paused for maintenance. Your entry was not saved'; end if;
 end if;
 if TG_OP='DELETE' then return old; end if;
 return new;
end $$;
create trigger billing_rollout_entry_guard before insert or update or delete on public.patient_financial_entries
for each row execute function public.guard_incorrect_payment_maintenance();
revoke all on function public.guard_incorrect_payment_maintenance() from public,anon,authenticated;
revoke all on function public.billing_rollout_status(),public.set_billing_rollout_maintenance(boolean,uuid),public.begin_billing_export(uuid),public.finish_billing_export(uuid) from public,anon,authenticated;
grant execute on function public.billing_rollout_status(),public.set_billing_rollout_maintenance(boolean,uuid),public.begin_billing_export(uuid),public.finish_billing_export(uuid) to service_role;
commit;
