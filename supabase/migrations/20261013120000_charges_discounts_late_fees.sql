-- One-off charges, discounts and late fees (E13-T2, E13-T5, E13-T6).
--
-- * Charges. A resident charge (admission, damage, a key, a late fee) is
--   pending until it is billed: on the resident's next monthly invoice, or
--   on its own when the owner bills it now. A pending charge can be voided
--   with a reason; once billed it follows its invoice, and returns to
--   pending if that invoice is voided so the month can be generated again.
-- * Discounts. A percentage or fixed amount off rent or one fee head, for a
--   range of months, with a reason. Each discount is a negative line and
--   never takes a line below zero.
-- * Late fees. Per hostel: grace days after the due date, then a fixed fee
--   or a fee per day up to a cap. A late fee is a pending charge that keeps
--   growing (per-day fees) while the invoice stays unpaid and the fee is not
--   yet billed. Waiving it voids it with a reason; it is never re-applied.

-- ---------------------------------------------------------------------------
-- Invoices: monthly or for charges billed on their own
-- ---------------------------------------------------------------------------
alter table public.invoices
  add column kind text not null default 'monthly',
  add constraint invoices_kind_valid check (kind in ('monthly', 'charges'));

-- Only monthly invoices are one per resident per month.
drop index public.invoices_one_issued_per_month;
create unique index invoices_one_issued_per_month
  on public.invoices (resident_id, period_month) where status = 'issued' and kind = 'monthly';

grant insert (kind) on public.invoices to authenticated;

-- ---------------------------------------------------------------------------
-- One-time heads can be charged automatically on a resident's first stay
-- ---------------------------------------------------------------------------
alter table public.fee_heads
  add column charge_on_first_stay boolean not null default false,
  add constraint fee_heads_auto_one_time check (not charge_on_first_stay or billing = 'one_time');

grant update (charge_on_first_stay) on public.fee_heads to authenticated;
grant insert (charge_on_first_stay) on public.fee_heads to authenticated;

-- ---------------------------------------------------------------------------
-- Resident charges
-- ---------------------------------------------------------------------------
create table public.resident_charges (
  id uuid primary key default gen_random_uuid(),
  hostel_id uuid not null references public.hostels (id) on delete cascade,
  resident_id uuid not null,
  kind text not null default 'charge',
  fee_head_id uuid,
  description text not null,
  amount integer not null,
  -- The day the charge arose; it is billed on the first invoice for a month
  -- ending on or after it.
  charge_date date not null,
  status text not null default 'pending',
  invoice_id uuid,
  -- Late fees: the overdue invoice the fee is for.
  for_invoice_id uuid,
  void_reason text,
  voided_at timestamptz,
  voided_by uuid references public.profiles (id) on delete set null,
  created_by uuid default auth.uid() references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint resident_charges_hostel_id_id_key unique (hostel_id, id),
  constraint resident_charges_resident_fkey foreign key (hostel_id, resident_id)
    references public.residents (hostel_id, id),
  constraint resident_charges_head_fkey foreign key (hostel_id, fee_head_id)
    references public.fee_heads (hostel_id, id),
  constraint resident_charges_invoice_fkey foreign key (hostel_id, invoice_id)
    references public.invoices (hostel_id, id),
  constraint resident_charges_for_invoice_fkey foreign key (hostel_id, for_invoice_id)
    references public.invoices (hostel_id, id),
  constraint resident_charges_kind_valid check (kind in ('charge', 'late_fee')),
  constraint resident_charges_late_fee_names_invoice check ((kind = 'late_fee') = (for_invoice_id is not null)),
  constraint resident_charges_amount_range check (amount between 1 and 100000000),
  constraint resident_charges_description_length check (char_length(btrim(description)) between 1 and 200),
  constraint resident_charges_status_valid check (status in ('pending', 'invoiced', 'void')),
  constraint resident_charges_invoiced_has_invoice check ((status = 'invoiced') = (invoice_id is not null)),
  constraint resident_charges_void_has_reason check ((status = 'void') = (void_reason is not null)),
  constraint resident_charges_void_reason_length check (char_length(btrim(void_reason)) between 1 and 500)
);

comment on table public.resident_charges is
  'Charges outside the monthly cycle and late fees. Pending until billed on an invoice.';

