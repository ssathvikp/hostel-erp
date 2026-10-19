-- Deposits per sharing type (ClickUp E13-T4), advances and credit balance
-- (E13-T7), and cheque payments with clearance (E13-T11).
--
-- Rules:
-- - Each hostel may set a security deposit per sharing type. It is offered
--   when a resident is given a bed; the amount can be changed per resident.
-- - Credit is an append-only ledger per resident: an advance (money in,
--   with a mode), credit applied to an invoice (as a payment of mode
--   'credit'), or a refund (money out). Held credit is derived and never
--   negative. Entries for one resident are serialised on an advisory lock.
-- - Paying more than an invoice's balance records the balance as a payment
--   and the rest as an advance, in one transaction.
-- - Credit is applied automatically when an invoice is issued.
-- - A cheque is a payment of mode 'cheque', recorded as pending. Until it
--   is marked cleared it does not count as paid (but it does count towards
--   what may still be collected, so nobody collects twice). A bounced
--   cheque is voided with a reason, optionally with a bounce charge.

-- ---------------------------------------------------------------------------
-- Deposit per sharing type
-- ---------------------------------------------------------------------------
create table public.deposit_rates (
  hostel_id uuid not null references public.hostels (id) on delete cascade,
  sharing_type text not null,
  amount integer not null,
  updated_at timestamptz not null default now(),
  primary key (hostel_id, sharing_type),
  constraint deposit_rates_sharing_type_valid
    check (sharing_type in ('single', 'double', 'triple', 'four_plus')),
  constraint deposit_rates_amount_range check (amount between 100 and 100000000)
);

comment on table public.deposit_rates is
  'The usual security deposit per sharing type, offered when a resident is given a bed.';

alter table public.deposit_rates enable row level security;
revoke all on public.deposit_rates from authenticated, anon;
grant select, delete on public.deposit_rates to authenticated;
grant insert (hostel_id, sharing_type, amount) on public.deposit_rates to authenticated;
grant update (amount) on public.deposit_rates to authenticated;

create policy "deposit rates: members read" on public.deposit_rates for select to authenticated
  using (hostel_id in (select private.user_hostel_ids()));
create policy "deposit rates: owners add" on public.deposit_rates for insert to authenticated
  with check (hostel_id in (select private.user_owned_hostel_ids()));
create policy "deposit rates: owners change" on public.deposit_rates for update to authenticated
  using (hostel_id in (select private.user_owned_hostel_ids()))
  with check (hostel_id in (select private.user_owned_hostel_ids()));
create policy "deposit rates: owners remove" on public.deposit_rates for delete to authenticated
  using (hostel_id in (select private.user_owned_hostel_ids()));

-- ---------------------------------------------------------------------------
-- Cheques: pending until cleared
-- ---------------------------------------------------------------------------
alter table public.payments
  add column cheque_number text,
  add column cheque_bank text,
  add column cleared_at timestamptz,
  add column cleared_by uuid references public.profiles (id) on delete set null;

comment on column public.payments.cleared_at is
  'When the money reached the hostel. Set at once for every mode but cheque; a cheque counts as paid only from then.';

-- Every payment so far was money in hand.
alter table public.payments disable trigger payments_guard_update;
update public.payments set cleared_at = created_at where cleared_at is null;
alter table public.payments enable trigger payments_guard_update;

alter table public.payments drop constraint payments_mode_valid;
alter table public.payments
  add constraint payments_mode_valid
    check (mode in ('cash', 'upi', 'bank_transfer', 'card', 'cheque', 'credit')),
  add constraint payments_cheque_details check ((mode = 'cheque') = (cheque_number is not null)),
  add constraint payments_cheque_number_length check (char_length(btrim(cheque_number)) between 1 and 20),
  add constraint payments_cheque_bank_length check (char_length(btrim(cheque_bank)) between 1 and 100),
  add constraint payments_cleared_unless_cheque check (mode = 'cheque' or cleared_at is not null);

grant insert (cheque_number, cheque_bank) on public.payments to authenticated;

