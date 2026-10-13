-- Collection reports and exports (E13-T12).
--
-- Every report is one database function that returns a single value (JSON
-- for the screens, CSV text for the exports), so no list is cut short by
-- the API's 1000-row limit however large the hostel.
--
-- collections_report counts money exactly as the dashboard's "collected"
-- figure does (dashboard_money): payments received, cheques once cleared,
-- and money received as credit; never credit or deposit applied to an
-- invoice (that money was counted when it came in). Deposits received are
-- shown beside it, never inside it: they are held, not earned.
--
-- The public functions check the caller works in the hostel and hand over
-- to SECURITY DEFINER workers, which read collectors' names from profiles.

-- ---------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------
create or replace function private.require_hostel_member(p_hostel_id uuid)
returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if p_hostel_id is null or p_hostel_id not in (select private.user_hostel_ids()) then
    raise exception 'You do not have permission to do that' using errcode = '42501';
  end if;
end;
$$;

-- One CSV field: quoted, with quotes doubled. Text a spreadsheet would run
-- as a formula (starting = + - @) is prefixed with an apostrophe.
create or replace function private.csv_field(p_value text)
returns text
language sql
immutable
set search_path = ''
as $$
  select '"' || replace(
    case when p_value ~ '^[=+\-@]' then '''' || p_value else coalesce(p_value, '') end,
    '"', '""'
  ) || '"';
$$;

-- Paise as rupees with two decimals, for CSV.
create or replace function private.csv_rupees(p_paise bigint)
returns text
language sql
immutable
set search_path = ''
as $$
  select to_char(p_paise / 100.0, 'FM9999999999990.00');
$$;

-- Money received in a range, one row per receipt, as collected counts it.
create or replace function private.collections(p_hostel_id uuid, p_from date, p_to date)
returns table (
  day date,
  number text,
  resident_name text,
  mode text,
  reference text,
  collector text,
  amount integer,
  kind text
)
language sql
stable
security definer
set search_path = ''
as $$
  select p.paid_at, p.number, r.full_name, p.mode, p.reference,
         coalesce(p.recorded_by_name, pr.full_name), p.amount, 'invoice'
    from public.payments p
    join public.invoices i on i.id = p.invoice_id
    join public.residents r on r.id = i.resident_id
    left join public.profiles pr on pr.id = p.recorded_by
   where p.hostel_id = p_hostel_id
     and p.voided_at is null
     and p.mode not in ('credit', 'deposit')
     and (p.mode <> 'cheque' or p.cleared_on is not null)
     and p.paid_at between p_from and p_to
  union all
  select c.paid_at, c.number, r.full_name, c.mode, c.reference, pr.full_name, c.amount, 'credit'
    from public.resident_credit c
    join public.residents r on r.id = c.resident_id
    left join public.profiles pr on pr.id = c.recorded_by
   where c.hostel_id = p_hostel_id
     and c.kind = 'received'
     and c.paid_at between p_from and p_to;
$$;

-- ---------------------------------------------------------------------------
-- Collections
-- ---------------------------------------------------------------------------
create or replace function public.collections_report(p_hostel_id uuid, p_from date, p_to date)
returns jsonb
language plpgsql
stable
security invoker
set search_path = ''
as $$
begin
  perform private.require_hostel_member(p_hostel_id);
  if p_from is null or p_to is null or p_from > p_to then
    raise exception 'The start date must be on or before the end date'
      using errcode = 'P0001', hint = 'range_reversed';
  end if;
  -- The dashboard's limit too.
  if p_to - p_from > 731 then
    raise exception 'Choose a range of two years or less' using errcode = 'P0001', hint = 'range_too_long';
  end if;
  return private.collections_report(p_hostel_id, p_from, p_to);
end;
$$;

create or replace function private.collections_report(p_hostel_id uuid, p_from date, p_to date)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  with c as (select * from private.collections(p_hostel_id, p_from, p_to))
  select jsonb_build_object(
    'total', coalesce((select sum(amount) from c), 0),
    'count', (select count(*) from c),
    'by_mode', coalesce((
      select jsonb_agg(jsonb_build_object('mode', mode, 'amount', amount, 'count', n) order by amount desc)
        from (select mode, sum(amount)::bigint as amount, count(*) as n from c group by mode) m
    ), '[]'::jsonb),
    'by_collector', coalesce((
      select jsonb_agg(jsonb_build_object('collector', collector, 'amount', amount, 'count', n)
                       order by amount desc)
        from (select collector, sum(amount)::bigint as amount, count(*) as n from c group by collector) m
    ), '[]'::jsonb),
    'days', coalesce((
      select jsonb_agg(jsonb_build_object('day', day, 'mode', mode, 'collector', collector,
                                          'amount', amount, 'count', n)
                       order by day desc, mode, collector)
        from (select day, mode, collector, sum(amount)::bigint as amount, count(*) as n
                from c group by day, mode, collector) d
    ), '[]'::jsonb),
    'deposits', (
      select jsonb_build_object('amount', coalesce(sum(d.amount), 0), 'count', count(*))
        from public.deposit_ledger d
       where d.hostel_id = p_hostel_id and d.kind = 'received'
         and d.paid_at between p_from and p_to
    )
  );
$$;

-- Every receipt in the range, for reconciling the cash box and bank.
create or replace function public.collections_csv(p_hostel_id uuid, p_from date, p_to date)
returns text
language plpgsql
stable
security invoker
set search_path = ''
as $$
begin
  perform private.require_hostel_member(p_hostel_id);
  if p_from is null or p_to is null or p_from > p_to then
    raise exception 'The start date must be on or before the end date'
      using errcode = 'P0001', hint = 'range_reversed';
  end if;
  return private.collections_csv(p_hostel_id, p_from, p_to);
end;
$$;

create or replace function private.collections_csv(p_hostel_id uuid, p_from date, p_to date)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select 'Date,Receipt,Resident,Mode,Reference,Collected by,Amount (INR),For' || E'\n'
    || coalesce(string_agg(
         concat_ws(',',
           to_char(c.day, 'YYYY-MM-DD'),
           private.csv_field(c.number),
           private.csv_field(c.resident_name),
           private.csv_field(c.mode),
           private.csv_field(c.reference),
           private.csv_field(c.collector),
           private.csv_rupees(c.amount),
           private.csv_field(case c.kind when 'credit' then 'Advance or credit' else 'Invoice' end)
         ),
         E'\n' order by c.day, c.number
       ) || E'\n', '')
    from private.collections(p_hostel_id, p_from, p_to) c;
$$;

-- ---------------------------------------------------------------------------
-- Dues ageing
-- ---------------------------------------------------------------------------
-- What is owed, by how long past its due date: not yet due, up to 30 days,
-- 31-60, 61-90 and over 90. Pending cheques are still owed.
create or replace function public.dues_ageing(p_hostel_id uuid)
returns jsonb
language plpgsql
stable
security invoker
set search_path = ''
as $$
begin
  perform private.require_hostel_member(p_hostel_id);
  return private.dues_ageing(p_hostel_id);
end;
$$;

create or replace function private.dues_ageing(p_hostel_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  with open as (
    select b.resident_id, b.resident_name, b.resident_phone, b.balance,
           case
             when private.today_ist() - b.due_date <= 0 then 'not_due'
             when private.today_ist() - b.due_date <= 30 then 'd30'
             when private.today_ist() - b.due_date <= 60 then 'd60'
             when private.today_ist() - b.due_date <= 90 then 'd90'
             else 'over90'
           end as bucket
      from public.invoice_balances b
     where b.hostel_id = p_hostel_id and b.status = 'issued' and b.balance > 0
  ),
  residents as (
    select resident_id, max(resident_name) as name, max(resident_phone) as phone,
           sum(balance) filter (where bucket = 'not_due') as not_due,
           sum(balance) filter (where bucket = 'd30') as d30,
           sum(balance) filter (where bucket = 'd60') as d60,
           sum(balance) filter (where bucket = 'd90') as d90,
           sum(balance) filter (where bucket = 'over90') as over90,
           sum(balance) as total
      from open group by resident_id
  )
  select jsonb_build_object(
    'buckets', jsonb_build_object(
      'not_due', coalesce((select sum(balance) from open where bucket = 'not_due'), 0),
      'd30', coalesce((select sum(balance) from open where bucket = 'd30'), 0),
      'd60', coalesce((select sum(balance) from open where bucket = 'd60'), 0),
      'd90', coalesce((select sum(balance) from open where bucket = 'd90'), 0),
      'over90', coalesce((select sum(balance) from open where bucket = 'over90'), 0)
    ),
    'total', coalesce((select sum(balance) from open), 0),
    'residents', coalesce((
      select jsonb_agg(jsonb_build_object(
               'resident_id', resident_id, 'name', name, 'phone', phone,
               'not_due', coalesce(not_due, 0), 'd30', coalesce(d30, 0), 'd60', coalesce(d60, 0),
               'd90', coalesce(d90, 0), 'over90', coalesce(over90, 0), 'total', total
             ) order by over90 desc nulls last, d90 desc nulls last, d60 desc nulls last, total desc, name)
        from residents
    ), '[]'::jsonb)
  );
$$;

-- ---------------------------------------------------------------------------
-- Monthly fee register
-- ---------------------------------------------------------------------------
-- One CSV for the accountant: the month's invoices and their lines, and
-- every payment, credit and deposit movement dated in the month, void ones
-- included and marked.
create or replace function public.fee_register_csv(p_hostel_id uuid, p_month date)
returns text
language plpgsql
stable
security invoker
set search_path = ''
as $$
begin
  perform private.require_hostel_member(p_hostel_id);
  if p_month is null then
    raise exception 'Choose a month' using errcode = 'P0001', hint = 'billing_month';
  end if;
  return private.fee_register_csv(p_hostel_id, date_trunc('month', p_month)::date);
end;
$$;

create or replace function private.fee_register_csv(p_hostel_id uuid, p_month date)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  with bounds as (
    select p_month as month_start, (p_month + interval '1 month - 1 day')::date as month_end
  ),
  rows as (
    -- Invoices for the month, then each one's lines.
    select 1 as section, i.number as sort_key, 0 as position,
           'Invoice' as record, (i.created_at at time zone 'Asia/Kolkata')::date as day,
           i.number, r.full_name as resident,
           case i.kind when 'charges' then 'Charges billed on their own'
                       else 'Monthly invoice for ' || to_char(i.period_month, 'FMMonth YYYY') end
             as description,
           null::text as mode, null::text as reference, i.amount::bigint as amount,
           case when i.status = 'void' then 'Void: ' || i.void_reason else 'Issued' end as status,
           i.number as invoice_number
      from public.invoices i
      join public.residents r on r.id = i.resident_id
      cross join bounds b
     where i.hostel_id = p_hostel_id and i.period_month = b.month_start
    union all
    select 1, i.number, l.position, 'Invoice line', (i.created_at at time zone 'Asia/Kolkata')::date,
           i.number, r.full_name, l.description, null, null, l.amount::bigint,
           case when i.status = 'void' then 'Void' else 'Issued' end, i.number
      from public.invoice_lines l
      join public.invoices i on i.id = l.invoice_id
      join public.residents r on r.id = i.resident_id
      cross join bounds b
     where i.hostel_id = p_hostel_id and i.period_month = b.month_start
    union all
    -- Payments dated in the month, whatever month they paid.
    select 2, to_char(p.paid_at, 'YYYYMMDD') || coalesce(p.number, ''), 0,
           case p.mode when 'credit' then 'Paid from credit'
                       when 'deposit' then 'Paid from deposit'
                       else 'Payment' end,
           p.paid_at, p.number, r.full_name,
           case when p.mode = 'cheque' then 'Cheque on ' || p.cheque_bank else null end,
           p.mode, p.reference, p.amount::bigint,
           case when p.bounced then 'Bounced: ' || p.void_reason
                when p.voided_at is not null then 'Void: ' || p.void_reason
                when p.mode = 'cheque' and p.cleared_on is null then 'Cheque pending'
                when p.mode = 'cheque' then 'Cleared ' || to_char(p.cleared_on, 'YYYY-MM-DD')
                else 'Received' end,
           i.number
      from public.payments p
      join public.invoices i on i.id = p.invoice_id
      join public.residents r on r.id = i.resident_id
      cross join bounds b
     where p.hostel_id = p_hostel_id and p.paid_at between b.month_start and b.month_end
    union all
    -- Credit and deposit movements dated in the month.
    select 3, to_char(c.paid_at, 'YYYYMMDD') || coalesce(c.number, ''), 0,
           case c.kind when 'received' then 'Credit received'
                       when 'adjustment' then 'Credit given'
                       when 'applied' then 'Credit applied'
                       else 'Credit paid back' end,
           c.paid_at, c.number, r.full_name, c.note, c.mode, c.reference, c.amount::bigint,
           'Recorded', i.number
      from public.resident_credit c
      join public.residents r on r.id = c.resident_id
      left join public.invoices i on i.id = c.invoice_id
      cross join bounds b
     where c.hostel_id = p_hostel_id and c.paid_at between b.month_start and b.month_end
    union all
    select 4, to_char(d.paid_at, 'YYYYMMDD') || coalesce(d.number, ''), 0,
           case d.kind when 'due' then 'Deposit asked for'
                       when 'received' then 'Deposit received'
                       when 'deduction' then 'Deposit kept'
                       when 'applied' then 'Deposit applied'
                       else 'Deposit paid back' end,
           d.paid_at, d.number, r.full_name, d.note, d.mode, d.reference, d.amount::bigint,
           'Recorded', i.number
      from public.deposit_ledger d
      join public.residents r on r.id = d.resident_id
      left join public.invoices i on i.id = d.invoice_id
      cross join bounds b
     where d.hostel_id = p_hostel_id and d.paid_at between b.month_start and b.month_end
  )
  select 'Record,Date,Number,Resident,Description,Mode,Reference,Amount (INR),Status,Invoice' || E'\n'
    || coalesce(string_agg(
         concat_ws(',',
           private.csv_field(x.record),
           to_char(x.day, 'YYYY-MM-DD'),
           private.csv_field(x.number),
           private.csv_field(x.resident),
           private.csv_field(x.description),
           private.csv_field(x.mode),
           private.csv_field(x.reference),
           private.csv_rupees(x.amount),
           private.csv_field(x.status),
           private.csv_field(x.invoice_number)
         ),
         E'\n' order by x.section, x.sort_key, x.position
       ) || E'\n', '')
    from rows x;
$$;

-- ---------------------------------------------------------------------------
-- Privileges
-- ---------------------------------------------------------------------------
revoke all on function private.require_hostel_member(uuid),
  private.csv_field(text), private.csv_rupees(bigint),
  private.collections(uuid, date, date),
  private.collections_report(uuid, date, date),
  private.collections_csv(uuid, date, date),
  private.dues_ageing(uuid),
  private.fee_register_csv(uuid, date) from public;
grant execute on function private.require_hostel_member(uuid),
  private.csv_field(text), private.csv_rupees(bigint),
  private.collections(uuid, date, date),
  private.collections_report(uuid, date, date),
  private.collections_csv(uuid, date, date),
  private.dues_ageing(uuid),
  private.fee_register_csv(uuid, date) to authenticated, service_role;

revoke execute on function public.collections_report(uuid, date, date),
  public.collections_csv(uuid, date, date),
  public.dues_ageing(uuid),
  public.fee_register_csv(uuid, date) from public, anon;
grant execute on function public.collections_report(uuid, date, date),
  public.collections_csv(uuid, date, date),
  public.dues_ageing(uuid),
  public.fee_register_csv(uuid, date) to authenticated;
