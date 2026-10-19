-- Itemised fees (ClickUp EP-13): fee heads (E13-T1), one-time and ad-hoc
-- charges (E13-T2), metered electricity (E13-T3) and discounts (E13-T5).
--
-- Rules, on top of the MVP's (paise, immutable invoices, append-only money):
-- - A fee head is a named charge besides rent: monthly (mess, maintenance)
--   or one-time (admission). Its price is per sharing type or one price for
--   all, over effective dates that never overlap.
-- - A monthly invoice is now itemised in invoice_lines: one rent line, one
--   line per monthly head (prorated by nights like rent), a negative line
--   per discount, and one line per pending charge. The database checks at
--   commit that an invoice's lines add up to its amount.
-- - Charges wait as "pending" until the next monthly invoice picks them up,
--   or until the owner bills them on their own ("bill now").
-- - Electricity: staff record a meter reading per room per month; billing
--   a month turns each room's units × the hostel's rate into charges, split
--   among the room's residents by nights held. A room without a reading is
--   listed, never billed as zero.
-- - Discounts are percentage or fixed, on rent or on one head, for a range
--   of months, with a reason. They never take a line below zero.

-- ---------------------------------------------------------------------------
-- Fee heads and their prices
-- ---------------------------------------------------------------------------
create table public.fee_heads (
  id uuid primary key default gen_random_uuid(),
  hostel_id uuid not null references public.hostels (id) on delete cascade,
  name text not null,
  kind text not null,
  -- One-time heads only: charged automatically on a resident's first stay.
  on_first_allocation boolean not null default false,
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  constraint fee_heads_hostel_id_id_key unique (hostel_id, id),
  constraint fee_heads_name_length check (char_length(btrim(name)) between 1 and 60),
  constraint fee_heads_kind_valid check (kind in ('monthly', 'one_time')),
  constraint fee_heads_first_allocation_one_time check (not on_first_allocation or kind = 'one_time')
);

comment on table public.fee_heads is
  'Named charges besides rent: monthly (mess, maintenance) or one-time (admission). Archived, never deleted.';

create unique index fee_heads_name_key
  on public.fee_heads (hostel_id, lower(btrim(name))) where archived_at is null;

create table public.fee_head_prices (
  id uuid primary key default gen_random_uuid(),
  hostel_id uuid not null,
  head_id uuid not null,
  -- Null: one price for every sharing type.
  sharing_type text,
  amount integer not null,
  effective_from date not null,
  effective_to date,
  created_at timestamptz not null default now(),
  constraint fee_head_prices_head_fkey foreign key (hostel_id, head_id)
    references public.fee_heads (hostel_id, id) on delete cascade,
  constraint fee_head_prices_sharing_type_valid
    check (sharing_type in ('single', 'double', 'triple', 'four_plus')),
  constraint fee_head_prices_amount_range check (amount between 1 and 100000000),
  constraint fee_head_prices_dates_ordered check (effective_to >= effective_from),
  constraint fee_head_prices_no_overlap exclude using gist (
    head_id extensions.gist_uuid_ops with =,
    (coalesce(sharing_type, 'all')) extensions.gist_text_ops with =,
    daterange(effective_from, effective_to, '[]') with &&
  )
);

comment on table public.fee_head_prices is
  'A fee head''s price per sharing type (or for all) over a date range, in paise.';

-- The price of a head for a sharing type on a day: the type's own price,
-- else the price for all types, else none.
create or replace function private.head_price(p_head_id uuid, p_sharing_type text, p_on date)
returns integer
language sql
stable
security invoker
set search_path = ''
as $$
  select p.amount
    from public.fee_head_prices p
   where p.head_id = p_head_id
     and (p.sharing_type = p_sharing_type or p.sharing_type is null)
     and p.effective_from <= p_on
     and (p.effective_to is null or p.effective_to >= p_on)
   order by p.sharing_type nulls last
   limit 1;
$$;

grant execute on function private.head_price(uuid, text, date) to authenticated;

-- Sets a head's price from a date, closing the one in force, like
-- set_fee_structure. SECURITY INVOKER: only owners pass the policies.
create or replace function public.set_fee_head_price(
  p_head_id uuid,
  p_amount integer,
  p_effective_from date,
  -- Null: one price for every sharing type.
  p_sharing_type text default null
)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_hostel uuid;
  later date;
  result uuid;
begin
  select h.hostel_id into v_hostel from public.fee_heads h
   where h.id = p_head_id and h.archived_at is null;
  if not found then
    raise exception 'Charge not found' using errcode = 'P0001', hint = 'fee_head_not_found';
  end if;
  perform pg_advisory_xact_lock(
    hashtextextended('fee_head_prices:' || p_head_id::text || ':' || coalesce(p_sharing_type, 'all'), 0)
  );
  select min(p.effective_from) into later
    from public.fee_head_prices p
   where p.head_id = p_head_id
     and p.sharing_type is not distinct from p_sharing_type
     and p.effective_from > p_effective_from;
  if later is not null then
    raise exception 'A later price starts on %', to_char(later, 'FMDD Mon YYYY')
      using errcode = 'P0001', hint = 'fee_head_price_later_exists';
  end if;
  update public.fee_head_prices p
     set amount = p_amount
   where p.head_id = p_head_id
     and p.sharing_type is not distinct from p_sharing_type
     and p.effective_from = p_effective_from
  returning p.id into result;
  if result is not null then
    return result;
  end if;
  update public.fee_head_prices p
     set effective_to = p_effective_from - 1
   where p.head_id = p_head_id
     and p.sharing_type is not distinct from p_sharing_type
     and p.effective_from < p_effective_from
     and (p.effective_to is null or p.effective_to >= p_effective_from);
  insert into public.fee_head_prices (hostel_id, head_id, sharing_type, amount, effective_from)
  values (v_hostel, p_head_id, p_sharing_type, p_amount, p_effective_from)
  returning id into result;
  return result;
end;
$$;