create index resident_charges_resident_idx on public.resident_charges (resident_id, status);
create index resident_charges_invoice_idx on public.resident_charges (invoice_id) where invoice_id is not null;
-- One late fee per overdue invoice, ever: a waived fee is never applied again.
create unique index resident_charges_one_late_fee_per_invoice
  on public.resident_charges (for_invoice_id) where kind = 'late_fee';

create trigger resident_charges_set_updated_at
  before update on public.resident_charges
  for each row execute function private.set_updated_at();

-- Users only ever add a pending charge or void a pending one. Billing and
-- late-fee growth happen inside SECURITY DEFINER functions below, which run
-- as the database owner and so pass this guard.
create or replace function private.resident_charges_guard()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    if current_user = 'authenticated' then
      new.status := 'pending';
      new.invoice_id := null;
      new.void_reason := null;
      if new.kind = 'late_fee' then
        raise exception 'Late fees are applied by the late fee rule'
          using errcode = 'P0001', hint = 'late_fee_manual';
      end if;
    end if;
    return new;
  end if;

  if current_user = 'authenticated' then
    if old.status <> 'pending' then
      raise exception 'Only a pending charge can be changed'
        using errcode = 'P0001', hint = 'charge_not_pending';
    end if;
    if new.status <> 'void' then
      raise exception 'A pending charge can only be voided'
        using errcode = 'P0001', hint = 'charge_immutable';
    end if;
  end if;
  if new.status = 'void' and old.status <> 'void' then
    new.voided_at := now();
    new.voided_by := (select auth.uid());
  end if;
  return new;
end;
$$;

create trigger resident_charges_guard
  before insert or update on public.resident_charges
  for each row execute function private.resident_charges_guard();

-- Lines that bill a charge point back to it.
alter table public.invoice_lines
  add column charge_id uuid,
  add column discount_id uuid,
  add constraint invoice_lines_charge_fkey foreign key (hostel_id, charge_id)
    references public.resident_charges (hostel_id, id);

grant insert (charge_id, discount_id) on public.invoice_lines to authenticated;

-- ---------------------------------------------------------------------------
-- Discounts
-- ---------------------------------------------------------------------------
create table public.discounts (
  id uuid primary key default gen_random_uuid(),
  hostel_id uuid not null references public.hostels (id) on delete cascade,
  resident_id uuid not null,
  -- Null discounts rent; otherwise the fee head it applies to.
  fee_head_id uuid,
  percent integer,
  amount integer,
  from_month date not null,
  -- Last month it applies to; null while open-ended.
  to_month date,
  reason text not null,
  created_by uuid default auth.uid() references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint discounts_hostel_id_id_key unique (hostel_id, id),
  constraint discounts_resident_fkey foreign key (hostel_id, resident_id)
    references public.residents (hostel_id, id),
  constraint discounts_head_fkey foreign key (hostel_id, fee_head_id)
    references public.fee_heads (hostel_id, id),
  constraint discounts_one_measure check ((percent is null) <> (amount is null)),
  constraint discounts_percent_range check (percent between 1 and 100),
  constraint discounts_amount_range check (amount between 1 and 100000000),
  constraint discounts_from_is_month check (from_month = date_trunc('month', from_month)::date),
  constraint discounts_to_is_month check (to_month = date_trunc('month', to_month)::date),
  constraint discounts_months_ordered check (to_month >= from_month),
  constraint discounts_reason_length check (char_length(btrim(reason)) between 1 and 200)
);

create index discounts_resident_idx on public.discounts (resident_id, from_month);

create trigger discounts_set_updated_at
  before update on public.discounts
  for each row execute function private.set_updated_at();

-- A discount only ever ends (to_month moves earlier, never before it began).
create or replace function private.discounts_guard_update()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if new.to_month is null or (old.to_month is not null and new.to_month > old.to_month) then
    raise exception 'A discount can only be ended, not extended'
      using errcode = 'P0001', hint = 'discount_end_only';
  end if;
  return new;
end;
$$;

create trigger discounts_guard_update
  before update on public.discounts
  for each row execute function private.discounts_guard_update();

alter table public.invoice_lines
  add constraint invoice_lines_discount_fkey foreign key (hostel_id, discount_id)
    references public.discounts (hostel_id, id);

