-- Fees: rates, invoices and payments (E7-T1 to E7-T5).
--
-- Money is never a single mutable balance. Rates (fee_structures) price a
-- sharing type over a date range; invoices snapshot what a month cost;
-- payments are append-only. Paid, partial, unpaid and overdue are derived
-- from those rows at read time (invoice_balances) and never stored. All
-- amounts are integer paise.
--
-- Rules, in one place:
--
-- * Rates. At most one rate per sharing type covers any day (an exclusion
--   constraint). Setting a new rate from date F closes the rate in force the
--   day before F. Re-entering a rate with the same start date corrects its
--   amount. A rate cannot be set before a later one that already exists.
--   Invoices copy their amount, so no rate change ever alters an invoice.
--
-- * Rent precedence. An allocation's rent_override wins. Otherwise the rate
--   for the room's sharing type in force on the 1st of the billing month.
--   A resident without either is reported as unpriced, never under-billed.
--
-- * Monthly billing. Each resident who held a bed on at least one night of
--   the month gets exactly one invoice for it:
--     amount = sum(rate * nights held in the month) / days in month,
--              rounded to the nearest rupee
--   A full month costs exactly the rate (rates are whole rupees in practice;
--   a rate with paise is billed as set). Arriving or leaving mid-month pays
--   for the nights held, and a mid-month transfer pays each bed's rate for
--   its own nights, on the same single invoice. An open-ended stay counts to
--   the end of the month, because rent is billed in advance; if the resident
--   later leaves early, void the invoice and generate the month again.
--
-- * Months and due dates are calendar months in Asia/Kolkata. Future months
--   cannot be billed. The due date is a chosen day (1-28) of the month.

-- ---------------------------------------------------------------------------
-- Rates (E7-T1, E7-T2)
-- ---------------------------------------------------------------------------
create table public.fee_structures (
  id uuid primary key default gen_random_uuid(),
  hostel_id uuid not null references public.hostels (id) on delete cascade,
  sharing_type text not null,
  monthly_amount integer not null,
  effective_from date not null,
  -- Last day the rate applies. Null while it is the current rate.
  effective_to date,
  created_by uuid default auth.uid() references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint fee_structures_sharing_type_valid
    check (sharing_type in ('single', 'double', 'triple', 'four_plus')),
  -- Up to ₹10,00,000 a month.
  constraint fee_structures_amount_range check (monthly_amount between 1 and 100000000),
  constraint fee_structures_dates_ordered check (effective_to >= effective_from),
  constraint fee_structures_no_overlap exclude using gist (
    hostel_id extensions.gist_uuid_ops with =,
    sharing_type extensions.gist_text_ops with =,
    daterange(effective_from, effective_to, '[]') with &&
  )
);

comment on table public.fee_structures is
  'Monthly rent per sharing type over a date range, in paise. Never overlapping per type.';

create trigger fee_structures_set_updated_at
  before update on public.fee_structures
  for each row execute function private.set_updated_at();

-- The rate in force for a sharing type on a day, or null when none is set.
create or replace function private.monthly_rate(p_hostel_id uuid, p_sharing_type text, p_on date)
returns integer
language sql
stable
security invoker
set search_path = ''
as $$
  select f.monthly_amount
    from public.fee_structures f
   where f.hostel_id = p_hostel_id
     and f.sharing_type = p_sharing_type
     and f.effective_from <= p_on
     and (f.effective_to is null or f.effective_to >= p_on);
$$;

grant execute on function private.monthly_rate(uuid, text, date) to authenticated;

-- Sets the rate for a sharing type from a date, applying the rules above in
-- one transaction. SECURITY INVOKER: only owners pass the table policies.
create or replace function public.set_fee_structure(
  p_hostel_id uuid,
  p_sharing_type text,
  p_monthly_amount integer,
  p_effective_from date
)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  later date;
  result uuid;
