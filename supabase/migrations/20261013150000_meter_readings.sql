-- Metered electricity per room (E13-T3).
--
-- A hostel that bills electricity sets a rate per unit. Each month, a room's
-- sub-meter reading (opening and closing units) is recorded. The units times
-- the rate is split among everyone who held a bed in the room that month, by
-- the nights they held it, and each share becomes a pending charge (E13-T2)
-- on the resident's next invoice. The charge's description carries the
-- units, rate and share, so the invoice line explains itself.
--
-- Readings never go backwards: a month's opening may not be below the
-- previous month's closing, nor its closing above the next month's opening.
-- A mistaken reading is voided with a reason, which voids its charges, as
-- long as none has been billed yet.
--
-- Rooms that had occupants but no reading for the month are listed by
-- missing_meter_readings, so invoices are not generated with electricity
-- silently left out.

-- ---------------------------------------------------------------------------
-- The rate
-- ---------------------------------------------------------------------------
create table public.electricity_rates (
  hostel_id uuid primary key references public.hostels (id) on delete cascade,
  -- Paise per unit (kWh).
  unit_rate integer not null,
  updated_at timestamptz not null default now(),
  constraint electricity_rates_unit_rate_range check (unit_rate between 1 and 100000)
);

comment on table public.electricity_rates is
  'A hostel bills metered electricity when it has a row here: the rate per unit, in paise.';

create trigger electricity_rates_set_updated_at
  before update on public.electricity_rates
  for each row execute function private.set_updated_at();

-- ---------------------------------------------------------------------------
-- Readings
-- ---------------------------------------------------------------------------
create table public.meter_readings (
  id uuid primary key default gen_random_uuid(),
  hostel_id uuid not null references public.hostels (id) on delete cascade,
  room_id uuid not null,
  -- The month the units were used in.
  period_month date not null,
  opening numeric(10, 1) not null,
  closing numeric(10, 1) not null,
  -- The rate when it was recorded, and what the room's units came to.
  unit_rate integer not null,
  amount integer not null,
  recorded_by uuid default auth.uid() references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  voided_at timestamptz,
  void_reason text,
  voided_by uuid references public.profiles (id) on delete set null,

  constraint meter_readings_hostel_id_id_key unique (hostel_id, id),
  constraint meter_readings_room_fkey foreign key (hostel_id, room_id)
    references public.rooms (hostel_id, id) on delete cascade,
  constraint meter_readings_month_start check (period_month = date_trunc('month', period_month)::date),
  constraint meter_readings_opening_positive check (opening >= 0),
  constraint meter_readings_closing_after_opening check (closing >= opening),
  constraint meter_readings_amount_positive check (amount >= 0),
  constraint meter_readings_void_has_reason check ((voided_at is null) = (void_reason is null)),
  constraint meter_readings_void_reason_length check (char_length(btrim(void_reason)) between 1 and 500)
);

comment on table public.meter_readings is
  'A room''s sub-meter for a month. Split into charges by occupant nights. Voided, never edited.';

create unique index meter_readings_one_per_room_month
  on public.meter_readings (room_id, period_month) where voided_at is null;
create index meter_readings_hostel_month_idx on public.meter_readings (hostel_id, period_month);

-- Each share links back to the reading it came from.
alter table public.resident_charges add column meter_reading_id uuid;
alter table public.resident_charges add constraint resident_charges_meter_reading_fkey
  foreign key (hostel_id, meter_reading_id) references public.meter_readings (hostel_id, id);
create index resident_charges_meter_reading_idx
  on public.resident_charges (meter_reading_id) where meter_reading_id is not null;

-- Who held a bed in a room during a month, and for how many nights. Counted
-- the way rent is (resident_month_stays): the first and last nights both count.
create or replace function private.room_month_nights(p_room_id uuid, p_month_start date)
returns table (resident_id uuid, nights integer)
language sql
stable
security definer
set search_path = ''
as $$
  with bounds as (
    select p_month_start as month_start,
           (p_month_start + interval '1 month - 1 day')::date as month_end
  )
  select a.resident_id,
         sum(least(coalesce(a.end_date, b.month_end), b.month_end)
             - greatest(a.start_date, b.month_start) + 1)::integer
    from public.allocations a
    cross join bounds b
   where a.room_id = p_room_id
     and a.start_date <= b.month_end
     and (a.end_date is null or a.end_date >= b.month_start)
   group by a.resident_id;
$$;

