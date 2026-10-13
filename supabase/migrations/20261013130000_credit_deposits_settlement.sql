-- Resident credit, security deposits and move-out settlement
-- (E13-T7, E13-T4, E13-T8).
--
-- Credit. Money received beyond what an invoice needs is not turned away:
-- it pays the resident's other open invoices, oldest first, and anything
-- left is kept as credit. Credit is applied automatically to every invoice
-- issued later. Applying credit is recorded as a payment with mode
-- 'credit', so invoice balances keep working exactly as before, while the
-- money itself was counted once, when it was received.
--
-- Deposits. A refundable deposit is held for the resident, never income. Its
-- ledger records what was asked for, received, deducted (with a reason),
-- used to pay dues on leaving (a payment with mode 'deposit') and refunded.
-- The amount held is derived and can never go below zero.
--
-- Settlement. On leaving: pending charges are billed, unused nights of a
-- month billed in advance become credit, credit and (if chosen) the deposit
-- pay what is owed, deductions are recorded, and what is left is refunded.
--
-- Payments with mode 'credit' or 'deposit' move money that was already
-- received, so they take no receipt number and are written only by these
-- functions. Credit and deposit receipts take numbers from the hostel's
-- receipt series instead.

-- ---------------------------------------------------------------------------
-- Payments that move credit or deposit money
-- ---------------------------------------------------------------------------
alter table public.payments drop constraint payments_mode_valid;
alter table public.payments add constraint payments_mode_valid
  check (mode in ('cash', 'upi', 'bank_transfer', 'card', 'credit', 'deposit'));

alter table public.payments drop constraint payments_number_format;
alter table public.payments alter column number drop not null;
alter table public.payments alter column number drop default;
alter table public.payments add constraint payments_number_format check (
  case
    when mode in ('credit', 'deposit') then number is null
    else number ~ '^RCT/[0-9]{2}-[0-9]{2}/[0-9]{5,}$' and char_length(number) <= 16
  end
);

create or replace function private.assign_document_number()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  -- Each table is read in its own branch: NEW has different columns on each.
  if tg_table_name = 'invoices' then
    new.number := private.next_document_number(new.hostel_id, 'invoice', private.today_ist());
  elsif tg_table_name = 'payments' then
    if new.mode in ('credit', 'deposit') then
      new.number := null;
    else
      new.number := private.next_document_number(new.hostel_id, 'receipt', private.today_ist());
    end if;
  else
    -- resident_credit and deposit_ledger: money received gets a receipt.
    if new.kind = 'received' then
      new.number := private.next_document_number(new.hostel_id, 'receipt', private.today_ist());
    else
      new.number := null;
    end if;
  end if;
  return new;
end;
$$;

-- Same rules as before; users may not move credit or deposit money directly.
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
  new.voided_at := null;
  new.void_reason := null;
  new.voided_by := null;
  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- Credit ledger
-- ---------------------------------------------------------------------------
create table public.resident_credit (
  id uuid primary key default gen_random_uuid(),
  hostel_id uuid not null references public.hostels (id) on delete cascade,
  resident_id uuid not null,
  -- received: money in; adjustment: credit given (unused nights);
  -- applied: credit used on an invoice; refund: credit paid back.
  kind text not null,
  amount integer not null,
  paid_at date not null default private.today_ist(),
  mode text,
  reference text,
  -- received only: the receipt number.
  number text,
  note text,
  invoice_id uuid,
  payment_id uuid,
  recorded_by uuid default auth.uid() references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),

  constraint resident_credit_hostel_id_id_key unique (hostel_id, id),
  constraint resident_credit_resident_fkey foreign key (hostel_id, resident_id)
    references public.residents (hostel_id, id),
  constraint resident_credit_invoice_fkey foreign key (hostel_id, invoice_id)
    references public.invoices (hostel_id, id),
  constraint resident_credit_kind_valid check (kind in ('received', 'adjustment', 'applied', 'refund')),
  constraint resident_credit_amount_positive check (amount between 1 and 100000000),
  constraint resident_credit_mode_valid check (mode in ('cash', 'upi', 'bank_transfer', 'card')),
  constraint resident_credit_money_has_mode check ((kind in ('received', 'refund')) = (mode is not null)),
  -- Applied credit names the invoice it paid; an adjustment the invoice it corrects.
  constraint resident_credit_names_invoice
    check ((kind in ('applied', 'adjustment')) = (invoice_id is not null)),
  constraint resident_credit_receipt_number check ((kind = 'received') = (number is not null)),
  constraint resident_credit_reference_length check (char_length(btrim(reference)) between 1 and 100),
  constraint resident_credit_note_length check (char_length(btrim(note)) between 1 and 500)
);