begin
  -- Two owners saving the same type at once apply one after the other.
  perform pg_advisory_xact_lock(
    hashtextextended('fee_structures:' || p_hostel_id::text || ':' || p_sharing_type, 0)
  );

  select min(f.effective_from) into later
    from public.fee_structures f
   where f.hostel_id = p_hostel_id
     and f.sharing_type = p_sharing_type
     and f.effective_from > p_effective_from;
  if later is not null then
    raise exception 'A later rate for this sharing type starts on %',
      to_char(later, 'FMDD Mon YYYY')
      using errcode = 'P0001', hint = 'fee_structure_later_exists';
  end if;

  -- Same start date: a correction of that rate's amount.
  update public.fee_structures f
     set monthly_amount = p_monthly_amount
   where f.hostel_id = p_hostel_id
     and f.sharing_type = p_sharing_type
     and f.effective_from = p_effective_from
  returning f.id into result;
  if result is not null then
    return result;
  end if;

  -- Close the rate in force, then open the new one.
  update public.fee_structures f
     set effective_to = p_effective_from - 1
   where f.hostel_id = p_hostel_id
     and f.sharing_type = p_sharing_type
     and f.effective_from < p_effective_from
     and (f.effective_to is null or f.effective_to >= p_effective_from);

  insert into public.fee_structures (hostel_id, sharing_type, monthly_amount, effective_from)
  values (p_hostel_id, p_sharing_type, p_monthly_amount, p_effective_from)
  returning id into result;
  return result;
end;
$$;

-- ---------------------------------------------------------------------------
-- Invoices (E7-T1, E7-T3)
-- ---------------------------------------------------------------------------
create table public.invoices (
  id uuid primary key default gen_random_uuid(),
  hostel_id uuid not null references public.hostels (id) on delete cascade,
  resident_id uuid not null,
  -- The stay the month was billed against: the latest one in the month.
  allocation_id uuid,
  -- First day of the billing month.
  period_month date not null,
  amount integer not null,
  due_date date not null,
  status text not null default 'issued',
  void_reason text,
  voided_at timestamptz,
  voided_by uuid references public.profiles (id) on delete set null,
  -- How the amount was reached: one entry per stay in the month, with its
  -- nights and rate. Shown on the printed invoice.
  breakdown jsonb not null default '[]'::jsonb,
  created_by uuid default auth.uid() references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint invoices_hostel_id_id_key unique (hostel_id, id),
  -- Composite tenant keys: an invoice never crosses hostels. NO ACTION keeps
  -- a resident or allocation with invoices from ever being deleted.
  constraint invoices_resident_fkey foreign key (hostel_id, resident_id)
    references public.residents (hostel_id, id),
  constraint invoices_allocation_fkey foreign key (hostel_id, allocation_id)
    references public.allocations (hostel_id, id),
  constraint invoices_period_is_month_start
    check (period_month = date_trunc('month', period_month)::date),
  constraint invoices_amount_positive check (amount > 0),
  constraint invoices_due_in_month
    check (due_date between period_month and (period_month + interval '1 month - 1 day')::date),
  constraint invoices_status_valid check (status in ('issued', 'void')),
  constraint invoices_void_has_reason check ((status = 'void') = (void_reason is not null)),
  constraint invoices_void_reason_length check (char_length(btrim(void_reason)) between 1 and 500),
  constraint invoices_breakdown_is_array check (jsonb_typeof(breakdown) = 'array')
);

comment on table public.invoices is
  'One issued invoice per resident per month. Amount is a snapshot; paid/overdue are derived.';

-- No duplicate bills: enforced here, not only by the generator. A voided
-- invoice frees the month so it can be generated again.
create unique index invoices_one_issued_per_month
  on public.invoices (resident_id, period_month) where status = 'issued';
create index invoices_hostel_period_idx on public.invoices (hostel_id, period_month desc);
create index invoices_hostel_due_idx on public.invoices (hostel_id, due_date);
create index invoices_allocation_idx on public.invoices (allocation_id);

create trigger invoices_set_updated_at
  before update on public.invoices
  for each row execute function private.set_updated_at();