-- A stay that does not pay a monthly head (e.g. a resident who skips the mess).
create table public.allocation_fee_opt_outs (
  hostel_id uuid not null,
  allocation_id uuid not null,
  head_id uuid not null,
  created_at timestamptz not null default now(),
  primary key (allocation_id, head_id),
  constraint allocation_fee_opt_outs_allocation_fkey foreign key (hostel_id, allocation_id)
    references public.allocations (hostel_id, id) on delete cascade,
  constraint allocation_fee_opt_outs_head_fkey foreign key (hostel_id, head_id)
    references public.fee_heads (hostel_id, id) on delete cascade
);

-- ---------------------------------------------------------------------------
-- Charges: one-time, ad-hoc, admission and electricity
-- ---------------------------------------------------------------------------
create table public.resident_charges (
  id uuid primary key default gen_random_uuid(),
  hostel_id uuid not null,
  resident_id uuid not null,
  head_id uuid,
  category text not null default 'ad_hoc',
  description text not null,
  amount integer not null,
  charge_date date not null,
  -- The invoice that billed it. Null while pending.
  invoice_id uuid,
  details jsonb not null default '{}'::jsonb,
  created_by uuid default auth.uid() references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  voided_at timestamptz,
  void_reason text,
  voided_by uuid references public.profiles (id) on delete set null,
  constraint resident_charges_hostel_id_id_key unique (hostel_id, id),
  constraint resident_charges_resident_fkey foreign key (hostel_id, resident_id)
    references public.residents (hostel_id, id),
  constraint resident_charges_head_fkey foreign key (hostel_id, head_id)
    references public.fee_heads (hostel_id, id),
  constraint resident_charges_invoice_fkey foreign key (hostel_id, invoice_id)
    references public.invoices (hostel_id, id),
  constraint resident_charges_category_valid
    check (category in ('ad_hoc', 'admission', 'electricity', 'cheque_bounce')),
  constraint resident_charges_description_length check (char_length(btrim(description)) between 1 and 200),
  constraint resident_charges_amount_range check (amount between 1 and 100000000),
  constraint resident_charges_void_has_reason check ((voided_at is null) = (void_reason is null)),
  constraint resident_charges_void_reason_length check (char_length(btrim(void_reason)) between 1 and 500),
  constraint resident_charges_void_unbilled check (voided_at is null or invoice_id is null)
);

comment on table public.resident_charges is
  'Charges to a resident besides rent and monthly heads. Pending until an invoice bills them; voided with a reason before that.';

create index resident_charges_pending_idx on public.resident_charges (resident_id)
  where invoice_id is null and voided_at is null;
create index resident_charges_invoice_idx on public.resident_charges (invoice_id);

-- A charge changes once: when an invoice bills it (by function) or when it
-- is voided before that. Nothing else.
create or replace function private.resident_charges_guard_update()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  -- Billing (pending -> on an invoice) and release (a voided invoice frees
  -- it) are done only by the app's own functions, never by a signed-in user.
  if current_user <> 'authenticated'
     and old.voided_at is null and new.voided_at is null and new.void_reason is null
     and row(new.hostel_id, new.resident_id, new.head_id, new.category, new.description,
             new.amount, new.charge_date, new.details)
         is not distinct from
         row(old.hostel_id, old.resident_id, old.head_id, old.category, old.description,
             old.amount, old.charge_date, old.details) then
    return new;
  end if;
  if old.voided_at is not null then
    raise exception 'This charge is already void' using errcode = 'P0001', hint = 'charge_void';
  end if;
  if old.invoice_id is not null then
    raise exception 'This charge is already on an invoice; void the invoice instead'
      using errcode = 'P0001', hint = 'charge_invoiced';
  end if;
  if new.void_reason is not null and new.invoice_id is null then
    new.voided_at := now();
    new.voided_by := (select auth.uid());
    return new;
  end if;
  raise exception 'Charges cannot be edited; void it and add it again'
    using errcode = 'P0001', hint = 'charge_immutable';
end;
$$;

create trigger resident_charges_guard_update
  before update on public.resident_charges
  for each row execute function private.resident_charges_guard_update();

-- New charges only for residents whose record is open (not erased).
create or replace function private.resident_charges_guard_insert()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if exists (select 1 from public.residents r where r.id = new.resident_id and r.erased_at is not null) then
    raise exception 'This resident''s details were erased' using errcode = 'P0001', hint = 'resident_erased';
  end if;
  new.invoice_id := null;
  new.voided_at := null;
  new.void_reason := null;
  new.voided_by := null;
  return new;
end;
$$;

create trigger resident_charges_guard_insert
  before insert on public.resident_charges
  for each row execute function private.resident_charges_guard_insert();

-- Admission and other first-stay heads, charged when a resident is first given a bed.
create or replace function private.allocations_first_stay_charges()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_sharing text;
begin
  if exists (
    select 1 from public.allocations a where a.resident_id = new.resident_id and a.id <> new.id
  ) then
    return null;
  end if;
  select r.sharing_type into v_sharing from public.rooms r where r.id = new.room_id;
  insert into public.resident_charges
    (hostel_id, resident_id, head_id, category, description, amount, charge_date, created_by)
  select new.hostel_id, new.resident_id, h.id, 'admission', h.name,
         private.head_price(h.id, v_sharing, new.start_date), new.start_date, new.created_by
    from public.fee_heads h
   where h.hostel_id = new.hostel_id
     and h.archived_at is null
     and h.on_first_allocation
     and private.head_price(h.id, v_sharing, new.start_date) is not null;
  return null;
end;
$$;

create trigger allocations_first_stay_charges
  after insert on public.allocations
  for each row execute function private.allocations_first_stay_charges();

