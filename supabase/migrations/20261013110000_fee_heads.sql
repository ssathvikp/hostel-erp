-- Fee heads and itemised invoices (E13-T1).
--
-- Rent stays as it is (fee_structures, rent overrides). Every other charge
-- a hostel makes is a fee head: mess, maintenance, Wi-Fi, laundry. A head
-- is billed every month or once (one-time heads are charged through
-- resident charges, E13-T2), priced flat or per sharing type, with rates
-- over date ranges exactly like rent.
--
-- Every invoice is now made of lines. The invoice amount is the sum of its
-- lines, checked when the transaction commits; an invoice created without
-- lines (older code paths, fixtures) is given a single rent line, so every
-- invoice reads the same way. Lines are written once, with their invoice,
-- and never changed.

-- ---------------------------------------------------------------------------
-- Fee heads and their rates
-- ---------------------------------------------------------------------------
create table public.fee_heads (
  id uuid primary key default gen_random_uuid(),
  hostel_id uuid not null references public.hostels (id) on delete cascade,
  name text not null,
  billing text not null,
  pricing text not null,
  active boolean not null default true,
  created_by uuid default auth.uid() references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint fee_heads_hostel_id_id_key unique (hostel_id, id),
  constraint fee_heads_name_length check (char_length(btrim(name)) between 1 and 60),
  -- Rent is built in, priced by fee_structures.
  constraint fee_heads_name_not_rent check (lower(btrim(name)) <> 'rent'),
  constraint fee_heads_billing_valid check (billing in ('monthly', 'one_time')),
  constraint fee_heads_pricing_valid check (pricing in ('flat', 'per_sharing'))
);

comment on table public.fee_heads is
  'Charges other than rent: billed monthly or once, priced flat or per sharing type.';

create unique index fee_heads_hostel_name_key on public.fee_heads (hostel_id, lower(btrim(name)));

create trigger fee_heads_set_updated_at
  before update on public.fee_heads
  for each row execute function private.set_updated_at();

create table public.fee_head_rates (
  id uuid primary key default gen_random_uuid(),
  hostel_id uuid not null,
  fee_head_id uuid not null,
  -- Null for a flat head; the sharing type for a per-sharing head.
  sharing_type text,
  -- Monthly for a monthly head, per charge for a one-time head. Paise.
  amount integer not null,
  effective_from date not null,
  effective_to date,
  created_by uuid default auth.uid() references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint fee_head_rates_head_fkey foreign key (hostel_id, fee_head_id)
    references public.fee_heads (hostel_id, id) on delete cascade,
  constraint fee_head_rates_sharing_type_valid
    check (sharing_type in ('single', 'double', 'triple', 'four_plus')),
  constraint fee_head_rates_amount_range check (amount between 1 and 100000000),
  constraint fee_head_rates_dates_ordered check (effective_to >= effective_from),
  constraint fee_head_rates_no_overlap exclude using gist (
    fee_head_id extensions.gist_uuid_ops with =,
    (coalesce(sharing_type, '')) extensions.gist_text_ops with =,
    daterange(effective_from, effective_to, '[]') with &&
  )
);

create index fee_head_rates_head_idx on public.fee_head_rates (fee_head_id, effective_from);

create trigger fee_head_rates_set_updated_at
  before update on public.fee_head_rates
  for each row execute function private.set_updated_at();

-- The rate in force for a head (and sharing type, for per-sharing heads) on
-- a day, or null when none is set.
create or replace function private.fee_head_rate(
  p_fee_head_id uuid,
  p_sharing_type text,
  p_on date
)
returns integer
language sql
stable
security invoker
set search_path = ''
as $$
  select r.amount
    from public.fee_head_rates r
    join public.fee_heads h on h.id = r.fee_head_id
   where r.fee_head_id = p_fee_head_id
     and (h.pricing = 'flat' or r.sharing_type = p_sharing_type)
     and r.effective_from <= p_on
     and (r.effective_to is null or r.effective_to >= p_on);
$$;

grant execute on function private.fee_head_rate(uuid, text, date) to authenticated, service_role;

-- Sets a head's rate from a date with the same rules as set_fee_structure:
-- a later rate blocks an earlier one, the same start date corrects the
-- amount, and a new rate closes the one in force the day before it starts.
create or replace function public.set_fee_head_rate(
  p_fee_head_id uuid,
  p_amount integer,
  p_effective_from date,
  -- Required for a per-sharing head; ignored for a flat one.
  p_sharing_type text default null
)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  head public.fee_heads%rowtype;
  sharing text;
  later date;
  result uuid;
