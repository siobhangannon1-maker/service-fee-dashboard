-- Additive. Historical entries are exempt; no financial values or accounting codes change.
begin;
alter table public.patient_financial_entries add column receipt_required boolean not null default false;
alter table public.incorrect_payment_receipts
  add column patient_financial_entry_id uuid references public.patient_financial_entries(id),
  add column intended_provider_id uuid references public.providers(id),
  add constraint incorrect_receipt_distinct_providers check (intended_provider_id is null or intended_provider_id<>provider_id);
create index incorrect_receipt_entry on public.incorrect_payment_receipts(patient_financial_entry_id) where patient_financial_entry_id is not null;
create table public.incorrect_payment_receipt_destinations (
  receipt_id uuid not null references public.incorrect_payment_receipts(id),
  provider_id uuid not null references public.providers(id),
  status text not null default 'pending' check(status in ('draft','pending','attaching','attached','failed','deleting')),
  invoice_run_id uuid references public.billing_xero_invoice_runs(id),
  xero_invoice_id text,
  attachment_filename text,
  xero_attachment_id text,
  attached_at timestamptz,
  last_error text,
  primary key(receipt_id,provider_id),
  check(status<>'attached' or (xero_invoice_id is not null and xero_attachment_id is not null and attached_at is not null))
);
-- Preserve exact legacy confirmations, filenames and timestamps, including deleted audit rows.
insert into public.incorrect_payment_receipt_destinations
select id,provider_id,status,invoice_run_id,xero_invoice_id,attachment_filename,xero_attachment_id,attached_at,last_error
from public.incorrect_payment_receipts;
create index incorrect_receipt_destination_queue on public.incorrect_payment_receipt_destinations(provider_id,status);
alter table public.incorrect_payment_receipt_destinations enable row level security;
revoke all on public.incorrect_payment_receipt_destinations from public,anon,authenticated;
grant select on public.incorrect_payment_receipt_destinations to authenticated;
grant all on public.incorrect_payment_receipt_destinations to service_role;
create policy billing_receipt_destinations_read on public.incorrect_payment_receipt_destinations for select to authenticated
using ((select public.billing_access_level_v1())>=1 and exists(select 1 from public.incorrect_payment_receipts r where r.id=receipt_id and r.deleted_at is null));

create function public.check_payment_entry_receipts(p_id uuid) returns void
language plpgsql set search_path=pg_catalog,public as $$
declare e public.patient_financial_entries;
begin
  select * into e from public.patient_financial_entries where id=p_id;
  if not found or e.deleted_at is not null then return; end if;
  if exists(select 1 from public.incorrect_payment_receipts r where r.patient_financial_entry_id=e.id and r.deleted_at is null and r.status<>'deleting' and
    (e.category<>'paid_to_wrong_provider' or r.provider_id<>e.provider_id or r.intended_provider_id is distinct from e.related_provider_id or r.billing_period_id is distinct from e.billing_period_id)) then
    raise exception 'Receipt associations must match this financial entry and both providers';
  end if;
  if e.receipt_required and e.category='paid_to_wrong_provider' and not exists(
    select 1 from public.incorrect_payment_receipts r where r.patient_financial_entry_id=e.id and r.deleted_at is null and r.status<>'deleting'
      and r.provider_id=e.provider_id and r.intended_provider_id=e.related_provider_id and r.billing_period_id=e.billing_period_id
      and 2=(select count(*) from public.incorrect_payment_receipt_destinations d where d.receipt_id=r.id and d.provider_id in(e.provider_id,e.related_provider_id) and d.status not in('draft','deleting'))
  ) then raise exception 'At least one successfully stored, entry-specific receipt is required for this incorrect payment'; end if;
end $$;
revoke all on function public.check_payment_entry_receipts(uuid) from public,anon;
grant execute on function public.check_payment_entry_receipts(uuid) to authenticated,service_role;

create function public.guard_payment_entry_identity() returns trigger language plpgsql set search_path=pg_catalog,public as $$
begin
  if TG_OP='INSERT' then new.receipt_required := new.category='paid_to_wrong_provider'; return new; end if;
  new.receipt_required := old.receipt_required or (old.category<>'paid_to_wrong_provider' and new.category='paid_to_wrong_provider');
  if (new.provider_id,new.related_provider_id,new.billing_period_id,new.category,new.deleted_at) is distinct from
     (old.provider_id,old.related_provider_id,old.billing_period_id,old.category,old.deleted_at) and exists(
       select 1 from public.incorrect_payment_receipts r join public.incorrect_payment_receipt_destinations d on d.receipt_id=r.id
       where r.patient_financial_entry_id=old.id and (d.xero_invoice_id is not null or d.status in('attaching','attached'))
     ) then raise exception 'Administrator review required: receipt invoice destinations cannot change after export has started'; end if;
  return new;