-- ---------------------------------------------------------------------------
-- Discounts
-- ---------------------------------------------------------------------------
create table public.resident_discounts (
  id uuid primary key default gen_random_uuid(),
  hostel_id uuid not null,
  resident_id uuid not null,
  -- Null: a discount on rent.
  head_id uuid,
  kind text not null,
  -- Percent (1 to 100), or paise for a fixed discount.
  value integer not null,
  from_month date not null,
  -- Null: every month from from_month on.
  to_month date,
  reason text not null,
  created_by uuid default auth.uid() references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  voided_at timestamptz,
  void_reason text,
  constraint resident_discounts_hostel_id_id_key unique (hostel_id, id),
  constraint resident_discounts_resident_fkey foreign key (hostel_id, resident_id)
    references public.residents (hostel_id, id),
  constraint resident_discounts_head_fkey foreign key (hostel_id, head_id)
    references public.fee_heads (hostel_id, id),
  constraint resident_discounts_kind_valid check (kind in ('percent', 'fixed')),
  constraint resident_discounts_value_range check (
    (kind = 'percent' and value between 1 and 100) or (kind = 'fixed' and value between 100 and 100000000)
  ),
  constraint resident_discounts_months check (
    from_month = date_trunc('month', from_month)::date
    and (to_month is null or (to_month = date_trunc('month', to_month)::date and to_month >= from_month))
  ),
  constraint resident_discounts_reason_length check (char_length(btrim(reason)) between 1 and 500),
  constraint resident_discounts_void_has_reason check ((voided_at is null) = (void_reason is null))
);

comment on table public.resident_discounts is
  'A resident''s discount on rent or a fee head, for a range of billing months. Ended by voiding, never edited.';

create index resident_discounts_resident_idx on public.resident_discounts (resident_id) where voided_at is null;

create or replace function private.resident_discounts_guard_update()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if old.voided_at is not null then
    raise exception 'This discount has already ended' using errcode = 'P0001', hint = 'discount_void';
  end if;
  if new.void_reason is null then
    raise exception 'Discounts cannot be edited; end it and add a new one'
      using errcode = 'P0001', hint = 'discount_immutable';
  end if;
  new.voided_at := now();
  return new;
end;
$$;

create trigger resident_discounts_guard_update
  before update on public.resident_discounts
  for each row execute function private.resident_discounts_guard_update();

-- ---------------------------------------------------------------------------
-- Electricity
-- ---------------------------------------------------------------------------
alter table public.hostels
  add column electricity_unit_rate integer,
  add constraint hostels_electricity_unit_rate_range check (electricity_unit_rate between 1 and 10000);

comment on column public.hostels.electricity_unit_rate is
  'Paise per unit (kWh) for room meters. Null: electricity is not billed separately.';

grant update (electricity_unit_rate) on public.hostels to authenticated;

create table public.room_meter_readings (
  id uuid primary key default gen_random_uuid(),
  hostel_id uuid not null,
  room_id uuid not null,
  -- The month the reading closes (taken at its end).
  reading_month date not null,
  reading numeric(12, 1) not null,
  recorded_by uuid not null default auth.uid() references public.profiles (id),
  created_at timestamptz not null default now(),
  constraint room_meter_readings_room_fkey foreign key (hostel_id, room_id)
    references public.rooms (hostel_id, id),
  constraint room_meter_readings_one_per_month unique (room_id, reading_month),
  constraint room_meter_readings_month_start check (reading_month = date_trunc('month', reading_month)::date),
  constraint room_meter_readings_non_negative check (reading >= 0)
);

comment on table public.room_meter_readings is
  'A room meter''s reading at the end of a month. Readings only go up; a billed month''s reading never changes.';

create table public.electricity_bills (
  id uuid primary key default gen_random_uuid(),
  hostel_id uuid not null,
  room_id uuid not null,
  period_month date not null,
  units numeric(12, 1) not null,
  rate integer not null,
  amount integer not null,
  created_by uuid default auth.uid() references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  constraint electricity_bills_room_fkey foreign key (hostel_id, room_id)
    references public.rooms (hostel_id, id),
  constraint electricity_bills_one_per_month unique (room_id, period_month)
);

comment on table public.electricity_bills is
  'A room-month of electricity turned into charges. One per room per month; makes billing idempotent.';

-- A reading must sit between its neighbours, and a reading a bill used is final.
create or replace function private.room_meter_readings_guard()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  before_value numeric;
  after_value numeric;
begin
  if tg_op = 'UPDATE' and (
    exists (select 1 from public.electricity_bills b
             where b.room_id = old.room_id
               and b.period_month in (old.reading_month, (old.reading_month + interval '1 month')::date))
  ) then
    raise exception 'This reading has been billed and cannot change'
      using errcode = 'P0001', hint = 'reading_billed';
  end if;
  if tg_op = 'UPDATE' and (new.room_id <> old.room_id or new.reading_month <> old.reading_month) then
    raise exception 'Only the reading itself can be corrected' using errcode = 'P0001', hint = 'reading_immutable';
  end if;
  select r.reading into before_value from public.room_meter_readings r
   where r.room_id = new.room_id and r.reading_month < new.reading_month and r.id <> new.id
   order by r.reading_month desc limit 1;
  select r.reading into after_value from public.room_meter_readings r
   where r.room_id = new.room_id and r.reading_month > new.reading_month and r.id <> new.id
   order by r.reading_month limit 1;
  if before_value is not null and new.reading < before_value then
    raise exception 'The reading cannot be lower than the previous one (%)', before_value
      using errcode = 'P0001', hint = 'reading_lower';
  end if;
  if after_value is not null and new.reading > after_value then
    raise exception 'The reading cannot be higher than the next one (%)', after_value
      using errcode = 'P0001', hint = 'reading_higher';
  end if;
  return new;
end;
$$;

create trigger room_meter_readings_guard
  before insert or update on public.room_meter_readings
  for each row execute function private.room_meter_readings_guard();

-- Turns a month's readings into charges. Owner only; idempotent per room.
-- Units are this month's reading less the latest earlier one. A room's
-- first ever reading is a starting point and bills nothing.
create or replace function private.bill_electricity(p_hostel_id uuid, p_period_month date)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  month_start date := date_trunc('month', p_period_month)::date;
  month_end date := (date_trunc('month', p_period_month) + interval '1 month - 1 day')::date;
  v_rate integer;
  room record;
  v_prev numeric;
  v_cur numeric;
  v_units numeric;
  v_amount integer;
  v_nights integer;
  v_left integer;
  stay record;
  v_share integer;
  billed integer := 0;
  charges integer := 0;
  total bigint := 0;
  missing jsonb := '[]'::jsonb;
  first_readings jsonb := '[]'::jsonb;
  already integer := 0;
