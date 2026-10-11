-- Fixes from the repository audit.
--
-- 1. Who recorded a payment. Staff cannot read the owner's profile (owners
--    carry no hostel_id), so a join to profiles showed staff a blank
--    "Recorded by" for every payment the owner entered. The name is now
--    snapshotted on the payment when it is recorded, as allocation_events
--    already does for its actor.
--
-- 2. Billed months for the fee list's month filter. Reading invoice rows and
--    de-duplicating them in the app stopped at the API's 1000-row cap, so
--    older months vanished from the filter once a hostel had more invoices
--    than that. The database now returns the distinct months.

-- ---------------------------------------------------------------------------
-- 1. Payment recorder name
-- ---------------------------------------------------------------------------
alter table public.payments add column recorded_by_name text;

comment on column public.payments.recorded_by_name is
  'Snapshot of the recorder''s name, readable by every member of the hostel.';

-- Existing payments: the guard trigger refuses any update that is not a
-- void, so it is set aside for this one backfill.
alter table public.payments disable trigger payments_guard_update;
update public.payments p
   set recorded_by_name = pr.full_name
  from public.profiles pr
 where pr.id = p.recorded_by;
alter table public.payments enable trigger payments_guard_update;

-- Same rules as before, plus the snapshot. The recorder is always the
-- caller (the insert policy checks it), and everyone can read their own
-- profile, so this works under the caller's own privileges.
create or replace function private.payments_guard_insert()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  invoice record;
  balance integer;
begin
  perform pg_advisory_xact_lock(hashtextextended('payments:' || new.invoice_id::text, 0));

  select i.status, i.amount into invoice from public.invoices i where i.id = new.invoice_id;
  if not found then
    raise exception 'Invoice not found' using errcode = 'P0001', hint = 'invoice_not_found';
  end if;
  if invoice.status <> 'issued' then
    raise exception 'Payments cannot be recorded against a void invoice'
      using errcode = 'P0001', hint = 'invoice_void';
  end if;
  if current_user = 'authenticated' and new.paid_at > private.today_ist() then
    raise exception 'A payment date cannot be in the future'
      using errcode = 'P0001', hint = 'payment_future';
  end if;

  select invoice.amount - coalesce(sum(p.amount), 0) into balance
    from public.payments p
   where p.invoice_id = new.invoice_id and p.voided_at is null;
  if new.amount > balance then
    raise exception 'Only % is due on this invoice',
      '₹' || to_char(balance / 100.0, 'FM999999990.00')
      using errcode = 'P0001', hint = 'overpayment';
  end if;

  new.recorded_by_name := (select pr.full_name from public.profiles pr where pr.id = new.recorded_by);
  new.voided_at := null;
  new.void_reason := null;
  new.voided_by := null;
  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- 2. Billed months
-- ---------------------------------------------------------------------------
-- SECURITY INVOKER: another hostel's id returns nothing.
create or replace function public.billed_months(p_hostel_id uuid)
returns setof date
language sql
stable
security invoker
set search_path = ''
as $$
  select distinct i.period_month
    from public.invoices i
   where i.hostel_id = p_hostel_id
   order by i.period_month desc;
$$;

revoke execute on function public.billed_months(uuid) from public, anon;
grant execute on function public.billed_months(uuid) to authenticated;