comment on table public.resident_credit is
  'Append-only ledger of credit a resident holds: received, given, applied to invoices, refunded.';

create index resident_credit_resident_idx on public.resident_credit (resident_id, created_at);
create unique index resident_credit_hostel_number_key
  on public.resident_credit (hostel_id, number) where number is not null;
-- One unused-nights adjustment per invoice.
create unique index resident_credit_one_adjustment_per_invoice
  on public.resident_credit (invoice_id) where kind = 'adjustment';

create trigger resident_credit_z_assign_number
  before insert on public.resident_credit
  for each row execute function private.assign_document_number();

create view public.resident_credit_balances with (security_invoker = true) as
select
  c.hostel_id,
  c.resident_id,
  (coalesce(sum(c.amount) filter (where c.kind in ('received', 'adjustment')), 0)
   - coalesce(sum(c.amount) filter (where c.kind in ('applied', 'refund')), 0))::integer as balance
from public.resident_credit c
group by c.hostel_id, c.resident_id;

-- ---------------------------------------------------------------------------
-- Deposits
-- ---------------------------------------------------------------------------
create table public.deposit_amounts (
  hostel_id uuid not null references public.hostels (id) on delete cascade,
  sharing_type text not null,
  amount integer not null,
  updated_at timestamptz not null default now(),
  primary key (hostel_id, sharing_type),
  constraint deposit_amounts_sharing_type_valid
    check (sharing_type in ('single', 'double', 'triple', 'four_plus')),
  constraint deposit_amounts_amount_range check (amount between 1 and 100000000)
);

create trigger deposit_amounts_set_updated_at
  before update on public.deposit_amounts
  for each row execute function private.set_updated_at();

create table public.deposit_ledger (
  id uuid primary key default gen_random_uuid(),
  hostel_id uuid not null references public.hostels (id) on delete cascade,
  resident_id uuid not null,
  -- due: asked for; received: money in; deduction: kept, with a reason;
  -- applied: used to pay dues; refund: paid back.
  kind text not null,
  amount integer not null,
  paid_at date not null default private.today_ist(),
  mode text,
  reference text,
  number text,
  note text,
  invoice_id uuid,
  payment_id uuid,
  recorded_by uuid default auth.uid() references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),

  constraint deposit_ledger_hostel_id_id_key unique (hostel_id, id),
  constraint deposit_ledger_resident_fkey foreign key (hostel_id, resident_id)
    references public.residents (hostel_id, id),
  constraint deposit_ledger_invoice_fkey foreign key (hostel_id, invoice_id)
    references public.invoices (hostel_id, id),
  constraint deposit_ledger_kind_valid check (kind in ('due', 'received', 'deduction', 'applied', 'refund')),
  constraint deposit_ledger_amount_positive check (amount between 1 and 100000000),
  constraint deposit_ledger_mode_valid check (mode in ('cash', 'upi', 'bank_transfer', 'card')),
  constraint deposit_ledger_money_has_mode check ((kind in ('received', 'refund')) = (mode is not null)),
  constraint deposit_ledger_deduction_has_note check (kind <> 'deduction' or note is not null),
  constraint deposit_ledger_applied_names_invoice check ((kind = 'applied') = (invoice_id is not null)),
  constraint deposit_ledger_receipt_number check ((kind = 'received') = (number is not null)),
  constraint deposit_ledger_reference_length check (char_length(btrim(reference)) between 1 and 100),
  constraint deposit_ledger_note_length check (char_length(btrim(note)) between 1 and 500)
);