begin
  if p_hostel_id is null or p_hostel_id not in (select private.user_owned_hostel_ids()) then
    raise exception 'Only the hostel owner can bill electricity' using errcode = '42501', hint = 'not_owner';
  end if;
  if p_period_month is null or month_start > date_trunc('month', private.today_ist())::date then
    raise exception 'Choose this month or an earlier one' using errcode = 'P0001', hint = 'billing_month_future';
  end if;
  select h.electricity_unit_rate into v_rate from public.hostels h where h.id = p_hostel_id;
  if v_rate is null then
    raise exception 'Set the price per unit first' using errcode = 'P0001', hint = 'electricity_off';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('electricity:' || p_hostel_id::text, 0));

  for room in
    select r.id, r.room_number,
           exists (select 1 from public.allocations a
                    where a.room_id = r.id and a.start_date <= month_end
                      and (a.end_date is null or a.end_date >= month_start)) as occupied
      from public.rooms r
     where r.hostel_id = p_hostel_id and r.status = 'active'
     order by lpad(r.room_number, 20, '0')
  loop
    if exists (select 1 from public.electricity_bills b where b.room_id = room.id and b.period_month = month_start) then
      already := already + 1;
      continue;
    end if;
    select m.reading into v_cur from public.room_meter_readings m
     where m.room_id = room.id and m.reading_month = month_start;
    if v_cur is null then
      if room.occupied then
        missing := missing || jsonb_build_object('room_id', room.id, 'room_number', room.room_number);
      end if;
      continue;
    end if;
    select m.reading into v_prev from public.room_meter_readings m
     where m.room_id = room.id and m.reading_month < month_start
     order by m.reading_month desc limit 1;
    if v_prev is null then
      first_readings := first_readings || jsonb_build_object('room_id', room.id, 'room_number', room.room_number);
      continue;
    end if;
    v_units := v_cur - v_prev;
    v_amount := round(v_units * v_rate)::integer;
    insert into public.electricity_bills (hostel_id, room_id, period_month, units, rate, amount)
    values (p_hostel_id, room.id, month_start, v_units, v_rate, v_amount);
    billed := billed + 1;

    select coalesce(sum(least(coalesce(a.end_date, month_end), month_end) - greatest(a.start_date, month_start) + 1), 0)
      into v_nights
      from public.allocations a
      join public.residents re on re.id = a.resident_id and re.erased_at is null
     where a.room_id = room.id and a.start_date <= month_end
       and (a.end_date is null or a.end_date >= month_start);
    if v_amount = 0 or v_nights = 0 then
      continue;
    end if;
    v_left := v_amount;
    -- Shares by nights held; the last share takes the rounding remainder.
    for stay in
      select a.resident_id,
             sum(least(coalesce(a.end_date, month_end), month_end) - greatest(a.start_date, month_start) + 1)::integer as nights,
             row_number() over (order by min(a.start_date), a.resident_id) as n,
             count(*) over () as stays
        from public.allocations a
        join public.residents re on re.id = a.resident_id and re.erased_at is null
       where a.room_id = room.id and a.start_date <= month_end
         and (a.end_date is null or a.end_date >= month_start)
       group by a.resident_id
       order by min(a.start_date), a.resident_id
    loop
      v_share := case when stay.n = stay.stays then v_left
                      else (v_amount::bigint * stay.nights / v_nights)::integer end;
      v_left := v_left - v_share;
      if v_share > 0 then
        insert into public.resident_charges
          (hostel_id, resident_id, category, description, amount, charge_date, details)
        values (
          p_hostel_id, stay.resident_id, 'electricity',
          'Electricity, room ' || room.room_number || ', ' || to_char(month_start, 'FMMonth YYYY'),
          v_share, month_end,
          jsonb_build_object('room_id', room.id, 'units', v_units, 'rate', v_rate,
                             'room_amount', v_amount, 'nights', stay.nights, 'room_nights', v_nights)
        );
        charges := charges + 1;
        total := total + v_share;
      end if;
    end loop;
  end loop;

  return jsonb_build_object(
    'period_month', month_start,
    'rooms_billed', billed,
    'charges', charges,
    'total_amount', total,
    'already_billed', already,
    'missing_readings', missing,
    'first_readings', first_readings
  );
end;
$$;

create or replace function public.bill_electricity(p_hostel_id uuid, p_period_month date)
returns jsonb
language sql
volatile
security invoker
set search_path = ''
as $$ select private.bill_electricity(p_hostel_id, p_period_month); $$;

-- ---------------------------------------------------------------------------
-- Invoice lines
-- ---------------------------------------------------------------------------
alter table public.invoices drop constraint invoices_kind_valid;
alter table public.invoices
  add constraint invoices_kind_valid check (kind in ('rent', 'late_fee', 'charges'));

comment on column public.invoices.kind is
  'rent (monthly), late_fee, or charges (pending charges billed on their own).';

create table public.invoice_lines (
  id uuid primary key default gen_random_uuid(),
  hostel_id uuid not null,
  invoice_id uuid not null,
  position integer not null,
  kind text not null,
  description text not null,
  -- Negative only for a discount.
  amount integer not null,
  head_id uuid,
  charge_id uuid,
  discount_id uuid,
  details jsonb not null default '{}'::jsonb,
  -- Invoices are never deleted by users; lines go with one if the service
  -- role ever removes it (fixtures, a closed account).
  constraint invoice_lines_invoice_fkey foreign key (hostel_id, invoice_id)
    references public.invoices (hostel_id, id) on delete cascade,
  constraint invoice_lines_charge_fkey foreign key (hostel_id, charge_id)
    references public.resident_charges (hostel_id, id),
  constraint invoice_lines_discount_fkey foreign key (hostel_id, discount_id)
    references public.resident_discounts (hostel_id, id),
  constraint invoice_lines_kind_valid check (kind in ('rent', 'fee_head', 'discount', 'charge')),
  constraint invoice_lines_sign check ((kind = 'discount') = (amount < 0) and amount <> 0),
  constraint invoice_lines_position_unique unique (invoice_id, position)
);