-- ---------------------------------------------------------------------------
-- Late fee rules
-- ---------------------------------------------------------------------------
create table public.late_fee_rules (
  hostel_id uuid primary key references public.hostels (id) on delete cascade,
  grace_days integer not null default 0,
  kind text not null,
  amount integer not null,
  -- Per-day fees stop growing here.
  cap integer,
  active boolean not null default true,
  updated_at timestamptz not null default now(),

  constraint late_fee_rules_grace_range check (grace_days between 0 and 60),
  constraint late_fee_rules_kind_valid check (kind in ('fixed', 'per_day')),
  constraint late_fee_rules_amount_range check (amount between 1 and 10000000),
  constraint late_fee_rules_cap check ((kind = 'per_day') = (cap is not null) and (cap is null or cap >= amount))
);

create trigger late_fee_rules_set_updated_at
  before update on public.late_fee_rules
  for each row execute function private.set_updated_at();

-- What the late fee on an invoice comes to on a day under a rule.
create or replace function private.late_fee_amount(
  p_rule public.late_fee_rules,
  p_due_date date,
  p_on date
)
returns integer
language sql
immutable
set search_path = ''
as $$
  select case
    when p_on <= p_due_date + p_rule.grace_days then 0
    when p_rule.kind = 'fixed' then p_rule.amount
    else least(p_rule.cap, p_rule.amount * (p_on - p_due_date - p_rule.grace_days))
  end;
$$;

-- Applies the hostel's rule to every overdue invoice: adds a late fee where
-- none exists yet and grows a pending per-day fee to today's amount. Safe to
-- run any number of times. SECURITY DEFINER, because late fees are the one
-- charge users cannot write or change; it lives in the private schema, so
-- it is reached only through public.apply_late_fees (which checks the
-- caller owns the hostel) or the daily job.
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
       and b.balance > 0
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

-- What owners call. SECURITY INVOKER, like every public function: it only
-- checks the caller owns the hostel, then hands over to the private worker.
create or replace function public.apply_late_fees(p_hostel_id uuid)
returns integer
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if p_hostel_id is null or p_hostel_id not in (select private.user_owned_hostel_ids()) then
    raise exception 'Only the hostel owner can apply late fees'
      using errcode = '42501';
  end if;
  return private.apply_late_fees(p_hostel_id);
end;
$$;

-- The daily job: every hostel with an active rule.
create or replace function private.apply_all_late_fees()
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  hostel uuid;
begin
  for hostel in select r.hostel_id from public.late_fee_rules r where r.active loop
    perform private.apply_late_fees(hostel);
  end loop;
end;
$$;

create extension if not exists pg_cron;

-- 00:30 in India (19:00 UTC), after the day has turned.
select cron.schedule('apply-late-fees', '0 19 * * *', $$select private.apply_all_late_fees()$$);

-- ---------------------------------------------------------------------------
-- When an invoice is voided, what it billed becomes pending again
-- ---------------------------------------------------------------------------
create or replace function private.invoices_release_charges()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.status = 'void' and old.status <> 'void' then
    update public.resident_charges
       set status = 'pending', invoice_id = null
     where invoice_id = new.id and status = 'invoiced';
  end if;
  return null;
end;
$$;

create trigger invoices_release_charges
  after update of status on public.invoices
  for each row execute function private.invoices_release_charges();

-- ---------------------------------------------------------------------------
-- Admission and other first-stay charges
-- ---------------------------------------------------------------------------
create or replace function private.allocations_first_stay_charges()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  sharing text;
begin
  if exists (
    select 1 from public.allocations a where a.resident_id = new.resident_id and a.id <> new.id
  ) then
    return null;
  end if;
  select rm.sharing_type into sharing from public.rooms rm where rm.id = new.room_id;

  insert into public.resident_charges
    (hostel_id, resident_id, fee_head_id, description, amount, charge_date, created_by)
  select new.hostel_id, new.resident_id, h.id, h.name,
         private.fee_head_rate(h.id, sharing, new.start_date), new.start_date, new.created_by
    from public.fee_heads h
   where h.hostel_id = new.hostel_id
     and h.billing = 'one_time'
     and h.charge_on_first_stay
     and h.active
     and private.fee_head_rate(h.id, sharing, new.start_date) is not null;
  return null;