comment on table public.deposit_ledger is
  'Append-only ledger of a resident''s refundable deposit. Never counted as rent.';

create index deposit_ledger_resident_idx on public.deposit_ledger (resident_id, created_at);
create unique index deposit_ledger_hostel_number_key
  on public.deposit_ledger (hostel_id, number) where number is not null;

create trigger deposit_ledger_z_assign_number
  before insert on public.deposit_ledger
  for each row execute function private.assign_document_number();

create view public.resident_deposits with (security_invoker = true) as
select
  d.hostel_id,
  d.resident_id,
  coalesce(sum(d.amount) filter (where d.kind = 'due'), 0)::integer as due,
  coalesce(sum(d.amount) filter (where d.kind = 'received'), 0)::integer as received,
  coalesce(sum(d.amount) filter (where d.kind = 'deduction'), 0)::integer as deducted,
  coalesce(sum(d.amount) filter (where d.kind = 'applied'), 0)::integer as applied,
  coalesce(sum(d.amount) filter (where d.kind = 'refund'), 0)::integer as refunded,
  (coalesce(sum(d.amount) filter (where d.kind = 'received'), 0)
   - coalesce(sum(d.amount) filter (where d.kind in ('deduction', 'applied', 'refund')), 0))::integer
    as held,
  greatest(
    coalesce(sum(d.amount) filter (where d.kind = 'due'), 0)
      - coalesce(sum(d.amount) filter (where d.kind = 'received'), 0),
    0
  )::integer as outstanding
from public.deposit_ledger d
group by d.hostel_id, d.resident_id;

-- Neither balance may go below zero. Checked under a per-resident lock by
-- every function that takes money out.
create or replace function private.credit_balance(p_resident_id uuid)
returns integer
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(sum(case when c.kind in ('received', 'adjustment') then c.amount else -c.amount end), 0)::integer
    from public.resident_credit c where c.resident_id = p_resident_id;
$$;

create or replace function private.deposit_held(p_resident_id uuid)
returns integer
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(sum(case when d.kind = 'received' then d.amount
                           when d.kind in ('deduction', 'applied', 'refund') then -d.amount
                           else 0 end), 0)::integer
    from public.deposit_ledger d where d.resident_id = p_resident_id;
$$;

create or replace function private.lock_resident_money(p_resident_id uuid)
returns void
language sql
security definer
set search_path = ''
as $$
  select pg_advisory_xact_lock(hashtextextended('resident_money:' || p_resident_id::text, 0));
$$;

-- The caller must be a member (or, with p_owner_only, the owner) of the
-- resident's hostel. Returns the hostel.
create or replace function private.require_resident_access(p_resident_id uuid, p_owner_only boolean)
returns uuid
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  hostel uuid;
begin
  select r.hostel_id into hostel from public.residents r where r.id = p_resident_id;
  if hostel is null
     or (p_owner_only and hostel not in (select private.user_owned_hostel_ids()))
     or (not p_owner_only and hostel not in (select private.user_hostel_ids())) then
    raise exception 'You do not have permission to do that' using errcode = '42501';
  end if;
  return hostel;
end;
$$;

-- Who a system-made payment is recorded by: the signed-in user, or the
-- hostel's owner when the database acts on its own (an invoice written by
-- a scheduled job or the service role).
create or replace function private.acting_user(p_hostel_id uuid)
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(auth.uid(), (select h.owner_id from public.hostels h where h.id = p_hostel_id));
$$;

