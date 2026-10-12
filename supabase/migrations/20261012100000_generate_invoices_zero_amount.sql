-- generate_invoices: a resident whose part-month charge rounds to ₹0 is
-- skipped because nothing is owed, not because an invoice already exists, so
-- the summary no longer counts them under already_invoiced. Only possible
-- with a monthly rate below about ₹15.50 and a one-night stay.
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
    -- Priced residents who owe something but were not inserted already had
    -- an invoice, whether found up front or lost to a concurrent run.
    'already_invoiced',
      (select count(*) from candidates c where c.priced and c.amount > 0)
        - (select count(*) from inserted),
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

revoke execute on function public.generate_invoices(uuid, date, integer) from public, anon;
grant execute on function public.generate_invoices(uuid, date, integer) to authenticated;