end;
$$;

create trigger allocations_first_stay_charges
  after insert on public.allocations
  for each row execute function private.allocations_first_stay_charges();

-- ---------------------------------------------------------------------------
-- Every line of a resident's monthly invoice
-- ---------------------------------------------------------------------------
-- Rent, monthly heads (private.month_fee_lines), pending charges and late
-- fees dated in or before the month, then discounts. A discount comes off
-- the line it names and never takes that line below zero.
create or replace function private.month_lines(
  p_hostel_id uuid,
  p_resident_id uuid,
  p_month_start date,
  p_days integer,
  p_stays jsonb,
  p_rent integer
)
returns jsonb
language plpgsql
stable
security invoker
set search_path = ''
as $$
declare
  month_end date := (p_month_start + interval '1 month - 1 day')::date;
  lines jsonb := '[]'::jsonb;
  d record;
  base integer;
  taken integer;
  off integer;
  remaining jsonb := '{}'::jsonb;
  original jsonb;
  target text;
begin
  if p_rent > 0 then
    lines := jsonb_build_array(jsonb_build_object(
      'kind', 'rent',
      'description', 'Rent',
      'detail', jsonb_build_object('stays', p_stays),
      'amount', p_rent
    ));
  end if;
  lines := lines || private.month_fee_lines(p_hostel_id, p_resident_id, p_month_start, p_days, p_stays);

  lines := lines || coalesce((
    select jsonb_agg(
             jsonb_build_object(
               'kind', c.kind,
               'charge_id', c.id,
               'fee_head_id', c.fee_head_id,
               'description', c.description,
               'detail', jsonb_build_object('date', c.charge_date),
               'amount', c.amount
             )
             order by c.charge_date, c.created_at
           )
      from public.resident_charges c
     where c.resident_id = p_resident_id
       and c.status = 'pending'
       and c.charge_date <= month_end
  ), '[]'::jsonb);

  -- What each line can still be discounted by, keyed by its target: 'rent'
  -- or the fee head id.
  select coalesce(jsonb_object_agg(k, v), '{}'::jsonb) into remaining
    from (
      select case when l ->> 'kind' = 'rent' then 'rent' else l ->> 'fee_head_id' end as k,
             sum((l ->> 'amount')::integer) as v
        from jsonb_array_elements(lines) l
       where l ->> 'kind' in ('rent', 'fee')
       group by 1
    ) t;
  original := remaining;

  for d in
    select ds.*, h.name as head_name
      from public.discounts ds
      left join public.fee_heads h on h.id = ds.fee_head_id
     where ds.resident_id = p_resident_id
       and ds.from_month <= p_month_start
       and (ds.to_month is null or ds.to_month >= p_month_start)
     order by ds.created_at
  loop
    target := coalesce(d.fee_head_id::text, 'rent');
    base := coalesce((remaining ->> target)::integer, 0);
    if base <= 0 then
      continue;
    end if;
    taken := case
      when d.percent is not null then
        (round((original ->> target)::numeric * d.percent / 100 / 100) * 100)::integer
      else d.amount
    end;
    off := least(base, taken);
    if off <= 0 then
      continue;
    end if;
    remaining := jsonb_set(remaining, array[target], to_jsonb(base - off));
    lines := lines || jsonb_build_array(jsonb_build_object(
      'kind', 'discount',
      'discount_id', d.id,
      'description', 'Discount on ' || coalesce(d.head_name, 'rent') || ': ' || d.reason,
      'detail', case when d.percent is not null
                  then jsonb_build_object('percent', d.percent)
                  else '{}'::jsonb end,
      'amount', -off
    ));
  end loop;

  return lines;
end;
$$;

grant execute on function private.month_lines(uuid, uuid, date, integer, jsonb, integer)
  to authenticated, service_role;