begin
  select * into head from public.fee_heads h where h.id = p_fee_head_id;
  if not found then
    raise exception 'Charge not found' using errcode = 'P0001', hint = 'fee_head_not_found';
  end if;
  if head.pricing = 'flat' then
    sharing := null;
  elsif p_sharing_type is null then
    raise exception 'Choose a sharing type' using errcode = 'P0001', hint = 'fee_head_sharing_required';
  else
    sharing := p_sharing_type;
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended('fee_head_rates:' || head.id::text || ':' || coalesce(sharing, ''), 0)
  );

  select min(r.effective_from) into later
    from public.fee_head_rates r
   where r.fee_head_id = head.id
     and r.sharing_type is not distinct from sharing
     and r.effective_from > p_effective_from;
  if later is not null then
    raise exception 'A later rate for this charge starts on %', to_char(later, 'FMDD Mon YYYY')
      using errcode = 'P0001', hint = 'fee_head_later_exists';
  end if;

  update public.fee_head_rates r
     set amount = p_amount
   where r.fee_head_id = head.id
     and r.sharing_type is not distinct from sharing
     and r.effective_from = p_effective_from
  returning r.id into result;
  if result is not null then
    return result;
  end if;

  update public.fee_head_rates r
     set effective_to = p_effective_from - 1
   where r.fee_head_id = head.id
     and r.sharing_type is not distinct from sharing
     and r.effective_from < p_effective_from
     and (r.effective_to is null or r.effective_to >= p_effective_from);

  insert into public.fee_head_rates (hostel_id, fee_head_id, sharing_type, amount, effective_from)
  values (head.hostel_id, head.id, sharing, p_amount, p_effective_from)
  returning id into result;
  return result;
end;
$$;

-- Residents excused from a monthly head, for example no mess.
create table public.resident_fee_exemptions (
  hostel_id uuid not null,
  resident_id uuid not null,
  fee_head_id uuid not null,
  created_by uuid default auth.uid() references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),

  primary key (resident_id, fee_head_id),
  constraint resident_fee_exemptions_resident_fkey foreign key (hostel_id, resident_id)
    references public.residents (hostel_id, id) on delete cascade,
  constraint resident_fee_exemptions_head_fkey foreign key (hostel_id, fee_head_id)
    references public.fee_heads (hostel_id, id) on delete cascade
);

-- ---------------------------------------------------------------------------
-- Invoice lines
-- ---------------------------------------------------------------------------
create table public.invoice_lines (
  id uuid primary key default gen_random_uuid(),
  hostel_id uuid not null,
  invoice_id uuid not null,
  position integer not null,
  kind text not null,
  fee_head_id uuid,
  description text not null,
  -- How the amount was reached (nights, rate), for the printed invoice.
  detail jsonb not null default '{}'::jsonb,
  amount integer not null,
  created_at timestamptz not null default now(),

  constraint invoice_lines_invoice_fkey foreign key (hostel_id, invoice_id)
    references public.invoices (hostel_id, id) on delete cascade,
  constraint invoice_lines_head_fkey foreign key (hostel_id, fee_head_id)
    references public.fee_heads (hostel_id, id),
  constraint invoice_lines_invoice_position_key unique (invoice_id, position),
  constraint invoice_lines_kind_valid
    check (kind in ('rent', 'fee', 'charge', 'discount', 'late_fee')),
  constraint invoice_lines_amount_nonzero check (amount <> 0),
  -- Discounts are the only negative lines.
  constraint invoice_lines_amount_sign check ((kind = 'discount') = (amount < 0)),
  constraint invoice_lines_description_length check (char_length(btrim(description)) between 1 and 200),
  constraint invoice_lines_detail_is_object check (jsonb_typeof(detail) = 'object')
);

comment on table public.invoice_lines is
  'What an invoice is made of. Written with the invoice, never changed; they sum to its amount.';

create index invoice_lines_invoice_idx on public.invoice_lines (invoice_id, position);
create index invoice_lines_head_idx on public.invoice_lines (fee_head_id) where fee_head_id is not null;

-- Existing invoices: one rent line each, from their stay breakdown.
insert into public.invoice_lines (hostel_id, invoice_id, position, kind, description, detail, amount)
select i.hostel_id, i.id, 1, 'rent', 'Rent', jsonb_build_object('stays', i.breakdown), i.amount
  from public.invoices i;