comment on table public.invoice_lines is
  'What an invoice is made of. Written with the invoice, never changed; they add up to its amount.';

create index invoice_lines_invoice_idx on public.invoice_lines (invoice_id);

-- Checked at commit, once every line of the invoice is in.
create or replace function private.invoice_lines_add_up()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_amount integer;
  v_sum bigint;
begin
  select i.amount into v_amount from public.invoices i where i.id = new.invoice_id;
  select sum(l.amount) into v_sum from public.invoice_lines l where l.invoice_id = new.invoice_id;
  if v_sum is distinct from v_amount then
    raise exception 'Invoice lines add up to %, not the invoice amount %', v_sum, v_amount
      using errcode = 'P0001', hint = 'invoice_lines_total';
  end if;
  return null;
end;
$$;

create constraint trigger invoice_lines_add_up
  after insert on public.invoice_lines
  deferrable initially deferred
  for each row execute function private.invoice_lines_add_up();

create or replace function private.invoice_lines_immutable()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  -- Signed-in users have no update or delete rights here at all; this also
  -- stops the app's own functions. The service role may remove lines.
  if current_user = 'authenticated' or tg_op = 'UPDATE' then
    raise exception 'Invoice lines cannot be changed; void the invoice instead'
      using errcode = 'P0001', hint = 'invoice_immutable';
  end if;
  return old;
end;
$$;

create trigger invoice_lines_immutable
  before update or delete on public.invoice_lines
  for each row execute function private.invoice_lines_immutable();

-- Voiding an invoice frees its charges, so they are billed again next time.
create or replace function private.invoices_release_charges()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.status = 'void' and old.status = 'issued' then
    update public.resident_charges set invoice_id = null where invoice_id = new.id;
  end if;
  return null;
end;
$$;

create trigger invoices_release_charges
  after update of status on public.invoices
  for each row execute function private.invoices_release_charges();