-- ---------------------------------------------------------------------------
-- Applying credit and deposit to invoices
-- ---------------------------------------------------------------------------
-- Pays an invoice from the resident's credit, as far as both allow.
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
  select b.hostel_id, b.resident_id, b.balance, b.status into inv
    from public.invoice_balances b where b.id = p_invoice_id;
  if not found or inv.status <> 'issued' or inv.balance <= 0 then
    return 0;
  end if;
  perform private.lock_resident_money(inv.resident_id);
  available := private.credit_balance(inv.resident_id);
  used := least(available, inv.balance);
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

-- Pays every open invoice of a resident from their credit, oldest first.
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
     where b.resident_id = p_resident_id and b.status = 'issued' and b.balance > 0
     order by b.due_date, b.created_at
  loop
    total := total + private.apply_credit(inv);
  end loop;
  return total;
end;
$$;

-- Pays an invoice from the resident's deposit, as far as both allow.
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
  select b.hostel_id, b.resident_id, b.balance, b.status into inv
    from public.invoice_balances b where b.id = p_invoice_id;
  if not found or inv.status <> 'issued' or inv.balance <= 0 then
    return 0;
  end if;
  perform private.lock_resident_money(inv.resident_id);
  available := private.deposit_held(inv.resident_id);
  used := least(available, inv.balance);
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

-- New invoices take any credit the resident holds.
create or replace function private.invoices_apply_credit()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.apply_credit(new.id);
  return null;
end;
$$;

-- Deferred: the invoice's lines are written later in the same transaction.
create constraint trigger invoices_apply_credit
  after insert on public.invoices
  deferrable initially deferred
  for each row execute function private.invoices_apply_credit();

-- ---------------------------------------------------------------------------
-- Recording money
-- ---------------------------------------------------------------------------
-- A payment against an invoice. Anything beyond its balance pays the
-- resident's other open invoices, then stays as credit. Owners and staff.
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
  perform pg_advisory_xact_lock(hashtextextended('payments:' || p_invoice_id::text, 0));
  select b.hostel_id, b.resident_id, b.balance, b.status into inv
    from public.invoice_balances b where b.id = p_invoice_id;
  if not found then
    raise exception 'Invoice not found' using errcode = 'P0001', hint = 'invoice_not_found';
  end if;
  if inv.status <> 'issued' then
    raise exception 'Payments cannot be recorded against a void invoice'
      using errcode = 'P0001', hint = 'invoice_void';
  end if;

  to_invoice := least(p_amount, inv.balance);
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