-- Checked at commit, so an invoice and its lines can be written in any
-- order within one transaction. An invoice with no lines gets a single rent
-- line; otherwise the lines must add up to the amount exactly.
create or replace function private.invoice_lines_balance()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  target uuid;
  invoice record;
  line_count integer;
  line_total bigint;
begin
  -- NEW has different columns on the two tables, so each is read on its own.
  if tg_table_name = 'invoices' then
    target := new.id;
  else
    target := new.invoice_id;
  end if;

  select i.id, i.hostel_id, i.amount, i.breakdown into invoice
    from public.invoices i where i.id = target;
  if not found then
    return null;
  end if;

  select count(*), coalesce(sum(l.amount), 0) into line_count, line_total
    from public.invoice_lines l where l.invoice_id = target;

  if line_count = 0 then
    insert into public.invoice_lines (hostel_id, invoice_id, position, kind, description, detail, amount)
    values (invoice.hostel_id, invoice.id, 1, 'rent', 'Rent',
            jsonb_build_object('stays', invoice.breakdown), invoice.amount);
  elsif line_total <> invoice.amount then
    raise exception 'Invoice lines add up to % but the invoice is for %', line_total, invoice.amount
      using errcode = 'P0001', hint = 'invoice_lines_mismatch';
  end if;
  return null;
end;
$$;

create constraint trigger invoices_lines_balance
  after insert on public.invoices
  deferrable initially deferred
  for each row execute function private.invoice_lines_balance();

create constraint trigger invoice_lines_balance
  after insert on public.invoice_lines
  deferrable initially deferred
  for each row execute function private.invoice_lines_balance();

-- ---------------------------------------------------------------------------
-- Monthly lines for a resident
-- ---------------------------------------------------------------------------
-- The fee lines (not rent) a resident owes for a month, from their stays in
-- it (`p_stays`: the invoice breakdown, one entry per stay with its sharing
-- type and nights). Each active monthly head the resident is not excused
-- from is billed like rent: a whole month at the rate, a part month for the
-- nights held, rounded to the rupee. A per-sharing head with no rate for a
-- stay's sharing type is not charged for that stay. Later work adds charges,
-- discounts and late fees by redefining this function.
create or replace function private.month_fee_lines(
  p_hostel_id uuid,
  p_resident_id uuid,
  p_month_start date,
  p_days integer,
  p_stays jsonb
)
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
  select coalesce(jsonb_agg(line order by name), '[]'::jsonb)
    from (
      select h.name,
             jsonb_build_object(
               'kind', 'fee',
               'fee_head_id', h.id,
               'description', h.name,
               'detail', jsonb_build_object('nights', x.nights, 'monthly_rate', x.rate),
               'amount', x.amount
             ) as line
        from public.fee_heads h
        cross join lateral (
          select sum(s.nights)::integer as nights,
                 max(s.rate) as rate,
                 case
                   when count(*) = 1 and bool_and(s.nights = p_days) then max(s.rate)
                   else (round(sum(s.rate::numeric * s.nights) / p_days / 100) * 100)::integer
                 end as amount
            from (
              select (st ->> 'nights')::integer as nights,
                     private.fee_head_rate(h.id, st ->> 'sharing_type', p_month_start) as rate
                from jsonb_array_elements(p_stays) st
            ) s
           where s.rate is not null
        ) x
       where h.hostel_id = p_hostel_id
         and h.billing = 'monthly'
         and h.active
         and x.amount > 0
         and not exists (
           select 1 from public.resident_fee_exemptions e
            where e.resident_id = p_resident_id and e.fee_head_id = h.id
         )
    ) lines;
$$;

grant execute on function private.month_fee_lines(uuid, uuid, date, integer, jsonb)
  to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Monthly invoice generation, itemised