-- Runs after payments_guard_insert (alphabetical), before the number.
create or replace function private.payments_set_cleared()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if new.mode = 'credit' and current_user = 'authenticated' then
    raise exception 'Credit is applied by the app, not recorded by hand'
      using errcode = 'P0001', hint = 'credit_payment_manual';
  end if;
  new.cleared_at := case when new.mode = 'cheque' then null else now() end;
  new.cleared_by := null;
  return new;
end;
$$;

create trigger payments_set_cleared
  before insert on public.payments
  for each row execute function private.payments_set_cleared();

-- Members mark a cheque cleared (staff deposit them). Payments otherwise
-- change only when an owner voids them, so this is a function rather than
-- an update right.
create or replace function private.clear_cheque(p_payment_id uuid)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_hostel uuid;
begin
  select p.hostel_id into v_hostel from public.payments p where p.id = p_payment_id;
  if v_hostel is null or v_hostel not in (select private.user_hostel_ids()) then
    raise exception 'Payment not found' using errcode = 'P0001', hint = 'payment_not_found';
  end if;
  update public.payments set cleared_at = now() where id = p_payment_id;
end;
$$;

create or replace function public.clear_cheque(p_payment_id uuid)
returns void
language sql
volatile
security invoker
set search_path = ''
as $$ select private.clear_cheque(p_payment_id); $$;

revoke all on function private.clear_cheque(uuid) from public, anon;
revoke all on function public.clear_cheque(uuid) from public, anon;
grant execute on function private.clear_cheque(uuid) to authenticated;
grant execute on function public.clear_cheque(uuid) to authenticated;

-- Unchanged from 20261011090000 apart from clearing a cheque: a payment
-- changes once more, when a pending cheque is marked cleared.
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
  if new.void_reason is null and old.cleared_at is null and new.cleared_at is not null then
    if old.mode <> 'cheque' then
      raise exception 'Only a cheque is cleared' using errcode = 'P0001', hint = 'payment_immutable';
    end if;
    if old.voided_at is null and old.cleared_at is null then
      new.cleared_at := now();
      new.cleared_by := (select auth.uid());
      return new;
    end if;
  end if;
  if new.void_reason is null then
    raise exception 'Payments cannot be edited; void it and record it again'
      using errcode = 'P0001', hint = 'payment_immutable';
  end if;
  if old.cleared_at is distinct from new.cleared_at then
    raise exception 'Void a payment or clear a cheque, not both'
      using errcode = 'P0001', hint = 'payment_immutable';
  end if;
  new.voided_at := now();
  new.voided_by := (select auth.uid());
  return new;
end;
$$;

-- The fee views: paid counts cleared money only; pending cheques are shown
-- beside it. Appended column, so existing columns keep their places.
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
  i.invoice_number,
  -- Cheques received but not yet cleared: not paid, but not to be collected again.
  coalesce(p.pending, 0)::integer as pending_cheques
from public.invoices i
join public.residents r on r.id = i.resident_id
left join public.allocations a on a.id = i.allocation_id
left join public.rooms rm on rm.id = a.room_id
left join public.beds b on b.id = a.bed_id
left join lateral (
  select sum(pm.amount) filter (where pm.cleared_at is not null) as paid,
         sum(pm.amount) filter (where pm.cleared_at is null) as pending
    from public.payments pm
   where pm.invoice_id = i.id and pm.voided_at is null
) p on true;