-- ---------------------------------------------------------------------------
-- Itemised monthly invoices
-- ---------------------------------------------------------------------------
-- The lines one resident's month would have, before anything is written:
-- rent, monthly heads (prorated like rent), discounts and pending charges.
-- Used by generate_invoices; also callable for a preview.
create or replace function private.month_lines(
  p_hostel_id uuid,
  p_resident_id uuid,
  p_month_start date,
  p_rent integer,
  p_rent_details jsonb
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  month_end date := (p_month_start + interval '1 month - 1 day')::date;
  days integer := month_end - p_month_start + 1;
  lines jsonb := '[]'::jsonb;
  head record;
  disc record;
  charge record;
  base integer;
  taken jsonb := '{}'::jsonb;
  v_off integer;
  v_key text;
begin
  lines := lines || jsonb_build_array(jsonb_build_object(
    'kind', 'rent', 'description', 'Rent for ' || to_char(p_month_start, 'FMMonth YYYY'),
    'amount', p_rent, 'details', jsonb_build_object('stays', p_rent_details)));

  -- Monthly heads, per stay in the month, unless the stay opted out.
  for head in
    with stays as (
      select a.id, rm.sharing_type,
             greatest(a.start_date, p_month_start) as billed_from,
             least(coalesce(a.end_date, month_end), month_end) as billed_to
        from public.allocations a
        join public.rooms rm on rm.id = a.room_id
       where a.resident_id = p_resident_id
         and a.start_date <= month_end
         and (a.end_date is null or a.end_date >= p_month_start)
    )
    select h.id, h.name,
           case
             when bool_and(s.billed_from = p_month_start and s.billed_to = month_end)
               then sum(private.head_price(h.id, s.sharing_type, p_month_start))::integer
             else (round(sum(private.head_price(h.id, s.sharing_type, p_month_start)::numeric
                             * (s.billed_to - s.billed_from + 1)) / days / 100) * 100)::integer
           end as amount
      from public.fee_heads h
      cross join stays s
     where h.hostel_id = p_hostel_id
       and h.kind = 'monthly'
       and h.archived_at is null
       and private.head_price(h.id, s.sharing_type, p_month_start) is not null
       and not exists (select 1 from public.allocation_fee_opt_outs o
                        where o.allocation_id = s.id and o.head_id = h.id)
     group by h.id, h.name, h.created_at
     order by h.created_at
  loop
    if head.amount > 0 then
      lines := lines || jsonb_build_array(jsonb_build_object(
        'kind', 'fee_head', 'description', head.name, 'amount', head.amount, 'head_id', head.id));
    end if;
  end loop;

  -- Discounts in force this month, oldest first, never below zero per line.
  for disc in
    select d.id, d.head_id, d.kind, d.value, d.reason
      from public.resident_discounts d
     where d.resident_id = p_resident_id
       and d.voided_at is null
       and d.from_month <= p_month_start
       and (d.to_month is null or d.to_month >= p_month_start)
     order by d.created_at, d.id
  loop
    v_key := coalesce(disc.head_id::text, 'rent');
    select coalesce(sum((l ->> 'amount')::integer), 0) into base
      from jsonb_array_elements(lines) l
     where (disc.head_id is null and l ->> 'kind' = 'rent')
        or (disc.head_id is not null and l ->> 'head_id' = disc.head_id::text);
    base := base - coalesce((taken ->> v_key)::integer, 0);
    if base <= 0 then
      continue;
    end if;
    v_off := case when disc.kind = 'percent'
                  then (round(base::numeric * disc.value / 100 / 100) * 100)::integer
                  else least(disc.value, base) end;
    v_off := least(v_off, base);
    if v_off > 0 then
      taken := taken || jsonb_build_object(v_key, coalesce((taken ->> v_key)::integer, 0) + v_off);
      lines := lines || jsonb_build_array(jsonb_build_object(
        'kind', 'discount',
        'description', 'Discount: ' || disc.reason,
        'amount', -v_off,
        'head_id', disc.head_id,
        'discount_id', disc.id,
        'details', jsonb_build_object('kind', disc.kind, 'value', disc.value)));
    end if;
  end loop;

  -- Pending charges dated in or before the month.
  for charge in
    select c.id, c.description, c.amount, c.head_id, c.category, c.details
      from public.resident_charges c
     where c.resident_id = p_resident_id
       and c.invoice_id is null
       and c.voided_at is null
       and c.charge_date <= month_end
     order by c.charge_date, c.created_at, c.id
  loop
    lines := lines || jsonb_build_array(jsonb_build_object(
      'kind', 'charge', 'description', charge.description, 'amount', charge.amount,
      'head_id', charge.head_id, 'charge_id', charge.id,
      'details', charge.details || jsonb_build_object('category', charge.category)));
  end loop;

  return lines;
end;
$$;

revoke all on function private.month_lines(uuid, uuid, date, integer, jsonb) from public, anon, authenticated;

-- Writes an invoice's lines and marks its charges billed.
create or replace function private.write_invoice_lines(p_hostel_id uuid, p_invoice_id uuid, p_lines jsonb)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
  insert into public.invoice_lines
    (hostel_id, invoice_id, position, kind, description, amount, head_id, charge_id, discount_id, details)
  select p_hostel_id, p_invoice_id, l.ordinality::integer, l.value ->> 'kind', l.value ->> 'description',
         (l.value ->> 'amount')::integer, (l.value ->> 'head_id')::uuid, (l.value ->> 'charge_id')::uuid,
         (l.value ->> 'discount_id')::uuid, coalesce(l.value -> 'details', '{}'::jsonb)
    from jsonb_array_elements(p_lines) with ordinality l;
  update public.resident_charges c
     set invoice_id = p_invoice_id
   where c.id in (select (l ->> 'charge_id')::uuid from jsonb_array_elements(p_lines) l
                   where l ->> 'charge_id' is not null);
end;
$$;

revoke all on function private.write_invoice_lines(uuid, uuid, jsonb) from public, anon, authenticated;

-- Monthly invoices, now itemised. The rent amount and proration are
-- exactly as before (20261019090000); monthly heads, discounts and pending
-- charges are added as lines. Same summary, plus the lines' totals.
-- SECURITY DEFINER for the lines and charges; the owner check comes first.
drop function public.generate_invoices(uuid, date, integer);

create or replace function private.generate_invoices(
  p_hostel_id uuid,
  p_period_month date,
  p_due_day integer
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  month_start date := date_trunc('month', p_period_month)::date;
  month_end date := (date_trunc('month', p_period_month) + interval '1 month - 1 day')::date;
  days integer;
  cand record;
  v_lines jsonb;
  v_total integer;
  v_id uuid;
  created integer := 0;
  total bigint := 0;
  already integer := 0;
  extras bigint := 0;
  unpriced jsonb := '[]'::jsonb;
begin
  if p_hostel_id is null or p_hostel_id not in (select private.user_owned_hostel_ids()) then
    -- Staff of the hostel are refused like any write they may not make;
    -- anyone else learns nothing about it.
    if p_hostel_id in (select private.user_hostel_ids()) then
      raise exception 'Only the hostel owner can generate invoices'
        using errcode = '42501', hint = 'not_owner';
    end if;
    raise exception 'Hostel not found' using errcode = 'P0001', hint = 'hostel_not_found';
  end if;
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
  days := month_end - month_start + 1;

  for cand in
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
      join public.residents re on re.id = a.resident_id and re.erased_at is null
      where a.hostel_id = p_hostel_id
        and a.start_date <= month_end
        and (a.end_date is null or a.end_date >= month_start)
    )
    select
      s.resident_id,
      (select r.full_name from public.residents r where r.id = s.resident_id) as full_name,
      bool_and(s.rate is not null) as priced,
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
      ) as breakdown
    from stays s
    group by s.resident_id
    order by 2
  loop
    if exists (
      select 1 from public.invoices i
       where i.resident_id = cand.resident_id and i.period_month = month_start
         and i.status = 'issued' and i.kind = 'rent'
    ) then
      already := already + 1;
      continue;
    end if;
    if not cand.priced then
      unpriced := unpriced || jsonb_build_object('resident_id', cand.resident_id, 'full_name', cand.full_name);
      continue;
    end if;
    if cand.amount <= 0 then
      continue;
    end if;
    -- One resident's charges are billed by one run at a time.
    perform pg_advisory_xact_lock(hashtextextended('charges:' || cand.resident_id::text, 0));
    v_lines := private.month_lines(p_hostel_id, cand.resident_id, month_start, cand.amount, cand.breakdown);
    select sum((l ->> 'amount')::integer) into v_total from jsonb_array_elements(v_lines) l;
    if v_total <= 0 then
      continue;
    end if;
    insert into public.invoices
      (hostel_id, resident_id, allocation_id, period_month, amount, due_date, breakdown)
    values (p_hostel_id, cand.resident_id, cand.allocation_id, month_start, v_total,
            month_start + (p_due_day - 1), cand.breakdown)
    on conflict (resident_id, period_month) where status = 'issued' and kind = 'rent' do nothing
    returning id into v_id;
    if v_id is null then
      already := already + 1;
      continue;
    end if;
    perform private.write_invoice_lines(p_hostel_id, v_id, v_lines);
    created := created + 1;
    total := total + v_total;
    extras := extras + v_total - cand.amount;
  end loop;

  return jsonb_build_object(
    'period_month', month_start,
    'created', created,
    'total_amount', total,
    'extras_amount', extras,
    'already_invoiced', already,
    'unpriced', unpriced
  );
end;
$$;