-- ---------------------------------------------------------------------------
-- Same rules as before for rent, who is billed and the summary. Runs one
-- resident at a time under a lock for the hostel and month, so concurrent
-- runs queue and never double-bill, and writes each invoice with its lines.
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

  -- One run per hostel and month at a time; a second run waits, then sees
  -- every invoice the first created.
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
      -- Whole months bill the exact rate; part months round to the rupee.
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

    lines := private.month_fee_lines(p_hostel_id, r.resident_id, month_start, days, r.breakdown);
    if r.rent > 0 then
      lines := jsonb_build_array(jsonb_build_object(
        'kind', 'rent',
        'description', 'Rent',
        'detail', jsonb_build_object('stays', r.breakdown),
        'amount', r.rent
      )) || lines;
    end if;
    select coalesce(sum((l ->> 'amount')::integer), 0) into invoice_total
      from jsonb_array_elements(lines) l;

    -- Nothing owed (a part month that rounds to ₹0): not an invoice.
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
    on conflict (resident_id, period_month) where status = 'issued' do nothing
    returning id into new_invoice;
    if new_invoice is null then
      already := already + 1;
      continue;
    end if;

    insert into public.invoice_lines
      (hostel_id, invoice_id, position, kind, fee_head_id, description, detail, amount)
    select p_hostel_id, new_invoice, e.ord, e.l ->> 'kind', (e.l ->> 'fee_head_id')::uuid,
           e.l ->> 'description', coalesce(e.l -> 'detail', '{}'::jsonb), (e.l ->> 'amount')::integer
      from jsonb_array_elements(lines) with ordinality as e(l, ord);

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

-- ---------------------------------------------------------------------------
-- Privileges and row-level security
-- ---------------------------------------------------------------------------
-- Owners price charges and excuse residents; every member reads them. Lines
-- are written only with their invoice, by owners.
alter table public.fee_heads enable row level security;
alter table public.fee_head_rates enable row level security;
alter table public.resident_fee_exemptions enable row level security;
alter table public.invoice_lines enable row level security;

revoke all on public.fee_heads, public.fee_head_rates, public.resident_fee_exemptions,
  public.invoice_lines from authenticated, anon;

grant select on public.fee_heads to authenticated;
grant insert (hostel_id, name, billing, pricing) on public.fee_heads to authenticated;
grant update (name, active) on public.fee_heads to authenticated;

grant select on public.fee_head_rates to authenticated;
grant insert (hostel_id, fee_head_id, sharing_type, amount, effective_from)
  on public.fee_head_rates to authenticated;
grant update (amount, effective_to) on public.fee_head_rates to authenticated;

grant select, delete on public.resident_fee_exemptions to authenticated;
grant insert (hostel_id, resident_id, fee_head_id) on public.resident_fee_exemptions to authenticated;

grant select on public.invoice_lines to authenticated;
grant insert (hostel_id, invoice_id, position, kind, fee_head_id, description, detail, amount)
  on public.invoice_lines to authenticated;

create policy "fee heads: members read"
  on public.fee_heads for select to authenticated
  using (hostel_id in (select private.user_hostel_ids()));
create policy "fee heads: owners create"
  on public.fee_heads for insert to authenticated
  with check (hostel_id in (select private.user_owned_hostel_ids()));
create policy "fee heads: owners update"
  on public.fee_heads for update to authenticated
  using (hostel_id in (select private.user_owned_hostel_ids()))
  with check (hostel_id in (select private.user_owned_hostel_ids()));

create policy "fee head rates: members read"
  on public.fee_head_rates for select to authenticated
  using (hostel_id in (select private.user_hostel_ids()));
create policy "fee head rates: owners create"
  on public.fee_head_rates for insert to authenticated
  with check (hostel_id in (select private.user_owned_hostel_ids()));
create policy "fee head rates: owners update"
  on public.fee_head_rates for update to authenticated
  using (hostel_id in (select private.user_owned_hostel_ids()))
  with check (hostel_id in (select private.user_owned_hostel_ids()));

create policy "fee exemptions: members read"
  on public.resident_fee_exemptions for select to authenticated
  using (hostel_id in (select private.user_hostel_ids()));
create policy "fee exemptions: owners add"
  on public.resident_fee_exemptions for insert to authenticated
  with check (hostel_id in (select private.user_owned_hostel_ids()));
create policy "fee exemptions: owners remove"
  on public.resident_fee_exemptions for delete to authenticated
  using (hostel_id in (select private.user_owned_hostel_ids()));

create policy "invoice lines: members read"
  on public.invoice_lines for select to authenticated
  using (hostel_id in (select private.user_hostel_ids()));
create policy "invoice lines: owners issue"
  on public.invoice_lines for insert to authenticated
  with check (hostel_id in (select private.user_owned_hostel_ids()));

revoke execute on function public.set_fee_head_rate(uuid, integer, date, text) from public, anon;
grant execute on function public.set_fee_head_rate(uuid, integer, date, text) to authenticated;
