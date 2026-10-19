-- Growth features from the backlog (ClickUp E13-T6 late fees, E10 platform
-- metrics; plan items E14-T3, E14-T12, E14-T13, E15-T1, E15-T2, E15-T4).
--
-- 1. Late fees: a per-hostel rule, applied as separate late-fee invoices,
--    once per rent invoice, waived by voiding with a reason.
-- 2. Trial length: one platform setting instead of a hard-coded 90 days.
-- 3. Plan history: every plan change is logged, for trial conversion and
--    churn figures.
-- 4. Owner referral codes.
-- 5. What empty beds cost a hostel each month.
-- 6. Admin: activation, referral and usage columns per hostel, and
--    platform-wide metrics with no customer names.
--
-- Earlier migrations are not edited.

-- ---------------------------------------------------------------------------
-- 1. Late fees
-- ---------------------------------------------------------------------------
-- The rule lives on the hostel. late_fee_since is the day the rule was
-- switched on: only rent due on or after it can attract a fee, so turning
-- the rule on never back-charges months that were late before it existed.
alter table public.hostels
  add column late_fee_mode text not null default 'off',
  add column late_fee_amount integer,
  add column late_fee_cap integer,
  add column late_fee_grace_days integer not null default 3,
  add column late_fee_since date,
  add constraint hostels_late_fee_mode_valid check (late_fee_mode in ('off', 'fixed', 'per_day')),
  -- ₹1 to ₹1,00,000, in paise. The explicit not-null tests matter: a check
  -- that evaluates to null passes.
  add constraint hostels_late_fee_amount_range
    check (late_fee_mode = 'off'
           or (late_fee_amount is not null and late_fee_amount between 100 and 10000000)),
  add constraint hostels_late_fee_cap_range
    check (late_fee_mode <> 'per_day'
           or (late_fee_cap is not null and late_fee_cap between late_fee_amount and 10000000)),
  add constraint hostels_late_fee_grace_range check (late_fee_grace_days between 0 and 28),
  add constraint hostels_late_fee_since_set check (late_fee_mode = 'off' or late_fee_since is not null);

comment on column public.hostels.late_fee_mode is
  'off, fixed (one amount per late invoice) or per_day (amount per day late, up to late_fee_cap).';
comment on column public.hostels.late_fee_amount is 'Fixed fee, or fee per day, in paise.';
comment on column public.hostels.late_fee_cap is 'Most a per-day fee can reach for one invoice, in paise.';
comment on column public.hostels.late_fee_grace_days is 'Days after the due date before rent counts as late.';
comment on column public.hostels.late_fee_since is
  'India date the rule was switched on. Only rent due on or after it can be charged a late fee. Set by trigger.';

grant update (late_fee_mode, late_fee_amount, late_fee_cap, late_fee_grace_days)
  on public.hostels to authenticated;

-- Keeps the rule tidy and stamps late_fee_since. Users cannot write it.
create or replace function private.hostels_late_fee_rule()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if new.late_fee_mode = 'off' then
    new.late_fee_amount := null;
    new.late_fee_cap := null;
    new.late_fee_since := null;
    return new;
  end if;
  if new.late_fee_mode <> 'per_day' then
    new.late_fee_cap := null;
  end if;
  -- Signed-in users never choose the date. The service role (fixtures,
  -- support scripts) may set it explicitly.
  if current_user = 'authenticated' or new.late_fee_since is null then
    if tg_op = 'INSERT' or old.late_fee_mode = 'off' then
      new.late_fee_since := private.today_ist();
    else
      new.late_fee_since := coalesce(old.late_fee_since, private.today_ist());
    end if;
  end if;
  return new;
end;
$$;

create trigger hostels_late_fee_rule
  before insert or update of late_fee_mode, late_fee_amount, late_fee_cap, late_fee_since
  on public.hostels
  for each row execute function private.hostels_late_fee_rule();

-- A late fee is its own invoice, so the rent invoice never changes and the
-- existing payment, balance and void rules all apply to it unchanged.
alter table public.invoices
  add column kind text not null default 'rent',
  add column late_fee_for uuid,
  add constraint invoices_kind_valid check (kind in ('rent', 'late_fee')),
  add constraint invoices_late_fee_has_source check ((kind = 'late_fee') = (late_fee_for is not null)),
  add constraint invoices_late_fee_source_fkey foreign key (hostel_id, late_fee_for)
    references public.invoices (hostel_id, id);

comment on column public.invoices.kind is 'rent (monthly, from generate_invoices) or late_fee.';
comment on column public.invoices.late_fee_for is 'For a late fee: the rent invoice that was paid late.';

-- Rent is due within its month; a late fee is due on the day it is charged.
alter table public.invoices drop constraint invoices_due_in_month;
alter table public.invoices add constraint invoices_due_in_month check (
  case
    when kind = 'rent'
      then due_date between period_month and (period_month + interval '1 month - 1 day')::date
    else due_date >= period_month
  end
);