-- Records a reading and adds each occupant's share as a charge. Owners and
-- staff. SECURITY INVOKER: it checks the caller works in the room's hostel,
-- then hands over to the private worker, which writes the charges.
create or replace function public.record_meter_reading(
  p_room_id uuid,
  p_period_month date,
  p_opening numeric,
  p_closing numeric
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  hostel uuid;
begin
  select r.hostel_id into hostel from public.rooms r where r.id = p_room_id;
  if hostel is null or hostel not in (select private.user_hostel_ids()) then
    raise exception 'Room not found' using errcode = 'P0001', hint = 'room_not_found';
  end if;
  return private.record_meter_reading(hostel, p_room_id, p_period_month, p_opening, p_closing);
end;
$$;

create or replace function private.record_meter_reading(
  p_hostel_id uuid,
  p_room_id uuid,
  p_period_month date,
  p_opening numeric,
  p_closing numeric
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  month_start date := date_trunc('month', p_period_month)::date;
  month_end date := (date_trunc('month', p_period_month) + interval '1 month - 1 day')::date;
  rate integer;
  room_number text;
  units numeric;
  total integer;
  total_nights integer;
  reading uuid;
  shares jsonb := '[]'::jsonb;
  s record;
  given integer := 0;
  share integer;
  remaining_nights integer;
begin
  if p_period_month is null or month_start > date_trunc('month', private.today_ist())::date then
    raise exception 'Choose this month or an earlier one'
      using errcode = 'P0001', hint = 'meter_month';
  end if;
  if p_opening is null or p_closing is null or p_opening < 0 then
    raise exception 'Enter the opening and closing units'
      using errcode = 'P0001', hint = 'meter_units';
  end if;
  if p_closing < p_opening then
    raise exception 'The closing reading cannot be below the opening reading'
      using errcode = 'P0001', hint = 'meter_reading_lower';
  end if;

  select e.unit_rate into rate from public.electricity_rates e where e.hostel_id = p_hostel_id;
  if rate is null then
    raise exception 'Set the electricity rate first'
      using errcode = 'P0001', hint = 'electricity_rate_missing';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('meter:' || p_room_id::text, 0));

  if exists (
    select 1 from public.meter_readings m
     where m.room_id = p_room_id and m.period_month = month_start and m.voided_at is null
  ) then
    raise exception 'This room already has a reading for that month'
      using errcode = 'P0001', hint = 'meter_reading_exists';
  end if;
  if p_opening < coalesce((
    select m.closing from public.meter_readings m
     where m.room_id = p_room_id and m.period_month < month_start and m.voided_at is null
     order by m.period_month desc limit 1
  ), 0) then
    raise exception 'The opening reading cannot be below the previous month''s closing reading'
      using errcode = 'P0001', hint = 'meter_reading_lower';
  end if;
  if p_closing > coalesce((
    select m.opening from public.meter_readings m
     where m.room_id = p_room_id and m.period_month > month_start and m.voided_at is null
     order by m.period_month limit 1
  ), p_closing) then
    raise exception 'The closing reading cannot be above the next month''s opening reading'
      using errcode = 'P0001', hint = 'meter_reading_higher';
  end if;

  units := p_closing - p_opening;
  total := round(units * rate)::integer;
  select r.room_number into room_number from public.rooms r where r.id = p_room_id;

  insert into public.meter_readings
    (hostel_id, room_id, period_month, opening, closing, unit_rate, amount, recorded_by)
  values
    (p_hostel_id, p_room_id, month_start, p_opening, p_closing, rate, total, auth.uid())
  returning id into reading;

  select coalesce(sum(n.nights), 0) into total_nights
    from private.room_month_nights(p_room_id, month_start) n;

  -- Shares by nights, each rounded to the paisa against what is still left
  -- to share, so the shares add up to the room's amount exactly.
  if total > 0 and total_nights > 0 then
    remaining_nights := total_nights;
    for s in
      select n.resident_id, n.nights from private.room_month_nights(p_room_id, month_start) n
       order by n.nights desc, n.resident_id
    loop
      share := round((total - given)::numeric * s.nights / remaining_nights)::integer;
      given := given + share;
      remaining_nights := remaining_nights - s.nights;
      if share > 0 then
        insert into public.resident_charges
          (hostel_id, resident_id, description, amount, charge_date, meter_reading_id, created_by)
        values (
          p_hostel_id, s.resident_id,
          'Electricity, room ' || room_number || ', ' || to_char(month_start, 'FMMonth YYYY') || ': '
            || trim(to_char(units, 'FM9999999990.0')) || ' units × ₹'
            || to_char(rate / 100.0, 'FM99990.00')
            || case when s.nights = total_nights then ''
                    else ', your share for ' || s.nights || ' of ' || total_nights || ' nights' end,
          share, month_end, reading, auth.uid()
        );
      end if;
      shares := shares || jsonb_build_object('resident_id', s.resident_id, 'nights', s.nights, 'amount', share);
    end loop;
  end if;

  return jsonb_build_object(
    'reading_id', reading,
    'units', units,
    'amount', total,
    'nights', total_nights,
    'shares', shares
  );
end;
$$;

-- Voids a mistaken reading and the charges it made. Owners only, and only
-- while none of those charges has been billed.
create or replace function public.void_meter_reading(p_reading_id uuid, p_reason text)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
declare
  hostel uuid;
begin
  select m.hostel_id into hostel from public.meter_readings m where m.id = p_reading_id;
  if hostel is null or hostel not in (select private.user_owned_hostel_ids()) then
    raise exception 'You do not have permission to do that' using errcode = '42501';
  end if;
  if p_reason is null or btrim(p_reason) = '' then
    raise exception 'Give a reason' using errcode = 'P0001', hint = 'reason_required';
  end if;
  perform private.void_meter_reading(p_reading_id, btrim(p_reason));
end;
$$;

create or replace function private.void_meter_reading(p_reading_id uuid, p_reason text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  room uuid;
begin
  select m.room_id into room from public.meter_readings m where m.id = p_reading_id;
  perform pg_advisory_xact_lock(hashtextextended('meter:' || room::text, 0));
  if exists (
    select 1 from public.meter_readings m where m.id = p_reading_id and m.voided_at is not null
  ) then
    raise exception 'This reading is already void' using errcode = 'P0001', hint = 'meter_reading_void';
  end if;
  if exists (
    select 1 from public.resident_charges c
     where c.meter_reading_id = p_reading_id and c.status = 'invoiced'
  ) then
    raise exception 'Its charges are already on an invoice. Void that invoice first'
      using errcode = 'P0001', hint = 'meter_reading_billed';
  end if;

  update public.resident_charges c
     set status = 'void', void_reason = 'Meter reading voided: ' || p_reason
   where c.meter_reading_id = p_reading_id and c.status = 'pending';
  update public.meter_readings m
     set voided_at = now(), void_reason = p_reason, voided_by = auth.uid()
   where m.id = p_reading_id;
end;
$$;

-- Rooms that had someone in them during the month but have no reading.
-- Empty when the hostel does not bill electricity.
create or replace function public.missing_meter_readings(p_hostel_id uuid, p_period_month date)
returns table (room_id uuid, room_number text)
language sql
stable
security invoker
set search_path = ''
as $$
  select r.id, r.room_number
    from public.rooms r
   where r.hostel_id = p_hostel_id
     and exists (select 1 from public.electricity_rates e where e.hostel_id = p_hostel_id)
     and exists (
       select 1 from public.allocations a
        where a.room_id = r.id
          and a.start_date <= (date_trunc('month', p_period_month) + interval '1 month - 1 day')::date
          and (a.end_date is null or a.end_date >= date_trunc('month', p_period_month)::date)
     )
     and not exists (
       select 1 from public.meter_readings m
        where m.room_id = r.id
          and m.period_month = date_trunc('month', p_period_month)::date
          and m.voided_at is null
     )
   order by r.floor, lpad(r.room_number, 20, '0');
$$;

-- ---------------------------------------------------------------------------
-- Privileges and row-level security
-- ---------------------------------------------------------------------------
-- Owners set the rate; readings are written only by the functions above.
alter table public.electricity_rates enable row level security;
alter table public.meter_readings enable row level security;

revoke all on public.electricity_rates, public.meter_readings from authenticated, anon;
grant select on public.electricity_rates, public.meter_readings to authenticated;
grant insert (hostel_id, unit_rate) on public.electricity_rates to authenticated;
grant update (unit_rate) on public.electricity_rates to authenticated;
grant delete on public.electricity_rates to authenticated;

create policy "electricity rates: members read"
  on public.electricity_rates for select to authenticated
  using (hostel_id in (select private.user_hostel_ids()));
create policy "electricity rates: owners write"
  on public.electricity_rates for all to authenticated
  using (hostel_id in (select private.user_owned_hostel_ids()))
  with check (hostel_id in (select private.user_owned_hostel_ids()));
create policy "meter readings: members read"
  on public.meter_readings for select to authenticated
  using (hostel_id in (select private.user_hostel_ids()));

revoke all on function private.room_month_nights(uuid, date),
  private.record_meter_reading(uuid, uuid, date, numeric, numeric),
  private.void_meter_reading(uuid, text) from public;
grant execute on function private.room_month_nights(uuid, date),
  private.record_meter_reading(uuid, uuid, date, numeric, numeric),
  private.void_meter_reading(uuid, text) to authenticated, service_role;

revoke execute on function public.record_meter_reading(uuid, date, numeric, numeric),
  public.void_meter_reading(uuid, text),
  public.missing_meter_readings(uuid, date) from public, anon;
grant execute on function public.record_meter_reading(uuid, date, numeric, numeric),
  public.void_meter_reading(uuid, text),
  public.missing_meter_readings(uuid, date) to authenticated;