create or replace function public.generate_invoices(
  p_hostel_id uuid,
  p_period_month date,
  p_due_day integer default 5
)
returns jsonb
language sql
volatile
security invoker
set search_path = ''
as $$ select private.generate_invoices(p_hostel_id, p_period_month, p_due_day); $$;

-- Bills a resident's pending charges now, on an invoice of their own, due
-- today. Owner only.
create or replace function private.bill_charges_now(p_resident_id uuid)
returns uuid
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_hostel uuid;
  v_lines jsonb;
  v_total integer;
  v_id uuid;
  v_allocation uuid;
  today date := private.today_ist();
begin
  select r.hostel_id into v_hostel from public.residents r where r.id = p_resident_id;
  if v_hostel is null or v_hostel not in (select private.user_owned_hostel_ids()) then
    raise exception 'Only the hostel owner can bill charges' using errcode = '42501', hint = 'not_owner';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('charges:' || p_resident_id::text, 0));
  select coalesce(jsonb_agg(jsonb_build_object(
           'kind', 'charge', 'description', c.description, 'amount', c.amount,
           'head_id', c.head_id, 'charge_id', c.id,
           'details', c.details || jsonb_build_object('category', c.category))
           order by c.charge_date, c.created_at, c.id), '[]'::jsonb),
         coalesce(sum(c.amount), 0)
    into v_lines, v_total
    from public.resident_charges c
   where c.resident_id = p_resident_id and c.invoice_id is null and c.voided_at is null;
  if v_total = 0 then
    raise exception 'There are no pending charges' using errcode = 'P0001', hint = 'no_pending_charges';
  end if;
  select a.id into v_allocation from public.allocations a
   where a.resident_id = p_resident_id order by a.start_date desc limit 1;
  insert into public.invoices
    (hostel_id, resident_id, allocation_id, period_month, amount, due_date, kind)
  values (v_hostel, p_resident_id, v_allocation, date_trunc('month', today)::date, v_total, today, 'charges')
  returning id into v_id;
  perform private.write_invoice_lines(v_hostel, v_id, v_lines);
  return v_id;
end;
$$;

create or replace function public.bill_charges_now(p_resident_id uuid)
returns uuid
language sql
volatile
security invoker
set search_path = ''
as $$ select private.bill_charges_now(p_resident_id); $$;

-- ---------------------------------------------------------------------------
-- Privileges and row-level security
-- ---------------------------------------------------------------------------
-- Owners set heads, prices, opt-outs, discounts and the electricity rate.
-- Every member reads them, adds charges and records meter readings (staff
-- take the readings and collect the money). Only owners void charges.
alter table public.fee_heads enable row level security;
alter table public.fee_head_prices enable row level security;
alter table public.allocation_fee_opt_outs enable row level security;
alter table public.resident_charges enable row level security;
alter table public.resident_discounts enable row level security;
alter table public.room_meter_readings enable row level security;
alter table public.electricity_bills enable row level security;
alter table public.invoice_lines enable row level security;

revoke all on public.fee_heads, public.fee_head_prices, public.allocation_fee_opt_outs,
  public.resident_charges, public.resident_discounts, public.room_meter_readings,
  public.electricity_bills, public.invoice_lines from authenticated, anon;

grant select on public.fee_heads, public.fee_head_prices, public.allocation_fee_opt_outs,
  public.resident_charges, public.resident_discounts, public.room_meter_readings,
  public.electricity_bills, public.invoice_lines to authenticated;
grant insert (hostel_id, name, kind, on_first_allocation) on public.fee_heads to authenticated;
grant update (archived_at) on public.fee_heads to authenticated;
grant insert (hostel_id, allocation_id, head_id) on public.allocation_fee_opt_outs to authenticated;
grant delete on public.allocation_fee_opt_outs to authenticated;
grant insert (hostel_id, resident_id, head_id, description, amount, charge_date)
  on public.resident_charges to authenticated;
grant update (void_reason) on public.resident_charges to authenticated;
grant insert (hostel_id, resident_id, head_id, kind, value, from_month, to_month, reason)
  on public.resident_discounts to authenticated;
grant update (void_reason) on public.resident_discounts to authenticated;
grant insert (hostel_id, room_id, reading_month, reading) on public.room_meter_readings to authenticated;
grant update (reading) on public.room_meter_readings to authenticated;

create policy "fee heads: members read" on public.fee_heads for select to authenticated
  using (hostel_id in (select private.user_hostel_ids()));
create policy "fee heads: owners add" on public.fee_heads for insert to authenticated
  with check (hostel_id in (select private.user_owned_hostel_ids()));
create policy "fee heads: owners archive" on public.fee_heads for update to authenticated
  using (hostel_id in (select private.user_owned_hostel_ids()))
  with check (hostel_id in (select private.user_owned_hostel_ids()));

create policy "fee head prices: members read" on public.fee_head_prices for select to authenticated
  using (hostel_id in (select private.user_hostel_ids()));
-- Written only through set_fee_head_price, which runs as the caller.
grant insert (hostel_id, head_id, sharing_type, amount, effective_from) on public.fee_head_prices to authenticated;
grant update (amount, effective_to) on public.fee_head_prices to authenticated;
create policy "fee head prices: owners set" on public.fee_head_prices for insert to authenticated
  with check (hostel_id in (select private.user_owned_hostel_ids()));
create policy "fee head prices: owners change" on public.fee_head_prices for update to authenticated
  using (hostel_id in (select private.user_owned_hostel_ids()))
  with check (hostel_id in (select private.user_owned_hostel_ids()));

create policy "fee opt-outs: members read" on public.allocation_fee_opt_outs for select to authenticated
  using (hostel_id in (select private.user_hostel_ids()));
create policy "fee opt-outs: owners add" on public.allocation_fee_opt_outs for insert to authenticated
  with check (hostel_id in (select private.user_owned_hostel_ids()));
create policy "fee opt-outs: owners remove" on public.allocation_fee_opt_outs for delete to authenticated
  using (hostel_id in (select private.user_owned_hostel_ids()));