-- An issued invoice can only be voided, once, with a reason, and only when
-- no live payment sits on it (void those first). Nothing else ever changes.
create or replace function private.invoices_guard_update()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if old.status = 'void' then
    raise exception 'This invoice is already void'
      using errcode = 'P0001', hint = 'invoice_void';
  end if;
  if new.status <> 'void' then
    raise exception 'Invoices cannot be edited; void it and generate the month again'
      using errcode = 'P0001', hint = 'invoice_immutable';
  end if;
  if exists (
    select 1 from public.payments p where p.invoice_id = old.id and p.voided_at is null
  ) then
    raise exception 'This invoice has payments recorded against it'
      using errcode = 'P0001', hint = 'invoice_has_payments';
  end if;
  new.voided_at := now();
  new.voided_by := (select auth.uid());
  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- Payments (E7-T1, E7-T4)
-- ---------------------------------------------------------------------------
create table public.payments (
  id uuid primary key default gen_random_uuid(),
  hostel_id uuid not null references public.hostels (id) on delete cascade,
  invoice_id uuid not null,
  amount integer not null,
  -- The day the money was received.
  paid_at date not null,
  mode text not null,
  reference text,
  recorded_by uuid not null default auth.uid() references public.profiles (id),
  voided_at timestamptz,
  void_reason text,
  voided_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),

  constraint payments_invoice_fkey foreign key (hostel_id, invoice_id)
    references public.invoices (hostel_id, id),
  constraint payments_amount_positive check (amount > 0),
  constraint payments_mode_valid check (mode in ('cash', 'upi', 'bank_transfer', 'card')),
  constraint payments_reference_length check (char_length(btrim(reference)) between 1 and 100),
  constraint payments_void_has_reason check ((voided_at is null) = (void_reason is null)),
  constraint payments_void_reason_length check (char_length(btrim(void_reason)) between 1 and 500)
);

comment on table public.payments is
  'Append-only money received against an invoice. Mistakes are voided with a reason, never edited.';

create index payments_invoice_idx on public.payments (invoice_id) where voided_at is null;
create index payments_hostel_paid_idx on public.payments (hostel_id, paid_at desc);
create index payments_hostel_created_idx on public.payments (hostel_id, created_at desc);

create trigger invoices_guard_update
  before update on public.invoices
  for each row execute function private.invoices_guard_update();

-- Payments land only on issued invoices, never in the future, and never
-- beyond what is still due. Payments for one invoice are serialised on an
-- advisory lock, so two collectors cannot overpay it between them.
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

  new.voided_at := null;
  new.void_reason := null;
  new.voided_by := null;
  return new;
end;
$$;

create trigger payments_guard_insert
  before insert on public.payments
  for each row execute function private.payments_guard_insert();

-- A payment changes once: when it is voided.
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
  if new.void_reason is null then
    raise exception 'Payments cannot be edited; void it and record it again'
      using errcode = 'P0001', hint = 'payment_immutable';
  end if;
  new.voided_at := now();
  new.voided_by := (select auth.uid());
  return new;
end;
$$;

create trigger payments_guard_update
  before update on public.payments
  for each row execute function private.payments_guard_update();

