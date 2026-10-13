-- Sequential invoice and receipt numbers (E13-T9).
--
-- Printed numbers used to be the first 8 characters of the record id: not
-- sequential, and two records could share one. GST rules expect invoice
-- numbers that run consecutively within a financial year (April to March),
-- unique, and at most 16 characters. Each hostel now has its own series:
--
--   invoices  INV/26-27/00001
--   payments  RCT/26-27/00001   (the receipt number)
--
-- The financial year is that of the day the document is issued, in India.
-- The counter row is updated in the same transaction as the insert, so
-- concurrent inserts queue on it and a rolled-back insert gives its number
-- back: the series has no gaps. A void invoice keeps its number;
-- generating the month again issues a new one.

-- ---------------------------------------------------------------------------
-- Financial year
-- ---------------------------------------------------------------------------
-- '26-27' for any day from 1 April 2026 to 31 March 2027.
create or replace function private.financial_year(p_day date)
returns text
language sql
immutable
set search_path = ''
as $$
  select lpad((fy % 100)::text, 2, '0') || '-' || lpad(((fy + 1) % 100)::text, 2, '0')
    from (select (extract(year from p_day)::integer
                  - case when extract(month from p_day) < 4 then 1 else 0 end) as fy) y;
$$;

-- ---------------------------------------------------------------------------
-- Counters
-- ---------------------------------------------------------------------------
-- Private: never readable or writable through the API.
create table private.document_series (
  hostel_id uuid not null references public.hostels (id) on delete cascade,
  kind text not null,
  financial_year text not null,
  last_number integer not null,
  primary key (hostel_id, kind, financial_year),
  constraint document_series_kind_valid check (kind in ('invoice', 'receipt')),
  constraint document_series_positive check (last_number > 0)
);

-- The next number in a series, as text. SECURITY DEFINER because users hold
-- no privileges on the counters; it only ever advances a series.
create or replace function private.next_document_number(
  p_hostel_id uuid,
  p_kind text,
  p_day date
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  fy text := private.financial_year(p_day);
  next_number integer;
begin
  insert into private.document_series as s (hostel_id, kind, financial_year, last_number)
  values (p_hostel_id, p_kind, fy, 1)
  on conflict (hostel_id, kind, financial_year)
    do update set last_number = s.last_number + 1
  returning s.last_number into next_number;

  return case p_kind when 'invoice' then 'INV' else 'RCT' end
    || '/' || fy || '/' || lpad(next_number::text, 5, '0');
end;
$$;

revoke all on function private.next_document_number(uuid, text, date) from public;
grant execute on function private.next_document_number(uuid, text, date) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Numbers on invoices and payments
-- ---------------------------------------------------------------------------
alter table public.invoices add column number text;
alter table public.payments add column number text;

-- Existing rows, numbered in the order they were created.
alter table public.invoices disable trigger invoices_guard_update;
alter table public.payments disable trigger payments_guard_update;

with ordered as (
  select i.id, i.hostel_id,
         private.financial_year((i.created_at at time zone 'Asia/Kolkata')::date) as fy,
         row_number() over (
           partition by i.hostel_id,
                        private.financial_year((i.created_at at time zone 'Asia/Kolkata')::date)
           order by i.created_at, i.id
         ) as n
    from public.invoices i
)
update public.invoices i
   set number = 'INV/' || o.fy || '/' || lpad(o.n::text, 5, '0')
  from ordered o
 where o.id = i.id;

with ordered as (
  select p.id, p.hostel_id,
         private.financial_year((p.created_at at time zone 'Asia/Kolkata')::date) as fy,
         row_number() over (
           partition by p.hostel_id,
                        private.financial_year((p.created_at at time zone 'Asia/Kolkata')::date)
           order by p.created_at, p.id
         ) as n
    from public.payments p
)
update public.payments p
   set number = 'RCT/' || o.fy || '/' || lpad(o.n::text, 5, '0')
  from ordered o
 where o.id = p.id;

alter table public.invoices enable trigger invoices_guard_update;
alter table public.payments enable trigger payments_guard_update;

-- The counters continue from the backfilled numbers.
insert into private.document_series (hostel_id, kind, financial_year, last_number)
select hostel_id, 'invoice', split_part(number, '/', 2), max(split_part(number, '/', 3)::integer)
  from public.invoices group by hostel_id, split_part(number, '/', 2)
union all
select hostel_id, 'receipt', split_part(number, '/', 2), max(split_part(number, '/', 3)::integer)
  from public.payments group by hostel_id, split_part(number, '/', 2);

-- Always overwritten by the invoices_z_assign_number trigger, like hostels.slug.
alter table public.invoices
  alter column number set default '',
  alter column number set not null,
  add constraint invoices_number_format
    check (number ~ '^INV/[0-9]{2}-[0-9]{2}/[0-9]{5,}$' and char_length(number) <= 16),
  add constraint invoices_hostel_number_key unique (hostel_id, number);

-- Always overwritten by the payments_z_assign_number trigger, like hostels.slug.
alter table public.payments
  alter column number set default '',
  alter column number set not null,
  add constraint payments_number_format
    check (number ~ '^RCT/[0-9]{2}-[0-9]{2}/[0-9]{5,}$' and char_length(number) <= 16),
  add constraint payments_hostel_number_key unique (hostel_id, number);

-- Assigned on insert, whatever the client sent. Users have no column grant
-- on number, and these triggers run before the row is checked.
create or replace function private.assign_document_number()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  new.number := private.next_document_number(
    new.hostel_id,
    case tg_table_name when 'invoices' then 'invoice' else 'receipt' end,
    private.today_ist()
  );
  return new;
end;
$$;

-- Named to run after the guard triggers (alphabetical order), so a refused
-- payment never takes a number.
create trigger invoices_z_assign_number
  before insert on public.invoices
  for each row execute function private.assign_document_number();

create trigger payments_z_assign_number
  before insert on public.payments
  for each row execute function private.assign_document_number();

-- ---------------------------------------------------------------------------
-- Read model
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
  i.number
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
