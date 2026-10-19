-- Sequential, GST-ready invoice and receipt numbers (ClickUp E13-T9).
--
-- Each hostel numbers its invoices and its receipts in a series per
-- Indian financial year (April to March): INV/26-27/00001, RCT/26-27/00001.
-- Numbers are given by trigger at insert, from a per-hostel counter row
-- that is locked for the rest of the transaction, so concurrent inserts
-- never share or skip a number (a rolled-back insert rolls its counter back
-- too). A void invoice keeps its number; generating the month again takes a
-- new one. Users can never write a number.
--
-- Tax lines (rate and SAC code per fee head) wait for a chartered
-- accountant to confirm the GST treatment of hostel rent.

create table public.document_counters (
  hostel_id uuid not null references public.hostels (id) on delete cascade,
  series text not null,
  fiscal_year text not null,
  last_number integer not null,
  primary key (hostel_id, series, fiscal_year),
  constraint document_counters_series_valid check (series in ('invoice', 'receipt')),
  constraint document_counters_fiscal_year_format check (fiscal_year ~ '^\d{2}-\d{2}$'),
  constraint document_counters_positive check (last_number > 0)
);

comment on table public.document_counters is
  'Last invoice and receipt number given per hostel per financial year. Written only by triggers.';

alter table public.document_counters enable row level security;
revoke all on public.document_counters from authenticated, anon;

-- '26-27' for any day from 1 April 2026 to 31 March 2027.
create or replace function private.fiscal_year(p_day date)
returns text
language sql
immutable
set search_path = ''
as $$
  select to_char(y, 'FM00') || '-' || to_char((y + 1) % 100, 'FM00')
    from (select (extract(year from p_day)::integer - case when extract(month from p_day) < 4 then 1 else 0 end) % 100 as y) s;
$$;

create or replace function private.next_document_number(p_hostel_id uuid, p_series text, p_day date)
returns text
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  fy text := private.fiscal_year(p_day);
  n integer;
begin
  insert into public.document_counters as c (hostel_id, series, fiscal_year, last_number)
  values (p_hostel_id, p_series, fy, 1)
  on conflict (hostel_id, series, fiscal_year)
    do update set last_number = c.last_number + 1
  returning c.last_number into n;
  return case p_series when 'invoice' then 'INV' else 'RCT' end
         || '/' || fy || '/' || lpad(n::text, greatest(5, length(n::text)), '0');
end;
$$;

revoke all on function private.next_document_number(uuid, text, date) from public, anon, authenticated;
revoke all on function private.fiscal_year(date) from public, anon;
grant execute on function private.fiscal_year(date) to authenticated;

alter table public.invoices add column invoice_number text;
alter table public.payments add column receipt_number text;

comment on column public.invoices.invoice_number is
  'INV/<financial year>/<sequence>, per hostel. Given at insert; never changes.';
comment on column public.payments.receipt_number is
  'RCT/<financial year>/<sequence>, per hostel. Given at insert; never changes.';

-- Existing documents are numbered in the order they were created. Issued
-- invoices cannot otherwise be updated, so their guard is paused meanwhile.
alter table public.invoices disable trigger invoices_guard_update;
do $$
declare
  r record;
begin
  for r in
    select i.id, i.hostel_id, (i.created_at at time zone 'Asia/Kolkata')::date as day
      from public.invoices i order by i.created_at, i.id
  loop
    update public.invoices
       set invoice_number = private.next_document_number(r.hostel_id, 'invoice', r.day)
     where id = r.id;
  end loop;
end;
$$;
alter table public.invoices enable trigger invoices_guard_update;

-- Payments are append-only; its update trigger only allows voiding, so it
-- is paused while the existing receipts are numbered.
alter table public.payments disable trigger payments_guard_update;
do $$
declare
  r record;
begin
  for r in
    select p.id, p.hostel_id, (p.created_at at time zone 'Asia/Kolkata')::date as day
      from public.payments p order by p.created_at, p.id
  loop
    update public.payments
       set receipt_number = private.next_document_number(r.hostel_id, 'receipt', r.day)
     where id = r.id;
  end loop;
end;
$$;
alter table public.payments enable trigger payments_guard_update;

-- The default is only a placeholder so inserts need not send a number; the
-- triggers below always replace it.
alter table public.invoices
  alter column invoice_number set not null,
  alter column invoice_number set default '',
  add constraint invoices_number_key unique (hostel_id, invoice_number),
  add constraint invoices_number_length check (char_length(invoice_number) <= 16);
alter table public.payments
  alter column receipt_number set not null,
  alter column receipt_number set default '',
  add constraint payments_receipt_number_key unique (hostel_id, receipt_number),
  add constraint payments_receipt_number_length check (char_length(receipt_number) <= 16);

-- Every new invoice and payment takes the next number, whatever was sent.
create or replace function private.invoices_number()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  new.invoice_number := private.next_document_number(new.hostel_id, 'invoice', private.today_ist());
  return new;
end;
$$;

create or replace function private.payments_number()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  new.receipt_number := private.next_document_number(new.hostel_id, 'receipt', private.today_ist());
  return new;
end;
$$;

-- Named to run after the guard triggers (alphabetical order), so a refused
-- payment never uses up a number.
create trigger invoices_zz_number
  before insert on public.invoices
  for each row execute function private.invoices_number();

create trigger payments_zz_number
  before insert on public.payments
  for each row execute function private.payments_number();

-- The fee views gain the number, appended so existing columns keep their places.
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
  i.kind,
  i.late_fee_for,
  i.invoice_number
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
