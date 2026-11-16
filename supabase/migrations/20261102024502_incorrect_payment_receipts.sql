-- Additive only. Prepare locally; production application requires separate approval.
begin;
do $$ begin
  if to_regprocedure('public.billing_access_level_v1()') is null then
    raise exception 'Existing billing access controls must be installed first';
  end if;
end $$;
create table public.billing_xero_invoice_runs (
  id uuid primary key default gen_random_uuid(),
  provider_id uuid not null references public.providers(id),
  billing_period_id uuid not null references public.billing_periods(id),
  tenant_id text not null,
  contact_id text not null,
  invoice_id text,
  invoice_payload jsonb not null,
  supporting_data_hash text not null,
  creation_attempted boolean not null default false,
  lock_token uuid,
  locked_at timestamptz,
  statement_attached boolean not null default false,
  production_attached boolean not null default false,
  created_at timestamptz not null default now(),
  unique(provider_id,billing_period_id,tenant_id),
  unique(tenant_id,invoice_id),
  check ((lock_token is null) = (locked_at is null))
);
create table public.incorrect_payment_receipts (
  id uuid primary key default gen_random_uuid(),
  provider_id uuid not null references public.providers(id),
  billing_period_id uuid not null references public.billing_periods(id),
  location text not null check (location in ('paddington','coorparoo')),
  original_filename text not null,
  storage_path text not null unique,
  mime_type text not null check (mime_type in ('image/png','image/jpeg','application/pdf')),
  file_size integer not null check (file_size > 0 and file_size <= 3000000),
  sha256 text not null,
  patient_name text check (length(patient_name)<=200),
  payment_date date,
  amount numeric(12,2) check (amount>=0),
  notes text check (length(notes)<=2000),
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  status text not null default 'pending' check (status in ('pending','attaching','attached','failed','deleting')),
  invoice_run_id uuid references public.billing_xero_invoice_runs(id),
  xero_invoice_id text,
  attachment_filename text,
  xero_attachment_id text,
  attached_at timestamptz,
  last_error text,
  deleted_at timestamptz,
  deleted_by uuid references auth.users(id),
  check (status <> 'attached' or (xero_invoice_id is not null and xero_attachment_id is not null and attached_at is not null))
);
create index incorrect_payment_receipts_billing on public.incorrect_payment_receipts(billing_period_id,provider_id) where deleted_at is null;
alter table public.incorrect_payment_receipts enable row level security;
alter table public.billing_xero_invoice_runs enable row level security;
revoke all on public.incorrect_payment_receipts,public.billing_xero_invoice_runs from public,anon,authenticated;
grant select on public.incorrect_payment_receipts,public.billing_xero_invoice_runs to authenticated;
grant all on public.incorrect_payment_receipts,public.billing_xero_invoice_runs to service_role;
create policy receipt_billing_read on public.incorrect_payment_receipts for select to authenticated
  using ((select public.billing_access_level_v1()) >= 1 and deleted_at is null);
create policy invoice_admin_read on public.billing_xero_invoice_runs for select to authenticated
  using ((select public.billing_access_level_v1()) >= 2);
-- All mutations pass through active-account/role-checked server routes. No browser mutation grants.
-- The guard also protects against race conditions between delete and attachment claims.
create function public.guard_incorrect_payment_receipt() returns trigger
language plpgsql set search_path=pg_catalog,public as $$
declare run public.billing_xero_invoice_runs;
begin
  if TG_OP='DELETE' then raise exception 'Receipts require audited deletion'; end if;
  if TG_OP='UPDATE' then
    if (new.provider_id,new.billing_period_id,new.location,new.storage_path,new.sha256,new.mime_type,new.file_size)
       is distinct from (old.provider_id,old.billing_period_id,old.location,old.storage_path,old.sha256,old.mime_type,old.file_size) then
      raise exception 'Receipt identity and original file are immutable';
    end if;
    if old.status='attached' and new is distinct from old then raise exception 'Attached receipts are immutable'; end if;
    if (old.status='attaching' or old.xero_invoice_id is not null) and new.status='deleting' then raise exception 'Receipt attachment is in progress'; end if;
  end if;
  if new.invoice_run_id is not null then
    select * into run from public.billing_xero_invoice_runs where id=new.invoice_run_id;
    if run.id is null or run.provider_id<>new.provider_id or run.billing_period_id<>new.billing_period_id
       or new.xero_invoice_id is distinct from run.invoice_id then raise exception 'Receipt invoice identity mismatch'; end if;
  end if;
  return new;
end $$;
revoke all on function public.guard_incorrect_payment_receipt() from public,anon,authenticated;
create trigger guard_incorrect_payment_receipt before insert or update or delete on public.incorrect_payment_receipts
for each row execute function public.guard_incorrect_payment_receipt();
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values ('incorrect-payment-receipts','incorrect-payment-receipts',false,3000000,array['image/png','image/jpeg','application/pdf']);
-- No direct object policies: access is mediated by authorised server routes, with short-lived links.
commit;