-- Money received as credit: pays open invoices first, then is held.
create or replace function private.receive_credit(
  p_resident_id uuid,
  p_amount integer,
  p_paid_at date,
  p_mode text,
  p_reference text,
  p_note text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  hostel uuid := private.require_resident_access(p_resident_id, false);
  entry uuid;
begin
  if p_paid_at > private.today_ist() then
    raise exception 'A payment date cannot be in the future'
      using errcode = 'P0001', hint = 'payment_future';
  end if;
  perform private.lock_resident_money(p_resident_id);
  insert into public.resident_credit
    (hostel_id, resident_id, kind, amount, paid_at, mode, reference, note)
  values (hostel, p_resident_id, 'received', p_amount, p_paid_at, p_mode,
          nullif(btrim(p_reference), ''), p_note)
  returning id into entry;
  perform private.apply_credit_to_open_invoices(p_resident_id);
  return entry;
end;
$$;

-- An advance with no invoice to pay. Owners and staff.
create or replace function public.record_advance(
  p_resident_id uuid,
  p_amount integer,
  p_paid_at date,
  p_mode text,
  p_reference text default null
)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if p_amount is null or p_amount <= 0 then
    raise exception 'Enter an amount' using errcode = 'P0001', hint = 'payment_amount';
  end if;
  return private.receive_credit(p_resident_id, p_amount, p_paid_at, p_mode, p_reference, 'Advance');
end;
$$;

-- Pays credit back. Owners only, never more than is held.
create or replace function public.refund_credit(
  p_resident_id uuid,
  p_amount integer,
  p_mode text,
  p_reference text default null
)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
begin
  return private.take_money('credit', p_resident_id, 'refund', p_amount, p_mode, p_reference, null);
end;
$$;

-- Takes credit or deposit money out (refund, deduction) after checking the
-- caller owns the hostel and the balance covers it.
create or replace function private.take_money(
  p_ledger text,
  p_resident_id uuid,
  p_kind text,
  p_amount integer,
  p_mode text,
  p_reference text,
  p_note text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  hostel uuid := private.require_resident_access(p_resident_id, true);
  available integer;
  entry uuid;
begin
  if p_amount is null or p_amount <= 0 then
    raise exception 'Enter an amount' using errcode = 'P0001', hint = 'payment_amount';
  end if;
  perform private.lock_resident_money(p_resident_id);
  available := case p_ledger when 'credit' then private.credit_balance(p_resident_id)
                             else private.deposit_held(p_resident_id) end;
  if p_amount > available then
    raise exception 'Only % is held', '₹' || to_char(available / 100.0, 'FM999999990.00')
      using errcode = 'P0001', hint = 'balance_too_low';
  end if;

  if p_ledger = 'credit' then
    insert into public.resident_credit (hostel_id, resident_id, kind, amount, mode, reference, note)
    values (hostel, p_resident_id, p_kind, p_amount, p_mode, nullif(btrim(p_reference), ''), p_note)
    returning id into entry;
  else
    insert into public.deposit_ledger (hostel_id, resident_id, kind, amount, mode, reference, note)
    values (hostel, p_resident_id, p_kind, p_amount, p_mode, nullif(btrim(p_reference), ''), p_note)
    returning id into entry;
  end if;
  return entry;
end;
$$;

-- A deposit received. Owners and staff.
create or replace function public.record_deposit(
  p_resident_id uuid,
  p_amount integer,
  p_paid_at date,
  p_mode text,
  p_reference text default null
)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
begin
  return private.receive_deposit(p_resident_id, p_amount, p_paid_at, p_mode, p_reference);
end;
$$;

create or replace function private.receive_deposit(
  p_resident_id uuid,
  p_amount integer,
  p_paid_at date,
  p_mode text,
  p_reference text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  hostel uuid := private.require_resident_access(p_resident_id, false);
  entry uuid;
begin
  if p_amount is null or p_amount <= 0 then
    raise exception 'Enter an amount' using errcode = 'P0001', hint = 'payment_amount';
  end if;
  if p_paid_at > private.today_ist() then
    raise exception 'A payment date cannot be in the future'
      using errcode = 'P0001', hint = 'payment_future';
  end if;
  insert into public.deposit_ledger (hostel_id, resident_id, kind, amount, paid_at, mode, reference)
  values (hostel, p_resident_id, 'received', p_amount, p_paid_at, p_mode, nullif(btrim(p_reference), ''))
  returning id into entry;
  return entry;
end;
$$;

-- Keeps part of the deposit, with a reason. Owners only.
create or replace function public.deduct_deposit(p_resident_id uuid, p_amount integer, p_reason text)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if p_reason is null or btrim(p_reason) = '' then
    raise exception 'Give a reason' using errcode = 'P0001', hint = 'reason_required';
  end if;
  return private.take_money('deposit', p_resident_id, 'deduction', p_amount, null, null, p_reason);
end;
$$;

-- Pays the deposit back. Owners only, never more than is held.
create or replace function public.refund_deposit(
  p_resident_id uuid,
  p_amount integer,
  p_mode text,
  p_reference text default null
)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
begin
  return private.take_money('deposit', p_resident_id, 'refund', p_amount, p_mode, p_reference, null);
end;
$$;

-- A resident's first stay asks for the deposit set for its sharing type.
create or replace function private.allocations_request_deposit()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  amount integer;
begin
  if exists (select 1 from public.deposit_ledger d where d.resident_id = new.resident_id) then
    return null;
  end if;
  select da.amount into amount
    from public.deposit_amounts da
    join public.rooms rm on rm.id = new.room_id
   where da.hostel_id = new.hostel_id and da.sharing_type = rm.sharing_type;
  if amount is not null then
    insert into public.deposit_ledger (hostel_id, resident_id, kind, amount, paid_at, recorded_by)
    values (new.hostel_id, new.resident_id, 'due', amount, new.start_date, new.created_by);
  end if;
  return null;
end;
$$;

create trigger allocations_request_deposit
  after insert on public.allocations
  for each row execute function private.allocations_request_deposit();

-- ---------------------------------------------------------------------------
-- A resident's stays in a month, as invoice generation prices them
-- ---------------------------------------------------------------------------
create or replace function private.resident_month_stays(
  p_hostel_id uuid,
  p_resident_id uuid,
  p_month_start date
)
returns table (priced boolean, rent integer, allocation_id uuid, breakdown jsonb)
language sql
stable
security invoker
set search_path = ''
as $$
  with bounds as (
    select p_month_start as month_start,
           (p_month_start + interval '1 month - 1 day')::date as month_end
  ),
  stays as (
    select
      a.id,
      a.start_date,
      rm.room_number,
      rm.sharing_type,
      b.bed_label,
      greatest(a.start_date, bd.month_start) as billed_from,
      least(coalesce(a.end_date, bd.month_end), bd.month_end) as billed_to,
      coalesce(a.rent_override, private.monthly_rate(p_hostel_id, rm.sharing_type, bd.month_start))
        as rate,
      a.rent_override is not null as overridden,
      bd.month_start,
      bd.month_end
    from public.allocations a
    cross join bounds bd
    join public.rooms rm on rm.id = a.room_id
    join public.beds b on b.id = a.bed_id
    where a.hostel_id = p_hostel_id
      and a.resident_id = p_resident_id
      and a.start_date <= bd.month_end
      and (a.end_date is null or a.end_date >= bd.month_start)
  )
  select
    bool_and(s.rate is not null),
    case
      when bool_and(s.billed_from = s.month_start and s.billed_to = s.month_end)
        then sum(s.rate)::integer
      else (round(sum(s.rate::numeric * (s.billed_to - s.billed_from + 1))
                  / (max(s.month_end) - max(s.month_start) + 1) / 100) * 100)::integer
    end,
    (array_agg(s.id order by s.start_date desc))[1],
    jsonb_agg(
      jsonb_build_object(
        'allocation_id', s.id,
        'room_number', s.room_number,
        'bed_label', s.bed_label,
        'sharing_type', s.sharing_type,
        'from', s.billed_from,
        'to', s.billed_to,
        'nights', s.billed_to - s.billed_from + 1,
        'monthly_rate', s.rate,
        'rate_source', case when s.overridden then 'override' else 'structure' end
      )
      order by s.start_date
    )
  from stays s
  having count(*) > 0;
$$;

grant execute on function private.resident_month_stays(uuid, uuid, date) to authenticated, service_role;

-- What a month comes to for a resident now: rent, monthly heads and
-- discounts, without one-off charges. Used to find unused nights.
create or replace function private.resident_month_amount(
  p_hostel_id uuid,
  p_resident_id uuid,
  p_month_start date
)
returns integer
language plpgsql
stable
security invoker
set search_path = ''
as $$
declare
  s record;
  days integer := ((p_month_start + interval '1 month - 1 day')::date - p_month_start + 1);
  total integer;
begin
  select * into s from private.resident_month_stays(p_hostel_id, p_resident_id, p_month_start);
  if not found or not s.priced then
    return null;
  end if;
  select coalesce(sum((l ->> 'amount')::integer), 0) into total
    from jsonb_array_elements(
      private.month_lines(p_hostel_id, p_resident_id, p_month_start, days, s.breakdown, s.rent)
    ) l
   where l ->> 'kind' not in ('charge', 'late_fee');
  return total;
end;
$$;

grant execute on function private.resident_month_amount(uuid, uuid, date) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Move-out settlement
-- ---------------------------------------------------------------------------
-- What leaving would settle, without changing anything. For the statement.
create or replace function public.settlement_preview(p_resident_id uuid)
returns jsonb
language plpgsql
stable
security invoker
set search_path = ''
as $$
declare
  hostel uuid;
  last_id uuid;
  last_number text;
  last_month date;
  last_amount integer;
  now_amount integer;
  unused integer := 0;
  pending integer;
  dues integer;
  credit integer;
  held integer;
  deposit_due integer;
begin
  select r.hostel_id into hostel from public.residents r where r.id = p_resident_id;
  if hostel is null then
    raise exception 'Resident not found' using errcode = 'P0001', hint = 'resident_not_found';
  end if;

  -- The latest monthly invoice billed beyond the resident's last night.
  select i.id, i.number, i.period_month, i.amount
    into last_id, last_number, last_month, last_amount
    from public.invoices i
   where i.resident_id = p_resident_id and i.kind = 'monthly' and i.status = 'issued'
     and not exists (
       select 1 from public.resident_credit c where c.invoice_id = i.id and c.kind = 'adjustment'
     )
   order by i.period_month desc limit 1;
  if last_id is not null then
    now_amount := private.resident_month_amount(hostel, p_resident_id, last_month);
    if now_amount is not null and now_amount < last_amount then
      unused := last_amount - now_amount;
    end if;
  end if;

  select coalesce(sum(c.amount), 0) into pending
    from public.resident_charges c where c.resident_id = p_resident_id and c.status = 'pending';
  select coalesce(sum(b.balance), 0) into dues
    from public.invoice_balances b
   where b.resident_id = p_resident_id and b.status = 'issued' and b.balance > 0;
  select coalesce(sum(case when c.kind in ('received', 'adjustment') then c.amount else -c.amount end), 0)
    into credit from public.resident_credit c where c.resident_id = p_resident_id;
  select coalesce(d.held, 0), coalesce(d.outstanding, 0) into held, deposit_due
    from public.resident_deposits d where d.resident_id = p_resident_id;

  return jsonb_build_object(
    'unused_invoice_id', case when unused > 0 then last_id end,
    'unused_invoice_number', case when unused > 0 then last_number end,
    'unused_month', case when unused > 0 then last_month end,
    'unused_credit', unused,
    'pending_charges', pending,
    'dues', dues,
    'credit', credit,
    'deposit_held', coalesce(held, 0),
    'deposit_outstanding', coalesce(deposit_due, 0),
    -- Positive: refund to the resident. Negative: still owed.
    'net', coalesce(held, 0) + credit + unused - dues - pending
  );
end;
$$;

-- Settles a resident who is leaving. Owners only. Bills pending charges,
-- credits unused nights, pays dues from credit and (if chosen) the deposit,
-- records deductions, then refunds what is left in the chosen mode.
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

-- Credit given by the hostel (unused nights). Internal to settlement.
create or replace function private.give_credit(
  p_resident_id uuid,
  p_amount integer,
  p_invoice_id uuid,
  p_note text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.resident_credit (hostel_id, resident_id, kind, amount, invoice_id, note)
  select r.hostel_id, p_resident_id, 'adjustment', p_amount, p_invoice_id, p_note
    from public.residents r where r.id = p_resident_id;
end;
$$;

-- ---------------------------------------------------------------------------
-- Dashboard money: credit and deposits counted where they belong
-- ---------------------------------------------------------------------------
-- collected: money received in the range, whether it paid an invoice or
-- became credit; credit and deposit applied to invoices are not counted
-- again. deposits_held: refundable money held now, never income.
drop function public.dashboard_money(uuid, date, date);
create function public.dashboard_money(
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
-- Privileges and row-level security
-- ---------------------------------------------------------------------------
-- Ledgers are written only by the functions above; members read them.
-- Owners set deposit amounts.
alter table public.resident_credit enable row level security;
alter table public.deposit_amounts enable row level security;
alter table public.deposit_ledger enable row level security;

revoke all on public.resident_credit, public.deposit_amounts, public.deposit_ledger,
  public.resident_credit_balances, public.resident_deposits from authenticated, anon;

grant select on public.resident_credit, public.deposit_ledger to authenticated;
grant select on public.resident_credit_balances, public.resident_deposits to authenticated;
grant select on public.deposit_amounts to authenticated;
grant insert (hostel_id, sharing_type, amount) on public.deposit_amounts to authenticated;
grant update (amount) on public.deposit_amounts to authenticated;
grant delete on public.deposit_amounts to authenticated;

create policy "resident credit: members read"
  on public.resident_credit for select to authenticated
  using (hostel_id in (select private.user_hostel_ids()));
create policy "deposit ledger: members read"
  on public.deposit_ledger for select to authenticated
  using (hostel_id in (select private.user_hostel_ids()));
create policy "deposit amounts: members read"
  on public.deposit_amounts for select to authenticated
  using (hostel_id in (select private.user_hostel_ids()));
create policy "deposit amounts: owners write"
  on public.deposit_amounts for all to authenticated
  using (hostel_id in (select private.user_owned_hostel_ids()))
  with check (hostel_id in (select private.user_owned_hostel_ids()));

revoke all on function private.acting_user(uuid) from public;
grant execute on function private.acting_user(uuid) to authenticated, service_role;
revoke all on function private.credit_balance(uuid), private.deposit_held(uuid),
  private.lock_resident_money(uuid), private.require_resident_access(uuid, boolean),
  private.apply_credit(uuid), private.apply_credit_to_open_invoices(uuid),
  private.apply_deposit(uuid), private.receive_credit(uuid, integer, date, text, text, text),
  private.take_money(text, uuid, text, integer, text, text, text),
  private.receive_deposit(uuid, integer, date, text, text),
  private.give_credit(uuid, integer, uuid, text) from public;
grant execute on function private.credit_balance(uuid), private.deposit_held(uuid),
  private.lock_resident_money(uuid), private.require_resident_access(uuid, boolean),
  private.apply_credit(uuid), private.apply_credit_to_open_invoices(uuid),
  private.apply_deposit(uuid), private.receive_credit(uuid, integer, date, text, text, text),
  private.take_money(text, uuid, text, integer, text, text, text),
  private.receive_deposit(uuid, integer, date, text, text),
  private.give_credit(uuid, integer, uuid, text) to authenticated, service_role;

revoke execute on function public.record_payment(uuid, integer, date, text, text),
  public.record_advance(uuid, integer, date, text, text),
  public.refund_credit(uuid, integer, text, text),
  public.record_deposit(uuid, integer, date, text, text),
  public.deduct_deposit(uuid, integer, text),
  public.refund_deposit(uuid, integer, text, text),
  public.settlement_preview(uuid),
  public.settle_resident(uuid, jsonb, boolean, text, text),
  public.dashboard_money(uuid, date, date) from public, anon;
grant execute on function public.record_payment(uuid, integer, date, text, text),
  public.record_advance(uuid, integer, date, text, text),
  public.refund_credit(uuid, integer, text, text),
  public.record_deposit(uuid, integer, date, text, text),
  public.deduct_deposit(uuid, integer, text),
  public.refund_deposit(uuid, integer, text, text),
  public.settlement_preview(uuid),
  public.settle_resident(uuid, jsonb, boolean, text, text),
  public.dashboard_money(uuid, date, date) to authenticated;