end $$;
revoke all on function public.guard_payment_entry_identity() from public,anon,authenticated;
create trigger guard_payment_entry_identity before insert or update on public.patient_financial_entries
for each row execute function public.guard_payment_entry_identity();

create or replace function public.guard_incorrect_payment_receipt() returns trigger
language plpgsql set search_path=pg_catalog,public as $$
declare run public.billing_xero_invoice_runs; e public.patient_financial_entries;
begin
  if TG_OP='DELETE' then raise exception 'Receipts require audited deletion'; end if;
  if TG_OP='UPDATE' then
    if (new.provider_id,new.billing_period_id,new.location,new.storage_path,new.sha256,new.mime_type,new.file_size,new.intended_provider_id)
       is distinct from (old.provider_id,old.billing_period_id,old.location,old.storage_path,old.sha256,old.mime_type,old.file_size,old.intended_provider_id) then
      raise exception 'Receipt identity and original file are immutable';
    end if;
    if old.status='attached' and new is distinct from old then raise exception 'Attached receipts are immutable'; end if;
    if (new.status='deleting' or new.deleted_at is not null or new.patient_financial_entry_id is distinct from old.patient_financial_entry_id) and exists(
      select 1 from public.incorrect_payment_receipt_destinations d where d.receipt_id=old.id and (d.xero_invoice_id is not null or d.status in('attaching','attached'))
    ) then raise exception 'Administrator review required: a receipt assigned to an invoice cannot be removed or reassigned'; end if;
    if new.status='deleting' and (old.status='attaching' or old.xero_invoice_id is not null) then raise exception 'Receipt attachment is in progress'; end if;
    if new.status='deleting' and old.patient_financial_entry_id is not null then
      select * into e from public.patient_financial_entries where id=old.patient_financial_entry_id for update;
      if e.deleted_at is null and e.receipt_required and e.category='paid_to_wrong_provider' and not exists(
        select 1 from public.incorrect_payment_receipts r where r.patient_financial_entry_id=e.id and r.id<>old.id and r.deleted_at is null and r.status<>'deleting'
      ) then raise exception 'The last required receipt cannot be deleted from a completed incorrect payment'; end if;
    end if;
  end if;
  if new.patient_financial_entry_id is not null then
    select * into e from public.patient_financial_entries where id=new.patient_financial_entry_id;
    if not found or e.category<>'paid_to_wrong_provider' or e.provider_id<>new.provider_id or e.related_provider_id is distinct from new.intended_provider_id or e.billing_period_id is distinct from new.billing_period_id then
      raise exception 'Receipt does not match the financial entry, provider pair and billing period';
    end if;
  end if;
  if new.invoice_run_id is not null then
    select * into run from public.billing_xero_invoice_runs where id=new.invoice_run_id;
    if run.id is null or run.provider_id<>new.provider_id or run.billing_period_id<>new.billing_period_id or new.xero_invoice_id is distinct from run.invoice_id then raise exception 'Receipt invoice identity mismatch'; end if;
  end if;
  return new;
end $$;

create function public.seed_receipt_destinations() returns trigger language plpgsql set search_path=pg_catalog,public as $$
begin
  insert into public.incorrect_payment_receipt_destinations(receipt_id,provider_id,status)
  values(new.id,new.provider_id,case when new.intended_provider_id is null then 'pending' else 'draft' end);
  if new.intended_provider_id is not null then
    insert into public.incorrect_payment_receipt_destinations(receipt_id,provider_id,status) values(new.id,new.intended_provider_id,'draft');
  end if;
  return new;
end $$;
revoke all on function public.seed_receipt_destinations() from public,anon,authenticated;
create trigger seed_receipt_destinations after insert on public.incorrect_payment_receipts for each row execute function public.seed_receipt_destinations();

