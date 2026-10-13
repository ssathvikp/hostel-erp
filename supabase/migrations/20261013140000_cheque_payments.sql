-- Cheque payments with clearance status (E13-T11).
--
-- A cheque is recorded like any payment, against an invoice, with its
-- number (the payment's reference) and bank. It is not money until it
-- clears: until then it does not reduce the invoice's balance and does not
-- count as collected. It does, however, hold its share of the invoice, so
-- nothing else (another payment, credit, the deposit) can pay the same
-- rupees twice while it is with the bank.
--
-- Clearing sets the day the bank paid it. A bounced cheque is voided with
-- its reason, like any mistaken payment, and is marked bounced; the owner
-- can add a bounce charge (an ordinary E13-T2 charge) in the same step.
-- A cheque is never turned into credit: it may not exceed what it can pay.

-- ---------------------------------------------------------------------------
-- Payments: the cheque mode and its clearance
-- ---------------------------------------------------------------------------
alter table public.payments
  add column cheque_bank text,
  add column cleared_on date,
  add column bounced boolean not null default false;

comment on column public.payments.cheque_bank is 'Cheques only: the bank the cheque is drawn on.';
comment on column public.payments.cleared_on is 'Cheques only: the day the bank paid it. Null while pending.';
comment on column public.payments.bounced is 'Cheques only: voided because the bank returned it.';

alter table public.payments drop constraint payments_mode_valid;
alter table public.payments add constraint payments_mode_valid
  check (mode in ('cash', 'upi', 'bank_transfer', 'card', 'cheque', 'credit', 'deposit'));

alter table public.payments
  add constraint payments_cheque_details check (
    case when mode = 'cheque' then reference is not null and cheque_bank is not null
         else cheque_bank is null and cleared_on is null and not bounced end
  ),
  add constraint payments_cheque_bank_length check (char_length(btrim(cheque_bank)) between 1 and 100),
  add constraint payments_cleared_after_received check (cleared_on >= paid_at),
  -- A bounced cheque is void and was never cleared.
  add constraint payments_bounced_is_void check (not bounced or (voided_at is not null and cleared_on is null));

create index payments_pending_cheques_idx on public.payments (hostel_id, paid_at)
  where mode = 'cheque' and cleared_on is null and voided_at is null;

-- Same rules as before, plus: a new cheque is always pending. The balance
-- checked here still counts pending cheques, so the rupees a cheque holds
-- cannot be paid a second time while it clears.
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

  if current_user = 'authenticated' and new.mode in ('credit', 'deposit') then
    raise exception 'Credit and deposits are applied by the settlement functions'
      using errcode = 'P0001', hint = 'payment_mode_internal';
  end if;

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
  new.cleared_on := null;
  new.bounced := false;
  new.voided_at := null;
  new.void_reason := null;
  new.voided_by := null;
  return new;
end;
$$;

-- A payment changes in two ways: a pending cheque clears, or the payment is
-- voided (a bounced cheque is voided too, and only while pending).
create or replace function private.payments_guard_update()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if old.voided_at is not null then
    raise exception 'This payment is already void'
      using errcode = 'P0001', hint = 'payment_void';
  end if;
  if new.amount <> old.amount or new.invoice_id <> old.invoice_id or new.mode <> old.mode
     or new.paid_at <> old.paid_at or new.reference is distinct from old.reference
     or new.cheque_bank is distinct from old.cheque_bank then
    raise exception 'Payments cannot be edited; void it and record it again'
      using errcode = 'P0001', hint = 'payment_immutable';
  end if;

  if new.void_reason is null then
    -- Clearing a pending cheque.
    if old.mode <> 'cheque' or new.cleared_on is null or new.bounced then
      raise exception 'Payments cannot be edited; void it and record it again'
        using errcode = 'P0001', hint = 'payment_immutable';
    end if;
    if old.cleared_on is not null then
      raise exception 'This cheque has already cleared'
        using errcode = 'P0001', hint = 'cheque_not_pending';
    end if;
    if new.cleared_on < old.paid_at
       or (current_user = 'authenticated' and new.cleared_on > private.today_ist()) then
      raise exception 'The clearing date must be between the day it was received and today'
        using errcode = 'P0001', hint = 'cheque_cleared_date';
    end if;
    return new;
  end if;

  -- Voiding. Clearing and voiding are separate steps.
  if new.cleared_on is distinct from old.cleared_on then
    raise exception 'Payments cannot be edited; void it and record it again'
      using errcode = 'P0001', hint = 'payment_immutable';
  end if;
  if new.bounced and (old.mode <> 'cheque' or old.cleared_on is not null) then
    raise exception 'Only a cheque that has not cleared can bounce'
      using errcode = 'P0001', hint = 'cheque_not_pending';
  end if;
  new.voided_at := now();
  new.voided_by := (select auth.uid());
  return new;
end;
$$;

grant insert (cheque_bank) on public.payments to authenticated;
grant update (cleared_on, bounced) on public.payments to authenticated;

-- ---------------------------------------------------------------------------
-- Balances: pending cheques do not pay anything yet
-- ---------------------------------------------------------------------------
-- pending_cheques is new, at the end. balance still means "not yet paid";
-- what can still be paid is balance - pending_cheques.
create or replace view public.invoice_balances with (security_invoker = true) as
select
  i.id,
  i.hostel_id,
  i.resident_id,
  i.allocation_id,
  i.period_month,
  i.amount,
  i.due_date,
  i.status,
  i.void_reason,
  i.created_at,
  coalesce(p.paid, 0)::integer as paid,
  case when i.status = 'issued' then i.amount - coalesce(p.paid, 0) else 0 end::integer as balance,
  case
    when i.status = 'void' then null
    when coalesce(p.paid, 0) >= i.amount then 'paid'
    when i.due_date < private.today_ist() then 'overdue'
    when coalesce(p.paid, 0) > 0 then 'partial'
    else 'unpaid'
  end as due_status,
  r.full_name as resident_name,
  r.phone as resident_phone,
  r.email as resident_email,
  a.room_id,
  rm.room_number,
  lpad(rm.room_number, 20, '0') as room_sort,
  b.bed_label,
  i.number,
  i.kind,
  case when i.status = 'issued' then coalesce(p.pending, 0) else 0 end::integer as pending_cheques
from public.invoices i
join public.residents r on r.id = i.resident_id
left join public.allocations a on a.id = i.allocation_id
left join public.rooms rm on rm.id = a.room_id
left join public.beds b on b.id = a.bed_id
left join lateral (
  select sum(pm.amount) filter (where pm.mode <> 'cheque' or pm.cleared_on is not null) as paid,
         sum(pm.amount) filter (where pm.mode = 'cheque' and pm.cleared_on is null) as pending
    from public.payments pm
   where pm.invoice_id = i.id and pm.voided_at is null
) p on true;

-- ---------------------------------------------------------------------------
-- Credit, deposit and new money pay only what no cheque holds
-- ---------------------------------------------------------------------------
create or replace function private.apply_credit(p_invoice_id uuid)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  inv record;
  available integer;
  used integer;
  payment uuid;
begin
  select b.hostel_id, b.resident_id, b.balance - b.pending_cheques as open, b.status into inv
    from public.invoice_balances b where b.id = p_invoice_id;
  if not found or inv.status <> 'issued' or inv.open <= 0 then
    return 0;
  end if;
  perform private.lock_resident_money(inv.resident_id);
  available := private.credit_balance(inv.resident_id);
  used := least(available, inv.open);
  if used <= 0 then
    return 0;
  end if;

  insert into public.payments (hostel_id, invoice_id, amount, paid_at, mode, recorded_by)
  values (inv.hostel_id, p_invoice_id, used, private.today_ist(), 'credit', private.acting_user(inv.hostel_id))
  returning id into payment;
  insert into public.resident_credit (hostel_id, resident_id, kind, amount, invoice_id, payment_id)
  values (inv.hostel_id, inv.resident_id, 'applied', used, p_invoice_id, payment);
  return used;
end;
$$;

create or replace function private.apply_credit_to_open_invoices(p_resident_id uuid)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  inv uuid;
  total integer := 0;
begin
  for inv in
    select b.id from public.invoice_balances b
     where b.resident_id = p_resident_id and b.status = 'issued'
       and b.balance - b.pending_cheques > 0
     order by b.due_date, b.created_at
  loop
    total := total + private.apply_credit(inv);
  end loop;
  return total;
end;
$$;

create or replace function private.apply_deposit(p_invoice_id uuid)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  inv record;
  available integer;
  used integer;
  payment uuid;
begin
  select b.hostel_id, b.resident_id, b.balance - b.pending_cheques as open, b.status into inv
    from public.invoice_balances b where b.id = p_invoice_id;
  if not found or inv.status <> 'issued' or inv.open <= 0 then
    return 0;
  end if;
  perform private.lock_resident_money(inv.resident_id);
  available := private.deposit_held(inv.resident_id);
  used := least(available, inv.open);
  if used <= 0 then
    return 0;
  end if;

  insert into public.payments (hostel_id, invoice_id, amount, paid_at, mode, recorded_by)
  values (inv.hostel_id, p_invoice_id, used, private.today_ist(), 'deposit', private.acting_user(inv.hostel_id))
  returning id into payment;
  insert into public.deposit_ledger (hostel_id, resident_id, kind, amount, invoice_id, payment_id)
  values (inv.hostel_id, inv.resident_id, 'applied', used, p_invoice_id, payment);
  return used;
end;
$$;

-- As before; cheques go through record_cheque, which has the bank.
create or replace function public.record_payment(
  p_invoice_id uuid,
  p_amount integer,
  p_paid_at date,
  p_mode text,
  p_reference text default null
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  inv record;
  to_invoice integer;
  extra integer;
  payment uuid;
begin
  if p_amount is null or p_amount <= 0 then
    raise exception 'Enter an amount' using errcode = 'P0001', hint = 'payment_amount';
  end if;
  if p_mode = 'cheque' then
    raise exception 'Record a cheque with its bank' using errcode = 'P0001', hint = 'cheque_details';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('payments:' || p_invoice_id::text, 0));
  select b.hostel_id, b.resident_id, b.balance - b.pending_cheques as open, b.status into inv
    from public.invoice_balances b where b.id = p_invoice_id;
  if not found then
    raise exception 'Invoice not found' using errcode = 'P0001', hint = 'invoice_not_found';
  end if;
  if inv.status <> 'issued' then
    raise exception 'Payments cannot be recorded against a void invoice'
      using errcode = 'P0001', hint = 'invoice_void';
  end if;

  to_invoice := least(p_amount, inv.open);
  extra := p_amount - to_invoice;
  if to_invoice > 0 then
    insert into public.payments (hostel_id, invoice_id, amount, paid_at, mode, reference)
    values (inv.hostel_id, p_invoice_id, to_invoice, p_paid_at, p_mode, p_reference)
    returning id into payment;
  end if;
  if extra > 0 then
    perform private.receive_credit(inv.resident_id, extra, p_paid_at, p_mode, p_reference,
                                   'Paid beyond the invoice');
  end if;
  return jsonb_build_object('payment_id', payment, 'to_invoice', to_invoice, 'extra', extra);
end;
$$;

-- A cheque received against an invoice, pending until it clears. Owners
-- and staff. It may not exceed what is still open on the invoice.
create or replace function public.record_cheque(
  p_invoice_id uuid,
  p_amount integer,
  p_paid_at date,
  p_cheque_number text,
  p_bank text
)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  payment uuid;
begin
  if p_amount is null or p_amount <= 0 then
    raise exception 'Enter an amount' using errcode = 'P0001', hint = 'payment_amount';
  end if;
  if nullif(btrim(p_cheque_number), '') is null or nullif(btrim(p_bank), '') is null then
    raise exception 'Enter the cheque number and bank' using errcode = 'P0001', hint = 'cheque_details';
  end if;
  insert into public.payments (hostel_id, invoice_id, amount, paid_at, mode, reference, cheque_bank)
  select b.hostel_id, p_invoice_id, p_amount, p_paid_at, 'cheque', btrim(p_cheque_number), btrim(p_bank)
    from public.invoice_balances b where b.id = p_invoice_id
  returning id into payment;
  if payment is null then
    raise exception 'Invoice not found' using errcode = 'P0001', hint = 'invoice_not_found';
  end if;
  return payment;
end;
$$;

-- The bank returned the cheque: void it with the reason and, if the owner
-- asks, add a bounce charge to the resident's next invoice. Owners only
-- (row-level security on the update).
create or replace function public.bounce_cheque(
  p_payment_id uuid,
  p_reason text,
  p_charge integer default null
)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  cheque record;
  charge uuid;
begin
  if p_reason is null or btrim(p_reason) = '' then
    raise exception 'Give a reason' using errcode = 'P0001', hint = 'reason_required';
  end if;
  if p_charge is not null and p_charge <= 0 then
    raise exception 'Enter a bounce charge above zero, or leave it empty'
      using errcode = 'P0001', hint = 'payment_amount';
  end if;

  update public.payments p
     set void_reason = btrim(p_reason), bounced = true
   where p.id = p_payment_id
  returning p.hostel_id, p.invoice_id, p.reference into cheque;
  if not found then
    raise exception 'You do not have permission to do that' using errcode = '42501';
  end if;

  if p_charge is not null then
    insert into public.resident_charges (hostel_id, resident_id, description, amount, charge_date)
    select cheque.hostel_id, i.resident_id, 'Cheque bounce charge (cheque ' || cheque.reference || ')',
           p_charge, private.today_ist()
      from public.invoices i where i.id = cheque.invoice_id
    returning id into charge;
  end if;
  return charge;
end;
$$;

-- Pending cheques for the hostel, oldest first.
create or replace view public.pending_cheques with (security_invoker = true) as
select
  p.id,
  p.hostel_id,
  p.invoice_id,
  p.amount,
  p.paid_at,
  p.reference as cheque_number,
  p.cheque_bank,
  p.number,
  p.recorded_by_name,
  i.number as invoice_number,
  i.resident_id,
  r.full_name as resident_name
from public.payments p
join public.invoices i on i.id = p.invoice_id
join public.residents r on r.id = i.resident_id
where p.mode = 'cheque' and p.cleared_on is null and p.voided_at is null;

-- ---------------------------------------------------------------------------
-- Settlement waits for cheques; late fees skip what a cheque covers
-- ---------------------------------------------------------------------------
create or replace function public.settle_resident(
  p_resident_id uuid,
  p_deductions jsonb default '[]'::jsonb,
  p_use_deposit boolean default true,
  p_refund_mode text default null,
  p_refund_reference text default null
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  preview jsonb;
  d jsonb;
  inv uuid;
  credit_left integer;
  deposit_left integer;
begin
  perform private.require_resident_access(p_resident_id, true);
  if private.resident_has_live_allocation(p_resident_id) then
    raise exception 'Vacate the resident''s bed before settling'
      using errcode = 'P0001', hint = 'settle_has_bed';
  end if;
  if exists (
    select 1 from public.invoice_balances b
     where b.resident_id = p_resident_id and b.pending_cheques > 0
  ) then
    raise exception 'Clear or bounce the resident''s pending cheques before settling'
      using errcode = 'P0001', hint = 'settle_cheque_pending';
  end if;
  perform private.lock_resident_money(p_resident_id);

  perform public.bill_pending_charges(p_resident_id);

  preview := public.settlement_preview(p_resident_id);
  if (preview ->> 'unused_credit')::integer > 0 then
    perform private.give_credit(
      p_resident_id, (preview ->> 'unused_credit')::integer,
      (preview ->> 'unused_invoice_id')::uuid,
      'Unused nights on ' || (preview ->> 'unused_invoice_number')
    );
  end if;
  perform private.apply_credit_to_open_invoices(p_resident_id);

  for d in select * from jsonb_array_elements(coalesce(p_deductions, '[]'::jsonb)) loop
    perform public.deduct_deposit(p_resident_id, (d ->> 'amount')::integer, d ->> 'reason');
  end loop;

  if p_use_deposit then
    for inv in
      select b.id from public.invoice_balances b
       where b.resident_id = p_resident_id and b.status = 'issued' and b.balance > 0
       order by b.due_date, b.created_at
    loop
      perform private.apply_deposit(inv);
    end loop;
  end if;

  if p_refund_mode is not null then
    credit_left := private.credit_balance(p_resident_id);
    if credit_left > 0 then
      perform public.refund_credit(p_resident_id, credit_left, p_refund_mode, p_refund_reference);
    end if;
    deposit_left := private.deposit_held(p_resident_id);
    if deposit_left > 0 then
      perform public.refund_deposit(p_resident_id, deposit_left, p_refund_mode, p_refund_reference);
    end if;
  end if;

  return public.settlement_preview(p_resident_id);
end;
$$;

-- As before, but an invoice whose open amount a pending cheque covers is not
-- late. If the cheque bounces, the fee is worked out from the due date then.
create or replace function private.apply_late_fees(p_hostel_id uuid)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  rule public.late_fee_rules%rowtype;
  today date := private.today_ist();
  inv record;
  fee integer;
  changed integer := 0;
  touched integer;
begin
  select * into rule from public.late_fee_rules r where r.hostel_id = p_hostel_id and r.active;
  if not found then
    return 0;
  end if;
  perform pg_advisory_xact_lock(hashtextextended('late_fees:' || p_hostel_id::text, 0));

  for inv in
    select b.id, b.resident_id, b.due_date, b.period_month, b.number
      from public.invoice_balances b
     where b.hostel_id = p_hostel_id
       and b.status = 'issued'
       and b.balance - b.pending_cheques > 0
       and b.due_date + rule.grace_days < today
  loop
    fee := private.late_fee_amount(rule, inv.due_date, today);
    if fee <= 0 then
      continue;
    end if;

    -- Grow a pending fee; billed and waived fees never change.
    update public.resident_charges c
       set amount = fee
     where c.for_invoice_id = inv.id
       and c.kind = 'late_fee'
       and c.status = 'pending'
       and c.amount < fee;
    get diagnostics touched = row_count;
    changed := changed + touched;

    if not exists (select 1 from public.resident_charges c where c.for_invoice_id = inv.id) then
      insert into public.resident_charges
        (hostel_id, resident_id, kind, description, amount, charge_date, for_invoice_id)
      values
        (p_hostel_id, inv.resident_id, 'late_fee', 'Late fee on ' || inv.number, fee, today, inv.id);
      changed := changed + 1;
    end if;
  end loop;
  return changed;
end;
$$;

-- ---------------------------------------------------------------------------
-- Dashboard: a cheque is collected once it clears
-- ---------------------------------------------------------------------------
create or replace function public.dashboard_money(
  p_hostel_id uuid,
  p_from date,
  p_to date
)
returns table (
  collected bigint,
  payments integer,
  billed bigint,
  invoices integer,
  outstanding bigint,
  overdue bigint,
  overdue_residents integer,
  deposits_held bigint
)
language plpgsql
stable
security invoker
set search_path = ''
as $$
begin
  if p_from is null or p_to is null or p_from > p_to then
    raise exception 'The start date must be on or before the end date'
      using errcode = 'P0001', hint = 'range_reversed';
  end if;

  return query
  with received as (
    select p.amount from public.payments p
     where p.hostel_id = p_hostel_id and p.voided_at is null
       and p.mode not in ('credit', 'deposit')
       and (p.mode <> 'cheque' or p.cleared_on is not null)
       and p.paid_at between p_from and p_to
    union all
    select c.amount from public.resident_credit c
     where c.hostel_id = p_hostel_id and c.kind = 'received'
       and c.paid_at between p_from and p_to
  )
  select
    coalesce((select sum(r.amount) from received r), 0)::bigint,
    (select count(*) from received)::integer,
    coalesce((select sum(i.amount) from public.invoices i
               where i.hostel_id = p_hostel_id and i.status = 'issued'
                 and i.period_month between p_from and p_to), 0)::bigint,
    (select count(*) from public.invoices i
      where i.hostel_id = p_hostel_id and i.status = 'issued'
        and i.period_month between p_from and p_to)::integer,
    coalesce((select sum(b.outstanding) from public.resident_balances b
               where b.hostel_id = p_hostel_id), 0)::bigint,
    coalesce((select sum(b.overdue) from public.resident_balances b
               where b.hostel_id = p_hostel_id), 0)::bigint,
    (select count(*) from public.resident_balances b
      where b.hostel_id = p_hostel_id and b.overdue > 0)::integer,
    coalesce((select sum(d.held) from public.resident_deposits d
               where d.hostel_id = p_hostel_id), 0)::bigint;
end;
$$;

-- ---------------------------------------------------------------------------
-- Privileges
-- ---------------------------------------------------------------------------
revoke all on public.pending_cheques from authenticated, anon;
grant select on public.pending_cheques to authenticated;

revoke execute on function public.record_cheque(uuid, integer, date, text, text),
  public.bounce_cheque(uuid, text, integer) from public, anon;
grant execute on function public.record_cheque(uuid, integer, date, text, text),
  public.bounce_cheque(uuid, text, integer) to authenticated;
