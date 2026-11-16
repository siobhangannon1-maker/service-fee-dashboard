-- Location is optional for new receipts; preserve every existing value and safeguard.
begin;
alter table public.incorrect_payment_receipts alter column location drop not null;
-- Existing CHECK accepts NULL while still rejecting unknown non-NULL locations.
-- No defaults, backfills, grant/RLS changes or changes to the immutable-file guard.
commit;