create function public.guard_receipt_destination() returns trigger language plpgsql set search_path=pg_catalog,public as $$
declare r public.incorrect_payment_receipts; run public.billing_xero_invoice_runs; e public.patient_financial_entries;
begin
  if TG_OP='DELETE' then raise exception 'Receipt destinations require audited retention'; end if;
  select * into r from public.incorrect_payment_receipts where id=new.receipt_id for update;
  if not found or r.deleted_at is not null or r.status='deleting' then raise exception 'Original receipt is unavailable'; end if;
  if new.provider_id<>r.provider_id and new.provider_id is distinct from r.intended_provider_id then raise exception 'Receipt destination provider mismatch'; end if;
  if TG_OP='UPDATE' then
    if (new.receipt_id,new.provider_id) is distinct from (old.receipt_id,old.provider_id) then raise exception 'Receipt destination identity is immutable'; end if;
    if old.status='attached' and new is distinct from old then raise exception 'Confirmed receipt attachments are immutable'; end if;
    if old.invoice_run_id is not null and (new.invoice_run_id,new.xero_invoice_id) is distinct from (old.invoice_run_id,old.xero_invoice_id) then raise exception 'Administrator review required: saved receipt invoice cannot change'; end if;
  end if;
  if new.status<>'draft' and r.intended_provider_id is not null then
    select * into e from public.patient_financial_entries where id=r.patient_financial_entry_id;
    if not found or e.deleted_at is not null or e.category<>'paid_to_wrong_provider' or e.provider_id<>r.provider_id or e.related_provider_id is distinct from r.intended_provider_id or e.billing_period_id is distinct from r.billing_period_id then
      raise exception 'Receipt financial entry is not completed with these provider associations';
    end if;
  end if;
  if new.invoice_run_id is not null then
    select * into run from public.billing_xero_invoice_runs where id=new.invoice_run_id;
    if run.id is null or run.provider_id<>new.provider_id or run.billing_period_id<>r.billing_period_id or run.invoice_id is distinct from new.xero_invoice_id then raise exception 'Receipt destination invoice mismatch'; end if;
  end if;
  return new;
end $$;
revoke all on function public.guard_receipt_destination() from public,anon,authenticated;
create trigger guard_receipt_destination before insert or update or delete on public.incorrect_payment_receipt_destinations for each row execute function public.guard_receipt_destination();

create function public.enforce_payment_receipt_integrity() returns trigger language plpgsql set search_path=pg_catalog,public as $$
begin
  if TG_TABLE_NAME='patient_financial_entries' then
    perform public.check_payment_entry_receipts(new.id);
  elsif TG_TABLE_NAME='incorrect_payment_receipts' then
    if TG_OP='UPDATE' and old.patient_financial_entry_id is not null then perform public.check_payment_entry_receipts(old.patient_financial_entry_id); end if;
    if new.patient_financial_entry_id is not null then perform public.check_payment_entry_receipts(new.patient_financial_entry_id); end if;
  else
    perform public.check_payment_entry_receipts((select patient_financial_entry_id from public.incorrect_payment_receipts where id=new.receipt_id));
  end if;
  return null;
end $$;
revoke all on function public.enforce_payment_receipt_integrity() from public,anon,authenticated;
create constraint trigger payment_entry_receipt_integrity after insert or update on public.patient_financial_entries deferrable initially deferred for each row execute function public.enforce_payment_receipt_integrity();
create constraint trigger receipt_entry_integrity after insert or update on public.incorrect_payment_receipts deferrable initially deferred for each row execute function public.enforce_payment_receipt_integrity();
create constraint trigger destination_entry_integrity after insert or update on public.incorrect_payment_receipt_destinations deferrable initially deferred for each row execute function public.enforce_payment_receipt_integrity();

create function public.save_incorrect_payment_entry(p_actor uuid,p_entry_id uuid,p_payload jsonb,p_receipt_ids uuid[] default null) returns jsonb
language plpgsql set search_path=pg_catalog,public as $$
declare old_entry public.patient_financial_entries; e public.patient_financial_entries; selected_receipt public.incorrect_payment_receipts;
  eid uuid:=coalesce(p_entry_id,gen_random_uuid()); ids uuid[]; removed uuid[]; actual uuid:=(p_payload->>'provider_id')::uuid;
  intended uuid:=nullif(p_payload->>'related_provider_id','')::uuid; period uuid:=(p_payload->>'billing_period_id')::uuid;
  entry_category text:=p_payload->>'category';