-- Writes an invoice's lines and marks the charges it bills. SECURITY
-- DEFINER so it can move charges to invoiced; it lives in the private
-- schema, which the API never exposes, and is called only by the billing
-- functions after they have checked the caller.
create or replace function private.write_invoice_lines(
  p_hostel_id uuid,
  p_invoice_id uuid,
  p_lines jsonb
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.invoice_lines
    (hostel_id, invoice_id, position, kind, fee_head_id, charge_id, discount_id, description, detail, amount)
  select p_hostel_id, p_invoice_id, e.ord, e.l ->> 'kind', (e.l ->> 'fee_head_id')::uuid,
         (e.l ->> 'charge_id')::uuid, (e.l ->> 'discount_id')::uuid, e.l ->> 'description',
         coalesce(e.l -> 'detail', '{}'::jsonb), (e.l ->> 'amount')::integer
    from jsonb_array_elements(p_lines) with ordinality as e(l, ord);

  update public.resident_charges c
     set status = 'invoiced', invoice_id = p_invoice_id
   where c.id in (
     select (l ->> 'charge_id')::uuid from jsonb_array_elements(p_lines) l
      where l ->> 'charge_id' is not null
   );
end;
$$;

grant execute on function private.write_invoice_lines(uuid, uuid, jsonb) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Monthly invoice generation, with charges and discounts
-- ---------------------------------------------------------------------------
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
  r record;
  lines jsonb;
  invoice_total integer;
  new_invoice uuid;
  created integer := 0;
  total_amount bigint := 0;
  already integer := 0;
  unpriced jsonb := '[]'::jsonb;
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

  perform pg_advisory_xact_lock(
    hashtextextended('generate_invoices:' || p_hostel_id::text || ':' || month_start::text, 0)
  );

  for r in
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
    )
    select
      s.resident_id,
      res.full_name,
      bool_and(s.rate is not null) as priced,
      case
        when bool_and(s.billed_from = month_start and s.billed_to = month_end)
          then sum(s.rate)::integer
        else (round(sum(s.rate::numeric * (s.billed_to - s.billed_from + 1)) / days / 100) * 100)::integer
      end as rent,
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
           and i.kind = 'monthly'
      ) as already_invoiced
    from stays s
    join public.residents res on res.id = s.resident_id
    group by s.resident_id, res.full_name
    order by res.full_name, s.resident_id
  loop
    if not r.priced then
      if not r.already_invoiced then
        unpriced := unpriced || jsonb_build_object('resident_id', r.resident_id, 'full_name', r.full_name);
      end if;
      continue;
    end if;

    -- Pending charges are billed once: hold them while this invoice is written.
    perform 1 from public.resident_charges c
     where c.resident_id = r.resident_id and c.status = 'pending'
       for update;

    lines := private.month_lines(p_hostel_id, r.resident_id, month_start, days, r.breakdown, r.rent);
    select coalesce(sum((l ->> 'amount')::integer), 0) into invoice_total
      from jsonb_array_elements(lines) l;

    if invoice_total <= 0 then
      continue;
    end if;
    if r.already_invoiced then
      already := already + 1;
      continue;
    end if;

    insert into public.invoices
      (hostel_id, resident_id, allocation_id, period_month, amount, due_date, breakdown)
    values
      (p_hostel_id, r.resident_id, r.allocation_id, month_start, invoice_total,
       month_start + (p_due_day - 1), r.breakdown)
    on conflict (resident_id, period_month) where status = 'issued' and kind = 'monthly' do nothing
    returning id into new_invoice;
    if new_invoice is null then
      already := already + 1;
      continue;
    end if;

    perform private.write_invoice_lines(p_hostel_id, new_invoice, lines);
    created := created + 1;
    total_amount := total_amount + invoice_total;
  end loop;

  return jsonb_build_object(
    'period_month', month_start,
    'created', created,
    'total_amount', total_amount,
    'already_invoiced', already,
    'unpriced', unpriced
  );
end;
$$;

-- Bills a resident's pending charges now, on an invoice of their own, due
-- today. Returns the new invoice, or null when nothing is pending.
create or replace function public.bill_pending_charges(p_resident_id uuid)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  hostel uuid;
  lines jsonb;
  total integer;
  today date := private.today_ist();
  new_invoice uuid;