create policy "charges: members read" on public.resident_charges for select to authenticated
  using (hostel_id in (select private.user_hostel_ids()));
create policy "charges: members add" on public.resident_charges for insert to authenticated
  with check (hostel_id in (select private.user_hostel_ids()));
create policy "charges: owners void" on public.resident_charges for update to authenticated
  using (hostel_id in (select private.user_owned_hostel_ids()))
  with check (hostel_id in (select private.user_owned_hostel_ids()));

create policy "discounts: members read" on public.resident_discounts for select to authenticated
  using (hostel_id in (select private.user_hostel_ids()));
create policy "discounts: owners add" on public.resident_discounts for insert to authenticated
  with check (hostel_id in (select private.user_owned_hostel_ids()));
create policy "discounts: owners end" on public.resident_discounts for update to authenticated
  using (hostel_id in (select private.user_owned_hostel_ids()))
  with check (hostel_id in (select private.user_owned_hostel_ids()));

create policy "meter readings: members read" on public.room_meter_readings for select to authenticated
  using (hostel_id in (select private.user_hostel_ids()));
create policy "meter readings: members record" on public.room_meter_readings for insert to authenticated
  with check (hostel_id in (select private.user_hostel_ids()) and recorded_by = (select auth.uid()));
create policy "meter readings: members correct" on public.room_meter_readings for update to authenticated
  using (hostel_id in (select private.user_hostel_ids()))
  with check (hostel_id in (select private.user_hostel_ids()));

create policy "electricity bills: members read" on public.electricity_bills for select to authenticated
  using (hostel_id in (select private.user_hostel_ids()));

create policy "invoice lines: members read" on public.invoice_lines for select to authenticated
  using (hostel_id in (select private.user_hostel_ids()));

do $$
declare
  fn text;
begin
  foreach fn in array array[
    'private.generate_invoices(uuid, date, integer)',
    'public.generate_invoices(uuid, date, integer)',
    'public.set_fee_head_price(uuid, integer, date, text)',
    'private.bill_electricity(uuid, date)',
    'public.bill_electricity(uuid, date)',
    'private.bill_charges_now(uuid)',
    'public.bill_charges_now(uuid)'
  ] loop
    execute format('revoke all on function %s from public, anon', fn);
    execute format('grant execute on function %s to authenticated', fn);
  end loop;
end;
$$;

-- ---------------------------------------------------------------------------
-- Erasing a resident with charges not yet billed
-- ---------------------------------------------------------------------------
-- erase_resident refuses while the resident owes anything; a pending charge
-- is owed too, just not yet invoiced. Bill or void it first.
create or replace function private.residents_guard_pending_charges()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if new.erased_at is not null and old.erased_at is null and exists (
    select 1 from public.resident_charges c
     where c.resident_id = new.id and c.invoice_id is null and c.voided_at is null
  ) then
    raise exception 'This resident has charges not yet billed'
      using errcode = 'P0001', hint = 'erase_pending_charges';
  end if;
  return new;
end;
$$;

create trigger residents_guard_pending_charges
  before update of erased_at on public.residents
  for each row execute function private.residents_guard_pending_charges();

-- ---------------------------------------------------------------------------
-- Occupancy trend: read beds and stays once
-- ---------------------------------------------------------------------------
-- Unchanged from 20261011120000 except that the beds and stays are
-- materialised: the per-day counts no longer re-read the allocations (and
-- re-check row-level security) once per day, whatever plan the statistics
-- of the moment suggest.
create or replace function public.occupancy_trend(
  p_hostel_id uuid,
  p_from date,
  p_to date,
  p_granularity text default 'day'
)
returns table (
  bucket date,
  days integer,
  total_beds numeric,
  occupied_beds numeric,
  occupancy_percent numeric
)
language plpgsql
stable
security invoker
set search_path = ''
as $$
declare
  v_to date := least(p_to, private.today_ist());
begin
  if p_from is null or p_to is null or p_from > p_to then
    raise exception 'The start date must be on or before the end date'
      using errcode = 'P0001', hint = 'range_reversed';
  end if;
  if p_granularity not in ('day', 'month') then
    raise exception 'Granularity must be day or month'
      using errcode = 'P0001', hint = 'granularity';
  end if;
  if p_to - p_from > 731 then
    raise exception 'Choose a range of at most two years'
      using errcode = 'P0001', hint = 'range_too_long';
  end if;

  return query
  with days as (
    select d::date as day
      from generate_series(p_from, v_to, interval '1 day') d
  ),
  bed_life as materialized (
    select
      least(
        (b.archived_at at time zone 'Asia/Kolkata')::date - 1,
        case when rm.status = 'archived'
          then (rm.updated_at at time zone 'Asia/Kolkata')::date - 1 end
      ) as last_day
    from public.beds b
    join public.rooms rm on rm.id = b.room_id
    where b.hostel_id = p_hostel_id
  ),
  stays as materialized (
    select a.start_date, a.end_date
      from public.allocations a
     where a.hostel_id = p_hostel_id
       and a.start_date <= v_to
       and (a.end_date is null or a.end_date >= p_from)
  ),
  daily as (
    select
      d.day,
      (select count(*) from bed_life l
        where l.last_day is null or l.last_day >= d.day) as beds,
      (select count(*) from stays s
        where s.start_date <= d.day and (s.end_date is null or s.end_date >= d.day)) as occupied
    from days d
  ),
  grouped as (
    select
      case when p_granularity = 'month' then date_trunc('month', dl.day)::date else dl.day end
        as bucket,
      count(*)::integer as days,
      avg(dl.beds) as total_beds,
      avg(dl.occupied) as occupied_beds,
      -- Occupied bed-nights over available bed-nights.
      case when sum(dl.beds) = 0 then 0
           else round(100.0 * sum(dl.occupied) / sum(dl.beds), 1) end as occupancy_percent
    from daily dl
    group by 1
  )
  select g.bucket, g.days, round(g.total_beds, 1), round(g.occupied_beds, 1), g.occupancy_percent
    from grouped g
   order by g.bucket;
end;
$$;