-- ---------------------------------------------------------------------------
-- Monthly invoice generation (E7-T3)
-- ---------------------------------------------------------------------------
-- One statement, so a failure leaves no partial batch. Re-running a month
-- inserts nothing new: the unique index decides, and the summary says how
-- many residents already had an invoice.
create or replace function public.generate_invoices(
  p_hostel_id uuid,
  p_period_month date,
  p_due_day integer default 5
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  month_start date := date_trunc('month', p_period_month)::date;
  month_end date := (date_trunc('month', p_period_month) + interval '1 month - 1 day')::date;
  days integer;
  result jsonb;
begin
  if p_period_month is null or p_period_month <> month_start then
    raise exception 'Choose a billing month' using errcode = 'P0001', hint = 'billing_month';
  end if;
  if month_start > date_trunc('month', private.today_ist())::date then
    raise exception 'A future month cannot be billed yet'
      using errcode = 'P0001', hint = 'billing_month_future';
  end if;
  if p_due_day is null or p_due_day not between 1 and 28 then
    raise exception 'Choose a due day between 1 and 28' using errcode = 'P0001', hint = 'due_day';
  end if;
  if not exists (select 1 from public.hostels h where h.id = p_hostel_id) then
    raise exception 'Hostel not found' using errcode = 'P0001', hint = 'hostel_not_found';
  end if;
  days := month_end - month_start + 1;

  with stays as (
    select
      a.id,
      a.resident_id,
      a.start_date,
      rm.room_number,
      rm.sharing_type,
      b.bed_label,
      greatest(a.start_date, month_start) as billed_from,
      least(coalesce(a.end_date, month_end), month_end) as billed_to,
      coalesce(a.rent_override, private.monthly_rate(p_hostel_id, rm.sharing_type, month_start))
        as rate,
      a.rent_override is not null as overridden
    from public.allocations a
    join public.rooms rm on rm.id = a.room_id
    join public.beds b on b.id = a.bed_id
    where a.hostel_id = p_hostel_id
      and a.start_date <= month_end
      and (a.end_date is null or a.end_date >= month_start)
  ),
  candidates as (
    select
      s.resident_id,
      bool_and(s.rate is not null) as priced,
      -- Whole months bill the exact rate; part months round to the rupee.
      case
        when bool_and(s.billed_from = month_start and s.billed_to = month_end)
          then sum(s.rate)::integer
        else (round(sum(s.rate::numeric * (s.billed_to - s.billed_from + 1)) / days / 100) * 100)::integer
      end as amount,
      (array_agg(s.id order by s.start_date desc))[1] as allocation_id,
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
      ) as breakdown,
      exists (
        select 1 from public.invoices i
         where i.resident_id = s.resident_id
           and i.period_month = month_start
           and i.status = 'issued'
      ) as already_invoiced
    from stays s
    group by s.resident_id
  ),
  inserted as (
    insert into public.invoices
      (hostel_id, resident_id, allocation_id, period_month, amount, due_date, breakdown)
    select p_hostel_id, c.resident_id, c.allocation_id, month_start, c.amount,
           month_start + (p_due_day - 1), c.breakdown
      from candidates c
     where c.priced and not c.already_invoiced and c.amount > 0
    on conflict (resident_id, period_month) where status = 'issued' do nothing
    returning resident_id, amount
  )
  select jsonb_build_object(
    'period_month', month_start,
    'created', (select count(*) from inserted),
    'total_amount', (select coalesce(sum(amount), 0) from inserted),
    -- Priced residents who were not inserted already had an invoice,
    -- whether found up front or lost to a concurrent run.
    'already_invoiced',
      (select count(*) from candidates c where c.priced) - (select count(*) from inserted),
    'unpriced', (
      select coalesce(
        jsonb_agg(
          jsonb_build_object('resident_id', r.id, 'full_name', r.full_name)
          order by r.full_name
        ),
        '[]'::jsonb
      )
      from candidates c
      join public.residents r on r.id = c.resident_id
      where not c.priced and not c.already_invoiced
    )
  ) into result;

  return result;
end;
$$;

-- ---------------------------------------------------------------------------
-- Derived balances (E7-T1, E7-T4, E7-T5)
-- ---------------------------------------------------------------------------
-- Per invoice: paid and balance from live payments, and a due status that
-- is never stored. Overdue means past the due date (today in India) with
-- money still owed. Void invoices carry no balance and no due status.
create view public.invoice_balances with (security_invoker = true) as
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
  b.bed_label
from public.invoices i
join public.residents r on r.id = i.resident_id
left join public.allocations a on a.id = i.allocation_id
left join public.rooms rm on rm.id = a.room_id
left join public.beds b on b.id = a.bed_id
left join lateral (
  select sum(pm.amount) as paid
    from public.payments pm
   where pm.invoice_id = i.id and pm.voided_at is null
) p on true;

-- Per resident: what they owe across every issued invoice. Balances are
-- never negative because overpayment is rejected per invoice.
create view public.resident_balances with (security_invoker = true) as
select
  b.hostel_id,
  b.resident_id,
  sum(b.amount)::bigint as invoiced,
  sum(b.paid)::bigint as paid,
  sum(b.balance)::bigint as outstanding,
  coalesce(sum(b.balance) filter (where b.due_status = 'overdue'), 0)::bigint as overdue,
  min(b.due_date) filter (where b.due_status = 'overdue') as oldest_overdue_due_date,
  (count(*) filter (where b.balance > 0))::integer as open_invoices
from public.invoice_balances b
where b.status = 'issued'
group by b.hostel_id, b.resident_id;