begin
  select r.hostel_id into hostel from public.residents r where r.id = p_resident_id;
  if not found then
    raise exception 'Resident not found' using errcode = 'P0001', hint = 'resident_not_found';
  end if;

  perform 1 from public.resident_charges c
   where c.resident_id = p_resident_id and c.status = 'pending'
     for update;

  select coalesce(jsonb_agg(
           jsonb_build_object(
             'kind', c.kind,
             'charge_id', c.id,
             'fee_head_id', c.fee_head_id,
             'description', c.description,
             'detail', jsonb_build_object('date', c.charge_date),
             'amount', c.amount
           )
           order by c.charge_date, c.created_at
         ), '[]'::jsonb),
         coalesce(sum(c.amount), 0)
    into lines, total
    from public.resident_charges c
   where c.resident_id = p_resident_id and c.status = 'pending';

  if total = 0 then
    return null;
  end if;

  insert into public.invoices
    (hostel_id, resident_id, period_month, amount, due_date, kind)
  values
    (hostel, p_resident_id, date_trunc('month', today)::date, total, today, 'charges')
  returning id into new_invoice;
  perform private.write_invoice_lines(hostel, new_invoice, lines);
  return new_invoice;
end;
$$;

-- ---------------------------------------------------------------------------
-- Read model: invoice kind on the fee list
-- ---------------------------------------------------------------------------
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
  i.kind
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

-- ---------------------------------------------------------------------------
-- Privileges and row-level security
-- ---------------------------------------------------------------------------
-- Owners and staff add charges (front-desk work); owners void charges, give
-- discounts and set the late fee rule. Everyone in the hostel reads them.
alter table public.resident_charges enable row level security;
alter table public.discounts enable row level security;
alter table public.late_fee_rules enable row level security;

revoke all on public.resident_charges, public.discounts, public.late_fee_rules from authenticated, anon;

grant select on public.resident_charges to authenticated;
grant insert (hostel_id, resident_id, kind, fee_head_id, description, amount, charge_date, for_invoice_id)
  on public.resident_charges to authenticated;
grant update (status, void_reason) on public.resident_charges to authenticated;

grant select on public.discounts to authenticated;
grant insert (hostel_id, resident_id, fee_head_id, percent, amount, from_month, to_month, reason)
  on public.discounts to authenticated;
grant update (to_month) on public.discounts to authenticated;

grant select on public.late_fee_rules to authenticated;
grant insert (hostel_id, grace_days, kind, amount, cap, active) on public.late_fee_rules to authenticated;
grant update (grace_days, kind, amount, cap, active) on public.late_fee_rules to authenticated;

create policy "resident charges: members read"
  on public.resident_charges for select to authenticated
  using (hostel_id in (select private.user_hostel_ids()));
-- Members add ordinary charges; late fees come only from apply_late_fees.
create policy "resident charges: members add"
  on public.resident_charges for insert to authenticated
  with check (hostel_id in (select private.user_hostel_ids()) and kind = 'charge');
create policy "resident charges: owners change"
  on public.resident_charges for update to authenticated
  using (hostel_id in (select private.user_owned_hostel_ids()))
  with check (hostel_id in (select private.user_owned_hostel_ids()));

create policy "discounts: members read"
  on public.discounts for select to authenticated
  using (hostel_id in (select private.user_hostel_ids()));
create policy "discounts: owners give"
  on public.discounts for insert to authenticated
  with check (hostel_id in (select private.user_owned_hostel_ids()));
create policy "discounts: owners end"
  on public.discounts for update to authenticated
  using (hostel_id in (select private.user_owned_hostel_ids()))
  with check (hostel_id in (select private.user_owned_hostel_ids()));

create policy "late fee rules: members read"
  on public.late_fee_rules for select to authenticated
  using (hostel_id in (select private.user_hostel_ids()));
create policy "late fee rules: owners create"
  on public.late_fee_rules for insert to authenticated
  with check (hostel_id in (select private.user_owned_hostel_ids()));
create policy "late fee rules: owners change"
  on public.late_fee_rules for update to authenticated
  using (hostel_id in (select private.user_owned_hostel_ids()))
  with check (hostel_id in (select private.user_owned_hostel_ids()));

revoke execute on function public.apply_late_fees(uuid) from public, anon;
revoke execute on function public.bill_pending_charges(uuid) from public, anon;
grant execute on function public.apply_late_fees(uuid) to authenticated;
grant execute on function public.bill_pending_charges(uuid) to authenticated;
revoke all on function private.apply_all_late_fees() from public;
revoke all on function private.apply_late_fees(uuid) from public;
grant execute on function private.apply_late_fees(uuid) to authenticated;
