-- Dashboard read models (E8-T1, E8-T2, E8-T4).
--
-- Everything here is derived at read time from allocations, beds, invoices
-- and payments, so the dashboard can never disagree with the occupancy and
-- fee screens. All functions are SECURITY INVOKER: RLS decides what the
-- caller sees, and another hostel's id simply returns nothing.

-- ---------------------------------------------------------------------------
-- Occupancy trend (E8-T2)
-- ---------------------------------------------------------------------------
-- Occupied beds per day from allocation dates, so history is correct
-- retroactively (a backdated allocation changes past days too). The bed
-- count for a day is every bed not yet retired that day (and not in a room
-- archived by then). Bed creation dates are deliberately ignored: owners
-- enter their rooms on the day they start using the app and backdate the
-- residents already living there, so the day a bed was entered says
-- nothing about when it existed. A room added later therefore slightly
-- understates earlier months; it never inflates them. Rooms record no
-- archive date, so an archived room's last update stands in for it.
--
-- Day granularity returns one row per day; month granularity returns one
-- row per month with the average over the days of that month in range.
-- Days after today (India) are never returned.
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
  bed_life as (
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
  stays as (
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

-- ---------------------------------------------------------------------------
-- Money for a period (E8-T1, E8-T4)
-- ---------------------------------------------------------------------------
-- collected: live payments received in the range.
-- billed:    issued invoices for billing months that start in the range.
-- outstanding / overdue: everything still owed today, whatever the period,
--            so it matches the fee list's totals exactly.
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
  overdue_residents integer
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
  select
    coalesce((select sum(p.amount) from public.payments p
               where p.hostel_id = p_hostel_id and p.voided_at is null
                 and p.paid_at between p_from and p_to), 0)::bigint,
    (select count(*) from public.payments p
      where p.hostel_id = p_hostel_id and p.voided_at is null
        and p.paid_at between p_from and p_to)::integer,
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
      where b.hostel_id = p_hostel_id and b.overdue > 0)::integer;
end;
$$;

revoke execute on function public.occupancy_trend(uuid, date, date, text) from public, anon;
revoke execute on function public.dashboard_money(uuid, date, date) from public, anon;
grant execute on function public.occupancy_trend(uuid, date, date, text) to authenticated;
grant execute on function public.dashboard_money(uuid, date, date) to authenticated;