-- Running totals per due status for the fee list (E7-T6), with the same
-- optional month and room filters the list uses.
create or replace function public.fee_status_totals(
  p_hostel_id uuid,
  p_period_month date default null,
  p_room_id uuid default null
)
returns table (due_status text, invoices integer, amount bigint, paid bigint, balance bigint)
language sql
stable
security invoker
set search_path = ''
as $$
  select b.due_status,
         count(*)::integer,
         sum(b.amount)::bigint,
         sum(b.paid)::bigint,
         sum(b.balance)::bigint
    from public.invoice_balances b
   where b.hostel_id = p_hostel_id
     and b.status = 'issued'
     and (p_period_month is null or b.period_month = p_period_month)
     and (p_room_id is null or b.room_id = p_room_id)
   group by b.due_status;
$$;

-- ---------------------------------------------------------------------------
-- Privileges and row-level security
-- ---------------------------------------------------------------------------
-- Owners set rates, generate and void invoices, and void payments. Every
-- member (owner or staff) reads fees and records payments, since staff
-- usually collect the rent. Nothing is ever deleted by a user.
alter table public.fee_structures enable row level security;
alter table public.invoices enable row level security;
alter table public.payments enable row level security;

revoke all on public.fee_structures, public.invoices, public.payments from authenticated, anon;

grant select on public.fee_structures to authenticated;
grant insert (hostel_id, sharing_type, monthly_amount, effective_from)
  on public.fee_structures to authenticated;
grant update (monthly_amount, effective_to) on public.fee_structures to authenticated;

grant select on public.invoices to authenticated;
grant insert (hostel_id, resident_id, allocation_id, period_month, amount, due_date, breakdown)
  on public.invoices to authenticated;
grant update (status, void_reason) on public.invoices to authenticated;

grant select on public.payments to authenticated;
grant insert (hostel_id, invoice_id, amount, paid_at, mode, reference) on public.payments to authenticated;
grant update (void_reason) on public.payments to authenticated;

revoke all on public.invoice_balances, public.resident_balances from authenticated, anon;
grant select on public.invoice_balances, public.resident_balances to authenticated;

create policy "fee structures: members read"
  on public.fee_structures for select
  to authenticated
  using (hostel_id in (select private.user_hostel_ids()));

create policy "fee structures: owners create"
  on public.fee_structures for insert
  to authenticated
  with check (hostel_id in (select private.user_owned_hostel_ids()));

create policy "fee structures: owners update"
  on public.fee_structures for update
  to authenticated
  using (hostel_id in (select private.user_owned_hostel_ids()))
  with check (hostel_id in (select private.user_owned_hostel_ids()));

create policy "invoices: members read"
  on public.invoices for select
  to authenticated
  using (hostel_id in (select private.user_hostel_ids()));

create policy "invoices: owners issue"
  on public.invoices for insert
  to authenticated
  with check (hostel_id in (select private.user_owned_hostel_ids()) and status = 'issued');

create policy "invoices: owners void"
  on public.invoices for update
  to authenticated
  using (hostel_id in (select private.user_owned_hostel_ids()))
  with check (hostel_id in (select private.user_owned_hostel_ids()));

create policy "payments: members read"
  on public.payments for select
  to authenticated
  using (hostel_id in (select private.user_hostel_ids()));

create policy "payments: members record"
  on public.payments for insert
  to authenticated
  with check (hostel_id in (select private.user_hostel_ids()) and recorded_by = (select auth.uid()));

create policy "payments: owners void"
  on public.payments for update
  to authenticated
  using (hostel_id in (select private.user_owned_hostel_ids()))
  with check (hostel_id in (select private.user_owned_hostel_ids()));

revoke execute on function public.set_fee_structure(uuid, text, integer, date) from public, anon;
revoke execute on function public.generate_invoices(uuid, date, integer) from public, anon;
revoke execute on function public.fee_status_totals(uuid, date, uuid) from public, anon;
grant execute on function public.set_fee_structure(uuid, text, integer, date) to authenticated;
grant execute on function public.generate_invoices(uuid, date, integer) to authenticated;
grant execute on function public.fee_status_totals(uuid, date, uuid) to authenticated;