-- One issued rent invoice per resident per month, as before; late fees sit
-- beside it. At most one late fee per rent invoice, ever: a waived (void)
-- fee is never charged again.
drop index public.invoices_one_issued_per_month;
create unique index invoices_one_issued_per_month
  on public.invoices (resident_id, period_month) where status = 'issued' and kind = 'rent';
create unique index invoices_one_late_fee_per_invoice
  on public.invoices (late_fee_for) where late_fee_for is not null;

-- Unchanged from 20261018090000 apart from the late-fee check: a rent
-- invoice cannot be voided while its late fee still stands.
create or replace function private.invoices_guard_update()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  perform pg_advisory_xact_lock(hashtextextended('payments:' || old.id::text, 0));
  if old.status = 'void' then
    raise exception 'This invoice is already void'
      using errcode = 'P0001', hint = 'invoice_void';
  end if;
  if new.status <> 'void' then
    raise exception 'Invoices cannot be edited; void it and generate the month again'
      using errcode = 'P0001', hint = 'invoice_immutable';
  end if;
  -- A fresh statement after the lock, so a payment committed while we
  -- waited is seen.
  if exists (
    select 1 from public.payments p where p.invoice_id = old.id and p.voided_at is null
  ) then
    raise exception 'This invoice has payments recorded against it'
      using errcode = 'P0001', hint = 'invoice_has_payments';
  end if;
  if exists (
    select 1 from public.invoices f where f.late_fee_for = old.id and f.status = 'issued'
  ) then
    raise exception 'This invoice has a late fee; waive the late fee first'
      using errcode = 'P0001', hint = 'invoice_has_late_fee';
  end if;
  new.voided_at := now();
  new.voided_by := (select auth.uid());
  return new;
end;
$$;