begin
  if not exists(select 1 from public.user_status where user_id=p_actor and is_active=true) or not exists(select 1 from public.user_roles where user_id=p_actor and role::text in ('staff','billing_staff','practice_manager','admin','super_admin')) then raise exception 'Active authorised billing account required'; end if;
  select * into old_entry from public.patient_financial_entries where id=eid for update;
  if old_entry.id is not null and (old_entry.deleted_at is not null or old_entry.is_review_locked) then raise exception 'This entry is deleted or reviewed and locked'; end if;
  if old_entry.id is not null and (actual,intended,period,entry_category) is distinct from (old_entry.provider_id,old_entry.related_provider_id,old_entry.billing_period_id,old_entry.category) and exists(select 1 from public.incorrect_payment_receipts r join public.incorrect_payment_receipt_destinations d on d.receipt_id=r.id where r.patient_financial_entry_id=eid and (d.xero_invoice_id is not null or d.status in('attaching','attached'))) then raise exception 'Administrator review required: receipt invoice destinations cannot change after export has started'; end if;
  if not exists(select 1 from public.billing_periods where id=period and status='open') or (old_entry.id is not null and not exists(select 1 from public.billing_periods where id=old_entry.billing_period_id and status='open')) then raise exception 'Billing period is locked or unavailable'; end if;
  if not exists(select 1 from public.providers where id=actual and is_active=true) then raise exception 'Active payment recipient required'; end if;
  if entry_category='paid_to_wrong_provider' and (intended is null or intended=actual or not exists(select 1 from public.providers where id=intended and is_active=true)) then raise exception 'Select distinct active received-by and owed-to providers'; end if;
  if entry_category<>'paid_to_wrong_provider' then intended:=null; end if;
  if p_receipt_ids is null then select coalesce(array_agg(id),'{}'::uuid[]) into ids from public.incorrect_payment_receipts where patient_financial_entry_id=eid and deleted_at is null and status<>'deleting'; else ids:=p_receipt_ids; end if;
  if entry_category<>'paid_to_wrong_provider' then ids:='{}'::uuid[]; end if;
  if cardinality(ids)<>(select count(distinct x) from unnest(ids)x) then raise exception 'Duplicate receipt selection'; end if;
  for selected_receipt in select * from public.incorrect_payment_receipts where id=any(ids) order by id for update loop
    if selected_receipt.deleted_at is not null or selected_receipt.status='deleting' or (selected_receipt.patient_financial_entry_id is not null and selected_receipt.patient_financial_entry_id<>eid) or (selected_receipt.patient_financial_entry_id is null and selected_receipt.created_by<>p_actor) or selected_receipt.provider_id<>actual or selected_receipt.intended_provider_id is distinct from intended or selected_receipt.billing_period_id<>period then raise exception 'Selected receipt does not belong to this entry and provider pair'; end if;
  end loop;
  if cardinality(ids)<>(select count(*) from public.incorrect_payment_receipts where id=any(ids)) then raise exception 'Selected receipt is unavailable'; end if;
  if old_entry.id is null then
    insert into public.patient_financial_entries(id,provider_id,related_provider_id,billing_period_id,patient_name,entry_date,category,amount,notes)
    values(eid,actual,intended,period,trim(p_payload->>'patient_name'),(p_payload->>'entry_date')::date,entry_category,(p_payload->>'amount')::numeric,nullif(trim(p_payload->>'notes'),'')) returning * into e;
  else
    update public.patient_financial_entries set provider_id=actual,related_provider_id=intended,billing_period_id=period,patient_name=trim(p_payload->>'patient_name'),entry_date=(p_payload->>'entry_date')::date,category=entry_category,amount=(p_payload->>'amount')::numeric,notes=nullif(trim(p_payload->>'notes'),'') where id=eid returning * into e;
  end if;
  -- Unexported receipts removed during an edit become removable drafts; no original file is copied.
  select coalesce(array_agg(id),'{}'::uuid[]) into removed from public.incorrect_payment_receipts where patient_financial_entry_id=eid and not(id=any(ids));
  update public.incorrect_payment_receipts set patient_financial_entry_id=null where id=any(removed);
  update public.incorrect_payment_receipt_destinations set status='draft' where receipt_id=any(removed) and status in('pending','failed') and xero_invoice_id is null;
  update public.incorrect_payment_receipts set patient_financial_entry_id=eid where id=any(ids) and patient_financial_entry_id is distinct from eid;
  update public.incorrect_payment_receipt_destinations set status='pending' where receipt_id=any(ids) and status='draft';
  perform public.check_payment_entry_receipts(eid);
  return to_jsonb(e);
end $$;
revoke all on function public.save_incorrect_payment_entry(uuid,uuid,jsonb,uuid[]) from public,anon,authenticated;
grant execute on function public.save_incorrect_payment_entry(uuid,uuid,jsonb,uuid[]) to service_role;
commit;