-- Unchanged from 20261011120000 except that a pending cheque is not yet collected.
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
               where p.hostel_id = p_hostel_id and p.voided_at is null and p.cleared_at is not null
                 and p.paid_at between p_from and p_to), 0)::bigint,
    (select count(*) from public.payments p
      where p.hostel_id = p_hostel_id and p.voided_at is null and p.cleared_at is not null
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

-- Unchanged from 20261019090000 except that a pending cheque is not yet collected.
create or replace function private.admin_hostels()
returns table (
  id uuid,
  name text,
  city text,
  status text,
  plan text,
  trial_ends_at date,
  suspension_reason text,
  created_at timestamptz,
  owner_name text,
  owner_email text,
  staff integer,
  rooms integer,
  beds integer,
  occupied_beds integer,
  residents integer,
  invoices_this_month integer,
  collected_this_month bigint,
  last_activity_at timestamptz,
  rates_set boolean,
  allocations_ever integer,
  first_invoice_on date,
  first_payment_on date,
  owner_hostels integer,
  referred_by_name text,
  referrals integer,
  paying_referrals integer
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  month_start date := date_trunc('month', private.today_ist())::date;
begin
  perform private.require_platform_admin();
  return query
  select
    h.id,
    h.name,
    h.city,
    h.status,
    h.plan,
    h.trial_ends_at,
    h.suspension_reason,
    h.created_at,
    op.full_name,
    u.email::text,
    (select count(*)::integer from public.profiles s
      where s.hostel_id = h.id and s.role = 'staff' and s.deactivated_at is null),
    (select count(*)::integer from public.rooms r where r.hostel_id = h.id and r.status = 'active'),
    (select count(*)::integer from public.beds b
      join public.rooms r on r.id = b.room_id
      where r.hostel_id = h.id and r.status = 'active' and b.archived_at is null),
    (select count(*)::integer from public.allocations a
      where a.hostel_id = h.id and a.start_date <= private.today_ist()
        and (a.end_date is null or a.end_date >= private.today_ist())),
    (select count(*)::integer from public.residents re
      where re.hostel_id = h.id and re.status in ('active', 'notice')),
    (select count(*)::integer from public.invoices i
      where i.hostel_id = h.id and i.status = 'issued' and i.kind = 'rent'
        and i.period_month = month_start),
    (select coalesce(sum(pm.amount), 0)::bigint from public.payments pm
      where pm.hostel_id = h.id and pm.voided_at is null and pm.cleared_at is not null and pm.paid_at >= month_start),
    private.hostel_last_activity(h.id),
    exists (select 1 from public.fee_structures f where f.hostel_id = h.id),
    (select count(*)::integer from public.allocations a where a.hostel_id = h.id),
    (select min(i.created_at at time zone 'Asia/Kolkata')::date from public.invoices i
      where i.hostel_id = h.id and i.kind = 'rent'),
    (select min(pm.created_at at time zone 'Asia/Kolkata')::date from public.payments pm
      where pm.hostel_id = h.id),
    (select count(*)::integer from public.hostels oh
      where oh.owner_id = h.owner_id and oh.status <> 'draft'),
    rp.full_name,
    (select count(*)::integer from public.profiles p where p.referred_by = h.owner_id),
    (select count(*)::integer from public.profiles p
      where p.referred_by = h.owner_id
        and exists (select 1 from public.hostels ph where ph.owner_id = p.id and ph.plan = 'paid'))
  from public.hostels h
  join public.profiles op on op.id = h.owner_id
  join auth.users u on u.id = h.owner_id
  left join public.profiles rp on rp.id = op.referred_by
  order by h.created_at desc;
end;
$$;

-- Unchanged from 20261019090000 except that a pending cheque is not yet collected.
create or replace function private.admin_metrics()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  today date := private.today_ist();
  this_week date := date_trunc('week', private.today_ist())::date;
  this_month date := date_trunc('month', private.today_ist())::date;
  month_ago timestamptz := now() - interval '30 days';
  result jsonb;
begin
  perform private.require_platform_admin();

  with
  owners as (
    select p.id, (p.created_at at time zone 'Asia/Kolkata')::date as signed_up_on
      from public.profiles p where p.role = 'owner'
  ),
  hostel_rows as (
    select h.id, h.status, h.plan, h.trial_ends_at, private.hostel_last_activity(h.id) as last_activity
      from public.hostels h
  ),
  -- Plan as it stood 30 days ago: the last event at or before then.
  plan_then as (
    select distinct on (e.hostel_id) e.hostel_id, e.plan
      from public.plan_events e
     where e.changed_at <= month_ago
     order by e.hostel_id, e.changed_at desc, e.id desc
  ),
  ever_paid as (
    select distinct e.hostel_id from public.plan_events e where e.plan = 'paid'
  )
  select jsonb_build_object(
    'trial_days', private.trial_days(),
    'signups_by_week', (
      select jsonb_agg(jsonb_build_object(
               'week_start', w.week_start,
               'owners', (select count(*) from owners o
                           where o.signed_up_on >= w.week_start and o.signed_up_on < w.week_start + 7))
             order by w.week_start)
        from (select (this_week - 7 * g)::date as week_start from generate_series(0, 7) g) w
    ),
    'owners', (select count(*) from owners),
    'owners_set_up', (select count(*) from owners o
                       where exists (select 1 from public.hostels h
                                      where h.owner_id = o.id and h.status <> 'draft')),
    'hostels', (select count(*) from hostel_rows where status <> 'draft'),
    'hostels_active_30_days', (select count(*) from hostel_rows
                                where status = 'active' and last_activity >= month_ago),
    'beds', (select count(*) from public.beds b
               join public.rooms r on r.id = b.room_id
               join public.hostels h on h.id = r.hostel_id
              where r.status = 'active' and b.archived_at is null and h.status <> 'draft'),
    'occupied_beds', (select count(*) from public.allocations a
                       where a.start_date <= today and (a.end_date is null or a.end_date >= today)),
    'residents', (select count(*) from public.residents re where re.status in ('active', 'notice')),
    'monthly', (
      select jsonb_agg(jsonb_build_object(
               'month', m.month,
               'invoices', (select count(*) from public.invoices i
                             where i.status = 'issued' and i.kind = 'rent' and i.period_month = m.month),
               'invoiced', (select coalesce(sum(i.amount), 0) from public.invoices i
                             where i.status = 'issued' and i.period_month = m.month),
               'payments', (select count(*) from public.payments pm
                             where pm.voided_at is null and pm.cleared_at is not null
                               and pm.paid_at >= m.month and pm.paid_at < (m.month + interval '1 month')::date),
               'collected', (select coalesce(sum(pm.amount), 0) from public.payments pm
                              where pm.voided_at is null and pm.cleared_at is not null
                                and pm.paid_at >= m.month and pm.paid_at < (m.month + interval '1 month')::date))
             order by m.month)
        from (select (this_month - make_interval(months => g))::date as month
                from generate_series(0, 5) g) m
    ),
    'plans', jsonb_build_object(
      'trial', (select count(*) from hostel_rows where status <> 'draft' and plan = 'trial'),
      'paid', (select count(*) from hostel_rows where status <> 'draft' and plan = 'paid'),
      'free', (select count(*) from hostel_rows where status <> 'draft' and plan = 'free')
    ),
    'trials_converted', (select count(*) from ever_paid),
    'trials_lapsed', (select count(*) from hostel_rows h
                       where h.status <> 'draft' and h.plan = 'trial' and h.trial_ends_at < today
                         and h.id not in (select hostel_id from ever_paid)),
    'paying_30_days_ago', (select count(*) from plan_then where plan = 'paid'),
    'left_paid_30_days', (select count(*) from plan_then t
                           join hostel_rows h on h.id = t.hostel_id
                          where t.plan = 'paid' and (h.plan <> 'paid' or h.status = 'suspended'))
  ) into result;

  return result;
end;
$$;

-- Unchanged from 20261019090000 except that rent counts as settled only
-- once a cheque for it has cleared.
create or replace function private.apply_late_fees(p_hostel_id uuid)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  today date := private.today_ist();
  v_mode text;
  v_amount integer;
  v_cap integer;
  v_grace integer;
  v_since date;
  v_applied integer;
  v_total bigint;
  v_waiting integer;
begin
  if p_hostel_id is null
     or p_hostel_id not in (select private.user_owned_hostel_ids()) then
    raise exception 'Only the hostel owner can charge late fees'
      using errcode = '42501', hint = 'not_owner';
  end if;
  select h.late_fee_mode, h.late_fee_amount, h.late_fee_cap, h.late_fee_grace_days, h.late_fee_since
    into v_mode, v_amount, v_cap, v_grace, v_since
    from public.hostels h where h.id = p_hostel_id;
  if v_mode = 'off' then
    raise exception 'Late fees are switched off for this hostel'
      using errcode = 'P0001', hint = 'late_fees_off';
  end if;
  -- One run at a time per hostel.
  perform pg_advisory_xact_lock(hashtextextended('late_fees:' || p_hostel_id::text, 0));

  with candidates as (
    select
      i.id,
      i.resident_id,
      i.allocation_id,
      i.period_month,
      i.due_date,
      (
        select min(s.paid_at)
          from (
            select pm.paid_at,
                   sum(pm.amount) over (order by pm.paid_at, pm.created_at, pm.id) as running
              from public.payments pm
             where pm.invoice_id = i.id and pm.voided_at is null and pm.cleared_at is not null
          ) s
         where s.running >= i.amount
      ) as settled_on
    from public.invoices i
    join public.residents re on re.id = i.resident_id and re.erased_at is null
    where i.hostel_id = p_hostel_id
      and i.kind = 'rent'
      and i.status = 'issued'
      and i.due_date >= v_since
      and i.due_date + v_grace < today
      and not exists (select 1 from public.invoices f where f.late_fee_for = i.id)
  ),
  assessed as (
    select c.*, coalesce(c.settled_on, today) - (c.due_date + v_grace) as days_late
      from candidates c
  ),
  priced as (
    select
      a.*,
      case
        when v_mode = 'fixed' then v_amount
        else least(v_cap::bigint, a.days_late::bigint * v_amount)::integer
      end as fee,
      v_mode = 'fixed' or a.settled_on is not null or a.days_late::bigint * v_amount >= v_cap
        as final
    from assessed a
    where a.days_late > 0
  ),
  inserted as (
    insert into public.invoices
      (hostel_id, resident_id, allocation_id, period_month, amount, due_date, breakdown,
       kind, late_fee_for)
    select
      p_hostel_id, p.resident_id, p.allocation_id, p.period_month, p.fee, today,
      jsonb_build_array(jsonb_build_object(
        'type', 'late_fee',
        'invoice_id', p.id,
        'rule', v_mode,
        'rate', v_amount,
        'cap', v_cap,
        'grace_days', v_grace,
        'rent_due_date', p.due_date,
        'settled_on', p.settled_on,
        'days_late', p.days_late
      )),
      'late_fee', p.id
    from priced p
    where p.final
    on conflict (late_fee_for) where late_fee_for is not null do nothing
    returning amount
  )
  select
    (select count(*) from inserted),
    (select coalesce(sum(amount), 0) from inserted),
    (select count(*) from priced where not final)
  into v_applied, v_total, v_waiting;

  return jsonb_build_object('applied', v_applied, 'total_amount', v_total, 'waiting', v_waiting);
end;
$$;

-- ---------------------------------------------------------------------------
-- Advances and credit balance
-- ---------------------------------------------------------------------------
create table public.resident_credit_entries (
  id uuid primary key default gen_random_uuid(),
  hostel_id uuid not null,
  resident_id uuid not null,
  kind text not null,
  amount integer not null,
  entry_date date not null,
  -- How money moved: advances and refunds only.
  mode text,
  reference text,
  -- Credit applied to an invoice, through a payment of mode 'credit'.
  invoice_id uuid,
  payment_id uuid,
  recorded_by uuid not null default auth.uid() references public.profiles (id),
  created_at timestamptz not null default now(),
  voided_at timestamptz,
  void_reason text,
  voided_by uuid references public.profiles (id) on delete set null,
  constraint resident_credit_entries_resident_fkey foreign key (hostel_id, resident_id)
    references public.residents (hostel_id, id),
  constraint resident_credit_entries_invoice_fkey foreign key (hostel_id, invoice_id)
    references public.invoices (hostel_id, id),
  constraint resident_credit_entries_payment_fkey foreign key (payment_id)
    references public.payments (id),
  constraint resident_credit_entries_kind_valid check (kind in ('advance', 'applied', 'refund')),
  constraint resident_credit_entries_amount_positive check (amount between 1 and 100000000),
  constraint resident_credit_entries_mode_valid check (mode in ('cash', 'upi', 'bank_transfer', 'card')),
  constraint resident_credit_entries_mode_by_kind check ((kind = 'applied') = (mode is null)),
  constraint resident_credit_entries_applied_link
    check ((kind = 'applied') = (payment_id is not null and invoice_id is not null)),
  constraint resident_credit_entries_reference_length check (char_length(btrim(reference)) between 1 and 100),
  constraint resident_credit_entries_void_has_reason check ((voided_at is null) = (void_reason is null)),
  constraint resident_credit_entries_void_reason_length
    check (char_length(btrim(void_reason)) between 1 and 500)
);

comment on table public.resident_credit_entries is
  'Append-only advance credit per resident: advances in, credit applied to invoices, refunds out. Held credit is derived.';

create index resident_credit_entries_resident_idx on public.resident_credit_entries (resident_id)
  where voided_at is null;
create unique index resident_credit_entries_payment_key on public.resident_credit_entries (payment_id)
  where payment_id is not null;

create or replace function private.credit_held(p_resident_id uuid)
returns integer
language sql
stable
security invoker
set search_path = ''
as $$
  select coalesce(sum(case when e.kind = 'advance' then e.amount else -e.amount end), 0)::integer
    from public.resident_credit_entries e
   where e.resident_id = p_resident_id and e.voided_at is null;
$$;

grant execute on function private.credit_held(uuid) to authenticated;

create view public.credit_balances with (security_invoker = true) as
select
  e.hostel_id,
  e.resident_id,
  sum(case when e.kind = 'advance' then e.amount else -e.amount end)::integer as held
from public.resident_credit_entries e
where e.voided_at is null
group by e.hostel_id, e.resident_id;

-- Entries for one resident are serialised; refunds and applications never
-- take more than is held; applications are made only by the app.
create or replace function private.resident_credit_entries_guard_insert()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  perform pg_advisory_xact_lock(hashtextextended('credit:' || new.resident_id::text, 0));
  if new.kind = 'applied' and current_user = 'authenticated' then
    raise exception 'Credit is applied by the app' using errcode = 'P0001', hint = 'credit_payment_manual';
  end if;
  if new.kind = 'advance' and exists (
    select 1 from public.residents r where r.id = new.resident_id and r.erased_at is not null
  ) then
    raise exception 'This resident''s details were erased' using errcode = 'P0001', hint = 'resident_erased';
  end if;
  if new.kind <> 'advance' and new.amount > private.credit_held(new.resident_id) then
    raise exception 'Only % is held as credit', '₹' || to_char(private.credit_held(new.resident_id) / 100.0, 'FM999999990.00')
      using errcode = 'P0001', hint = 'credit_insufficient';
  end if;
  if current_user = 'authenticated' and new.entry_date > private.today_ist() then
    raise exception 'The date cannot be in the future' using errcode = 'P0001', hint = 'payment_future';
  end if;
  new.voided_at := null;
  new.void_reason := null;
  new.voided_by := null;
  return new;
end;
$$;

create trigger resident_credit_entries_guard_insert
  before insert on public.resident_credit_entries
  for each row execute function private.resident_credit_entries_guard_insert();

-- An entry changes once: when voided. An advance cannot be voided if that
-- would leave less than nothing held; an application is voided only with
-- its payment.
create or replace function private.resident_credit_entries_guard_update()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  perform pg_advisory_xact_lock(hashtextextended('credit:' || old.resident_id::text, 0));
  if old.voided_at is not null then
    raise exception 'This entry is already void' using errcode = 'P0001', hint = 'credit_void';
  end if;
  if new.void_reason is null then
    raise exception 'Credit entries cannot be edited; void it and record it again'
      using errcode = 'P0001', hint = 'credit_immutable';
  end if;
  if old.kind = 'applied' and current_user = 'authenticated' then
    raise exception 'Void the credit payment on the invoice instead'
      using errcode = 'P0001', hint = 'credit_applied_void';
  end if;
  if old.kind = 'advance' and private.credit_held(old.resident_id) - old.amount < 0 then
    raise exception 'This advance has already been used'
      using errcode = 'P0001', hint = 'credit_used';
  end if;
  new.voided_at := now();
  new.voided_by := (select auth.uid());
  return new;
end;
$$;

create trigger resident_credit_entries_guard_update
  before update on public.resident_credit_entries
  for each row execute function private.resident_credit_entries_guard_update();

-- Voiding a credit payment gives the credit back.
create or replace function private.payments_void_credit()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.voided_at is not null and old.voided_at is null and new.mode = 'credit' then
    update public.resident_credit_entries
       set void_reason = 'Payment voided: ' || new.void_reason
     where payment_id = new.id and voided_at is null;
  end if;
  return null;
end;
$$;

create trigger payments_void_credit
  after update of void_reason on public.payments
  for each row execute function private.payments_void_credit();

-- Applies a resident's held credit to an invoice, up to what is still due.
-- Returns what was applied. Callers check access first.
create or replace function private.apply_credit_to_invoice(p_invoice_id uuid, p_recorded_by uuid)
returns integer
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  inv record;
  v_held integer;
  v_due integer;
  v_amount integer;
  v_payment uuid;
begin
  select i.id, i.hostel_id, i.resident_id, i.amount, i.status into inv
    from public.invoices i where i.id = p_invoice_id;
  if not found or inv.status <> 'issued' then
    return 0;
  end if;
  perform pg_advisory_xact_lock(hashtextextended('credit:' || inv.resident_id::text, 0));
  perform pg_advisory_xact_lock(hashtextextended('payments:' || inv.id::text, 0));
  v_held := private.credit_held(inv.resident_id);
  select inv.amount - coalesce(sum(p.amount), 0) into v_due
    from public.payments p where p.invoice_id = inv.id and p.voided_at is null;
  v_amount := least(v_held, v_due);
  if v_amount <= 0 then
    return 0;
  end if;
  insert into public.payments (hostel_id, invoice_id, amount, paid_at, mode, reference, recorded_by)
  values (inv.hostel_id, inv.id, v_amount, private.today_ist(), 'credit', 'Advance credit', p_recorded_by)
  returning id into v_payment;
  insert into public.resident_credit_entries
    (hostel_id, resident_id, kind, amount, entry_date, invoice_id, payment_id, recorded_by)
  values (inv.hostel_id, inv.resident_id, 'applied', v_amount, private.today_ist(), inv.id, v_payment, p_recorded_by);
  return v_amount;
end;
$$;

revoke all on function private.apply_credit_to_invoice(uuid, uuid) from public, anon, authenticated;

-- Credit is applied as soon as an invoice is issued.
create or replace function private.invoices_apply_credit()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_recorder uuid;
begin
  if private.credit_held(new.resident_id) <= 0 then
    return null;
  end if;
  v_recorder := coalesce(
    (select auth.uid()),
    new.created_by,
    (select h.owner_id from public.hostels h where h.id = new.hostel_id)
  );
  perform private.apply_credit_to_invoice(new.id, v_recorder);
  return null;
end;
$$;

create trigger invoices_apply_credit
  after insert on public.invoices
  for each row execute function private.invoices_apply_credit();

-- Records money received against an invoice. Anything beyond what is due
-- becomes advance credit, in the same transaction. A cheque cannot overpay:
-- credit is money in hand. SECURITY INVOKER: members only, by the policies.
create or replace function public.record_payment(
  p_invoice_id uuid,
  p_amount integer,
  p_paid_at date,
  p_mode text,
  p_reference text default null,
  p_cheque_number text default null,
  p_cheque_bank text default null
)
returns jsonb
language plpgsql
volatile
security invoker
set search_path = ''
as $$
declare
  inv record;
  v_due integer;
  v_paid integer;
  v_extra integer;
  v_payment uuid;
begin
  select i.id, i.hostel_id, i.resident_id, i.amount, i.status into inv
    from public.invoices i where i.id = p_invoice_id;
  if not found then
    raise exception 'Invoice not found' using errcode = 'P0001', hint = 'invoice_not_found';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('payments:' || inv.id::text, 0));
  select inv.amount - coalesce(sum(p.amount), 0) into v_due
    from public.payments p where p.invoice_id = inv.id and p.voided_at is null;
  v_paid := least(p_amount, greatest(v_due, 0));
  v_extra := p_amount - v_paid;
  if v_extra > 0 and p_mode = 'cheque' then
    raise exception 'A cheque cannot be more than is due (%)', '₹' || to_char(v_due / 100.0, 'FM999999990.00')
      using errcode = 'P0001', hint = 'overpayment';
  end if;
  if v_paid > 0 then
    insert into public.payments
      (hostel_id, invoice_id, amount, paid_at, mode, reference, cheque_number, cheque_bank)
    values (inv.hostel_id, inv.id, v_paid, p_paid_at, p_mode, nullif(btrim(p_reference), ''),
            nullif(btrim(p_cheque_number), ''), nullif(btrim(p_cheque_bank), ''))
    returning id into v_payment;
  end if;
  if v_extra > 0 then
    insert into public.resident_credit_entries
      (hostel_id, resident_id, kind, amount, entry_date, mode, reference)
    values (inv.hostel_id, inv.resident_id, 'advance', v_extra, p_paid_at, p_mode,
            nullif(btrim(p_reference), ''));
  end if;
  return jsonb_build_object('payment_id', v_payment, 'paid', v_paid, 'credit', v_extra);
end;
$$;

revoke all on function public.record_payment(uuid, integer, date, text, text, text, text) from public, anon;
grant execute on function public.record_payment(uuid, integer, date, text, text, text, text) to authenticated;

-- Applies held credit to a resident's open invoices, oldest first. For
-- credit recorded after the invoices were issued.
create or replace function private.apply_credit(p_resident_id uuid)
returns integer
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_hostel uuid;
  inv record;
  total integer := 0;
begin
  select r.hostel_id into v_hostel from public.residents r where r.id = p_resident_id;
  if v_hostel is null or v_hostel not in (select private.user_hostel_ids()) then
    raise exception 'Resident not found' using errcode = 'P0001', hint = 'resident_not_found';
  end if;
  for inv in
    select b.id from public.invoice_balances b
     where b.resident_id = p_resident_id and b.status = 'issued' and b.balance - b.pending_cheques > 0
     order by b.due_date, b.period_month
  loop
    total := total + private.apply_credit_to_invoice(inv.id, (select auth.uid()));
  end loop;
  return total;
end;
$$;

create or replace function public.apply_credit(p_resident_id uuid)
returns integer
language sql
volatile
security invoker
set search_path = ''
as $$ select private.apply_credit(p_resident_id); $$;

revoke all on function private.apply_credit(uuid) from public, anon;
revoke all on function public.apply_credit(uuid) from public, anon;
grant execute on function private.apply_credit(uuid) to authenticated;
grant execute on function public.apply_credit(uuid) to authenticated;

alter table public.resident_credit_entries enable row level security;
revoke all on public.resident_credit_entries from authenticated, anon;
grant select on public.resident_credit_entries to authenticated;
grant insert (hostel_id, resident_id, kind, amount, entry_date, mode, reference)
  on public.resident_credit_entries to authenticated;
grant update (void_reason) on public.resident_credit_entries to authenticated;
revoke all on public.credit_balances from authenticated, anon;
grant select on public.credit_balances to authenticated;

-- Members record advances (staff collect money); only owners refund or void.
create policy "credit: members read" on public.resident_credit_entries for select to authenticated
  using (hostel_id in (select private.user_hostel_ids()));
create policy "credit: members record advances" on public.resident_credit_entries for insert to authenticated
  with check (
    hostel_id in (select private.user_hostel_ids())
    and recorded_by = (select auth.uid())
    and (kind = 'advance' or hostel_id in (select private.user_owned_hostel_ids()))
  );
create policy "credit: owners void" on public.resident_credit_entries for update to authenticated
  using (hostel_id in (select private.user_owned_hostel_ids()))
  with check (hostel_id in (select private.user_owned_hostel_ids()));

-- Erasing waits until credit is refunded or used.
create or replace function private.residents_guard_credit()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if new.erased_at is not null and old.erased_at is null and private.credit_held(new.id) > 0 then
    raise exception 'This resident has advance credit held'
      using errcode = 'P0001', hint = 'erase_credit_held';
  end if;
  return new;
end;
$$;

create trigger residents_guard_credit
  before update of erased_at on public.residents
  for each row execute function private.residents_guard_credit();