-- Unchanged from 20261018090000 except that only rent invoices count as
-- "already invoiced", matching the narrower unique index.
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
    -- Erased residents can no longer be contacted or billed.
    join public.residents re on re.id = a.resident_id and re.erased_at is null
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
           and i.kind = 'rent'
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
    on conflict (resident_id, period_month) where status = 'issued' and kind = 'rent' do nothing
    returning resident_id, amount
  )
  select jsonb_build_object(
    'period_month', month_start,
    'created', (select count(*) from inserted),
    'total_amount', (select coalesce(sum(amount), 0) from inserted),
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

-- The same view with kind and late_fee_for appended, so lists can label
-- late fees and link them to their rent invoice.
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
  i.late_fee_for
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

-- Charges late fees for the hostel's late rent. Idempotent: each rent
-- invoice gets at most one late fee, and a second run (or a concurrent one)
-- adds nothing new.
--
-- Lateness runs from the end of the grace period to the day the rent was
-- paid in full, or to today while it is still owed.
-- - fixed: charged as soon as rent is late.
-- - per_day: charged once the amount is final, that is when the rent has
--   been paid in full or the fee has reached the cap. Until then the
--   invoice is counted as waiting.
-- SECURITY DEFINER because users cannot write kind or late_fee_for; the
-- owner check comes first.
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
             where pm.invoice_id = i.id and pm.voided_at is null
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

create or replace function public.apply_late_fees(p_hostel_id uuid)
returns jsonb
language sql
volatile
security invoker
set search_path = ''
as $$ select private.apply_late_fees(p_hostel_id); $$;

revoke all on function private.apply_late_fees(uuid) from public, anon;
revoke all on function public.apply_late_fees(uuid) from public, anon;
grant execute on function private.apply_late_fees(uuid) to authenticated;
grant execute on function public.apply_late_fees(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 2. Trial length is a platform setting
-- ---------------------------------------------------------------------------
create table public.platform_settings (
  id boolean primary key default true,
  trial_days integer not null default 30,
  updated_at timestamptz not null default now(),
  updated_by uuid references public.profiles (id) on delete set null,
  constraint platform_settings_one_row check (id),
  constraint platform_settings_trial_days_range check (trial_days between 7 and 180)
);

comment on table public.platform_settings is
  'One row of platform-wide settings. Read and written only through admin functions.';

insert into public.platform_settings default values;

alter table public.platform_settings enable row level security;
revoke all on public.platform_settings from authenticated, anon;

create or replace function private.trial_days()
returns integer
language sql
stable
security definer
set search_path = ''
as $$ select coalesce((select s.trial_days from public.platform_settings s), 30); $$;

-- Callable by every role: the trial trigger runs as whoever inserts the
-- hostel (signed-in owners, the service role in scripts), and a number of
-- days is not sensitive.
grant execute on function private.trial_days() to public;

-- Unchanged from 20261018090000 except the trial length.
create or replace function private.hostels_start_trial()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if current_user = 'authenticated' then
    new.plan := 'trial';
    new.trial_ends_at := null;
    new.suspension_reason := null;
  end if;
  if new.plan = 'trial' and new.trial_ends_at is null then
    new.trial_ends_at := private.today_ist() + private.trial_days();
  end if;
  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- 3. Plan history
-- ---------------------------------------------------------------------------
create table public.plan_events (
  id bigint generated always as identity primary key,
  hostel_id uuid not null references public.hostels (id) on delete cascade,
  plan text not null,
  trial_ends_at date,
  changed_at timestamptz not null default now(),
  changed_by uuid references public.profiles (id) on delete set null
);

comment on table public.plan_events is
  'Append-only log of each hostel''s plan, written by trigger. Read through admin functions only.';

create index plan_events_hostel_idx on public.plan_events (hostel_id, changed_at);

alter table public.plan_events enable row level security;
revoke all on public.plan_events from authenticated, anon;

-- Existing hostels: their current plan, as of when they were created.
insert into public.plan_events (hostel_id, plan, trial_ends_at, changed_at)
select h.id, h.plan, h.trial_ends_at, h.created_at from public.hostels h;

create or replace function private.hostels_log_plan()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'INSERT'
     or new.plan is distinct from old.plan
     or new.trial_ends_at is distinct from old.trial_ends_at then
    insert into public.plan_events (hostel_id, plan, trial_ends_at, changed_by)
    values (new.id, new.plan, new.trial_ends_at, (select auth.uid()));
  end if;
  return null;
end;
$$;

create trigger hostels_log_plan
  after insert or update of plan, trial_ends_at on public.hostels
  for each row execute function private.hostels_log_plan();

-- ---------------------------------------------------------------------------
-- 4. Owner referral codes
-- ---------------------------------------------------------------------------
-- An owner shares a signup link carrying their code. The new account's
-- metadata names the code; the signup trigger looks it up and records who
-- referred them. Metadata is client-controlled, so the code is only ever
-- used to find an existing owner, never trusted for anything else.
alter table public.profiles
  add column referral_code text,
  add column referred_by uuid references public.profiles (id) on delete set null,
  add constraint profiles_referral_code_key unique (referral_code),
  add constraint profiles_referral_code_format check (referral_code ~ '^[A-HJ-NP-Z2-9]{8}$');

comment on column public.profiles.referral_code is
  'The owner''s code for referral links. Created on first use by my_referral_code().';
comment on column public.profiles.referred_by is 'The owner whose referral link this account signed up with.';

create index profiles_referred_by_idx on public.profiles (referred_by) where referred_by is not null;

-- Unchanged from 20261007132624 except the referral lookup.
create or replace function private.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  code text := upper(btrim(new.raw_user_meta_data ->> 'referral_code'));
begin
  insert into public.profiles (id, full_name, role, referred_by)
  values (
    new.id,
    coalesce(
      nullif(left(btrim(new.raw_user_meta_data ->> 'full_name'), 120), ''),
      split_part(new.email, '@', 1)
    ),
    'owner',
    (select p.id from public.profiles p
      where code ~ '^[A-HJ-NP-Z2-9]{8}$' and p.referral_code = code and p.role = 'owner')
  );
  return new;
end;
$$;

-- The caller's referral code, created the first time it is asked for.
-- Letters and digits that cannot be confused (no I, O, 0 or 1).
create or replace function private.my_referral_code()
returns text
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  alphabet constant text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  me uuid := (select auth.uid());
  code text;
begin
  select p.referral_code into code from public.profiles p where p.id = me and p.role = 'owner';
  if not found then
    raise exception 'Only hostel owners have a referral code'
      using errcode = '42501', hint = 'not_owner';
  end if;
  while code is null loop
    code := '';
    for i in 1..8 loop
      code := code || substr(alphabet, 1 + floor(random() * length(alphabet))::integer, 1);
    end loop;
    begin
      update public.profiles set referral_code = code where id = me;
    exception when unique_violation then
      code := null;
    end;
  end loop;
  return code;
end;
$$;

-- How the caller's referrals are doing. Counts only: an owner never sees
-- who signed up with their link.
create or replace function private.my_referrals()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'signed_up', count(*),
    'set_up', count(*) filter (where exists (
      select 1 from public.hostels h where h.owner_id = p.id and h.status = 'active')),
    'paying', count(*) filter (where exists (
      select 1 from public.hostels h where h.owner_id = p.id and h.plan = 'paid'))
  )
  from public.profiles p
  where p.referred_by = (select auth.uid());
$$;

create or replace function public.my_referral_code()
returns text
language sql
volatile
security invoker
set search_path = ''
as $$ select private.my_referral_code(); $$;

create or replace function public.my_referrals()
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$ select private.my_referrals(); $$;

revoke all on function private.my_referral_code() from public, anon;
revoke all on function private.my_referrals() from public, anon;
revoke all on function public.my_referral_code() from public, anon;
revoke all on function public.my_referrals() from public, anon;
grant execute on function private.my_referral_code() to authenticated;
grant execute on function private.my_referrals() to authenticated;
grant execute on function public.my_referral_code() to authenticated;
grant execute on function public.my_referrals() to authenticated;

-- ---------------------------------------------------------------------------
-- 5. What empty beds cost each month
-- ---------------------------------------------------------------------------
-- Vacant beds (available, nobody in them) at today's rate for their
-- sharing type. Beds whose type has no rate are counted separately so the
-- figure never quietly undercounts. SECURITY INVOKER: members only.
create or replace function public.vacancy_cost(p_hostel_id uuid)
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
  select jsonb_build_object(
    'vacant_beds', coalesce(sum(i.available_beds), 0)::integer,
    'monthly_value',
      coalesce(sum(i.available_beds::bigint * r.rate) filter (where r.rate is not null), 0)::bigint,
    'unpriced_beds', coalesce(sum(i.available_beds) filter (where r.rate is null), 0)::integer
  )
  from public.room_inventory i
  cross join lateral (
    select private.monthly_rate(p_hostel_id, i.sharing_type, private.today_ist()) as rate
  ) r
  where i.hostel_id = p_hostel_id and i.status = 'active' and i.available_beds > 0;
$$;

revoke all on function public.vacancy_cost(uuid) from public, anon;
grant execute on function public.vacancy_cost(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 6. Admin: hostels, metrics and settings
-- ---------------------------------------------------------------------------
-- The latest thing anyone did in a hostel. Used by the hostel list and the
-- metrics, so "active" means the same in both.
create or replace function private.hostel_last_activity(p_hostel_id uuid)
returns timestamptz
language sql
stable
security definer
set search_path = ''
as $$
  select greatest(
    (select max(pm.created_at) from public.payments pm where pm.hostel_id = p_hostel_id),
    (select max(a.created_at) from public.allocations a where a.hostel_id = p_hostel_id),
    (select max(re.created_at) from public.residents re where re.hostel_id = p_hostel_id),
    (select max(i.created_at) from public.invoices i where i.hostel_id = p_hostel_id),
    (select h.updated_at from public.hostels h where h.id = p_hostel_id)
  );
$$;

revoke all on function private.hostel_last_activity(uuid) from public, anon, authenticated;

-- The return type grows, so the old functions are dropped first.
drop function public.admin_hostels();
drop function private.admin_hostels();

-- Every hostel with its owner, usage, set-up progress and referrals.
-- Counts only; no resident data.
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
      where pm.hostel_id = h.id and pm.voided_at is null and pm.paid_at >= month_start),
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

create or replace function public.admin_hostels()
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
language sql
stable
security invoker
set search_path = ''
as $$ select * from private.admin_hostels(); $$;

-- Platform-wide numbers for the metrics page. Aggregates only: no hostel,
-- owner or resident names.
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
                             where pm.voided_at is null
                               and pm.paid_at >= m.month and pm.paid_at < (m.month + interval '1 month')::date),
               'collected', (select coalesce(sum(pm.amount), 0) from public.payments pm
                              where pm.voided_at is null
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

create or replace function public.admin_metrics()
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$ select private.admin_metrics(); $$;

create or replace function private.admin_set_trial_days(p_days integer)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
  perform private.require_platform_admin();
  if p_days is null or p_days not between 7 and 180 then
    raise exception 'Choose between 7 and 180 days' using errcode = 'P0001', hint = 'trial_days_range';
  end if;
  -- The one row. Supabase refuses an update with no where clause.
  update public.platform_settings
     set trial_days = p_days, updated_at = now(), updated_by = (select auth.uid())
   where id;
end;
$$;

create or replace function public.admin_set_trial_days(p_days integer)
returns void
language sql
volatile
security invoker
set search_path = ''
as $$ select private.admin_set_trial_days(p_days); $$;

revoke all on function private.admin_hostels() from public, anon;
revoke all on function public.admin_hostels() from public, anon;
revoke all on function private.admin_metrics() from public, anon;
revoke all on function public.admin_metrics() from public, anon;
revoke all on function private.admin_set_trial_days(integer) from public, anon;
revoke all on function public.admin_set_trial_days(integer) from public, anon;
grant execute on function private.admin_hostels() to authenticated;
grant execute on function public.admin_hostels() to authenticated;
grant execute on function private.admin_metrics() to authenticated;
grant execute on function public.admin_metrics() to authenticated;
grant execute on function private.admin_set_trial_days(integer) to authenticated;
grant execute on function public.admin_set_trial_days(integer) to authenticated;
