-- SaaS subscription billing, part 1 (EP-14): what is sold, who is on which
-- plan, the free trial, plan limits and read-only mode for unpaid accounts
-- (E14-T1, T2, T3, T4, T9).
--
-- The paying customer is the owner account, not a hostel: one subscription
-- per owner covers every hostel they run. Its status is written only by the
-- functions in this file and in the gateway migration that follows, called
-- by gateway webhooks, platform admins or the scheduled billing job. Every
-- change is logged in subscription_events by trigger.
--
-- Whether an account may write is derived at read time by
-- private.account_can_write(owner) from the status and its dates, so a
-- trial that ended an hour ago is read-only now, not when the job next runs.
-- The job only records the transition and sends the emails.
--
-- A customer who stops paying never loses data: read-only refuses writes
-- from signed-in users and nothing else. Reads, printing, data export,
-- resident erasure and account closure keep working.

set check_function_bodies = off;

-- ---------------------------------------------------------------------------
-- Billing settings (one row)
-- ---------------------------------------------------------------------------
-- Seller details and policy values. The seller fields are empty until the
-- business is registered for GST; invoices say so until they are filled in
-- (docs/billing.md). Platform admins edit this row from /admin/billing.
create table public.billing_settings (
  id boolean primary key default true,
  trial_days integer not null default 14,
  trial_plan_code text not null default 'pro',
  grace_days integer not null default 7,
  -- GST in basis points: 1800 = 18%. Confirm with a chartered accountant.
  gst_rate_bps integer not null default 1800,
  -- SAC 998314: IT design and development services. To be confirmed.
  sac_code text not null default '998314',
  seller_legal_name text,
  seller_address text,
  seller_gstin text,
  seller_state_code text,
  seller_email text,
  -- The terms of service version sign-up records (E14-T11).
  terms_version text not null default '2026-10-16',
  updated_at timestamptz not null default now(),

  constraint billing_settings_single_row check (id),
  constraint billing_settings_trial_days_range check (trial_days between 1 and 90),
  constraint billing_settings_grace_days_range check (grace_days between 0 and 60),
  constraint billing_settings_gst_rate_range check (gst_rate_bps between 0 and 2800),
  constraint billing_settings_sac_format check (sac_code ~ '^[0-9]{6}$'),
  constraint billing_settings_gstin_format check (
    seller_gstin is null or seller_gstin ~ '^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$'
  ),
  constraint billing_settings_state_format check (
    seller_state_code is null or seller_state_code ~ '^[0-9]{2}$'
  )
);

comment on table public.billing_settings is
  'One row: trial and grace lengths, GST rate, SAC code, the seller''s GST details and the current terms version.';

insert into public.billing_settings default values;

create trigger billing_settings_set_updated_at
  before update on public.billing_settings
  for each row execute function private.set_updated_at();

-- ---------------------------------------------------------------------------
-- Plans (E14-T1)
-- ---------------------------------------------------------------------------
-- Prices are integer paise, excluding GST, per billing period. The basis
-- decides how a period is priced from the account's bed count:
--   flat     price
--   per_bed  price × max(beds, minimum_beds)
--   tiered   the first tier whose up_to_beds covers the beds; the last tier
--            may have no limit
-- A null limit means unlimited. Changing a plan's price never changes a
-- running subscription: each one keeps the amount it was priced at until
-- it renews (subscriptions.amount).
create table public.plans (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  name text not null,
  description text,
  pricing_basis text not null,
  monthly_price integer not null default 0,
  annual_price integer not null default 0,
  minimum_beds integer not null default 1,
  tiers jsonb not null default '[]'::jsonb,
  max_beds integer,
  max_hostels integer,
  max_staff integer,
  features text[] not null default '{}',
  -- Offered on the billing page. Hidden plans (the grandfathered plan) can
  -- still be applied by an admin.
  is_public boolean not null default true,
  is_active boolean not null default true,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint plans_code_format check (code ~ '^[a-z][a-z0-9_]{1,39}$'),
  constraint plans_name_length check (char_length(btrim(name)) between 1 and 60),
  constraint plans_description_length check (char_length(description) <= 300),
  constraint plans_basis_valid check (pricing_basis in ('flat', 'per_bed', 'tiered')),
  constraint plans_prices_non_negative check (monthly_price >= 0 and annual_price >= 0),
  constraint plans_minimum_beds_positive check (minimum_beds >= 1),
  constraint plans_limits_positive check (
    (max_beds is null or max_beds >= 1)
    and (max_hostels is null or max_hostels >= 1)
    and (max_staff is null or max_staff >= 0)
  ),
  constraint plans_tiers_shape check (
    jsonb_typeof(tiers) = 'array'
    and ((pricing_basis = 'tiered') = (jsonb_array_length(tiers) > 0))
  )
);

comment on table public.plans is
  'What Hostel ERP sells: price per month and per year (paise, excluding GST), pricing basis, limits and feature flags.';

create trigger plans_set_updated_at
  before update on public.plans
  for each row execute function private.set_updated_at();

-- Tiers are [{"up_to_beds": 100, "monthly_price": 99900, "annual_price": 999000}, ...]
-- in ascending order; only the last may leave up_to_beds null.
create or replace function private.plans_check_tiers()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  tier jsonb;
  previous integer := 0;
  position integer := 0;
  total integer := jsonb_array_length(new.tiers);
begin
  for tier in select value from jsonb_array_elements(new.tiers) loop
    position := position + 1;
    if jsonb_typeof(tier -> 'monthly_price') <> 'number'
       or jsonb_typeof(tier -> 'annual_price') <> 'number'
       or (tier ->> 'monthly_price')::integer < 0
       or (tier ->> 'annual_price')::integer < 0 then
      raise exception 'Each tier needs a monthly and an annual price'
        using errcode = 'P0001', hint = 'plan_tiers_invalid';
    end if;
    if tier -> 'up_to_beds' is null or jsonb_typeof(tier -> 'up_to_beds') = 'null' then
      if position <> total then
        raise exception 'Only the last tier can have no bed limit'
          using errcode = 'P0001', hint = 'plan_tiers_invalid';
      end if;
    elsif (tier ->> 'up_to_beds')::integer <= previous then
      raise exception 'Tiers must go up in beds'
        using errcode = 'P0001', hint = 'plan_tiers_invalid';
    else
      previous := (tier ->> 'up_to_beds')::integer;
    end if;
  end loop;
  return new;
end;
$$;

create trigger plans_check_tiers
  before insert or update of tiers, pricing_basis on public.plans
  for each row execute function private.plans_check_tiers();

-- Starting plans. Prices are PROPOSALS awaiting the owner's decision
-- (docs/pricing.md); an admin changes them from /admin/plans.
insert into public.plans
  (code, name, description, pricing_basis, monthly_price, annual_price, minimum_beds, tiers,
   max_beds, max_hostels, max_staff, features, is_public, sort_order)
values
  ('founder', 'Founder (grandfathered)',
   'Free for owners who joined before billing started.', 'flat', 0, 0, 1, '[]',
   null, null, null, array['complaints', 'reports', 'online_payments'], false, 0),
  ('starter', 'Starter', 'One small hostel or PG.', 'flat', 99900, 999000, 1, '[]',
   50, 1, 2, array['complaints', 'reports'], true, 10),
  ('growth', 'Growth', 'Priced per bed, for growing operators.', 'per_bed', 2500, 25000, 20, '[]',
   300, 3, 10, array['complaints', 'reports', 'online_payments'], true, 20),
  ('pro', 'Pro', 'Large hostels and chains.', 'tiered', 0, 0, 1,
   '[{"up_to_beds": 500, "monthly_price": 999900, "annual_price": 9999000},
     {"up_to_beds": null, "monthly_price": 1799900, "annual_price": 17999000}]',
   null, null, null, array['complaints', 'reports', 'online_payments'], true, 30);

-- The price of one billing period, excluding GST, for an account with
-- p_beds beds.
create or replace function private.plan_amount(p_plan_id uuid, p_interval text, p_beds integer)
returns integer
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  plan public.plans;
  beds integer := greatest(coalesce(p_beds, 0), 0);
  tier jsonb;
begin
  select * into plan from public.plans where id = p_plan_id;
  if plan.id is null then
    return null;
  end if;
  if p_interval not in ('month', 'year') then
    raise exception 'Unknown billing interval' using errcode = 'P0001', hint = 'billing_interval';
  end if;

  if plan.pricing_basis = 'flat' then
    return case p_interval when 'month' then plan.monthly_price else plan.annual_price end;
  elsif plan.pricing_basis = 'per_bed' then
    return greatest(beds, plan.minimum_beds)
           * case p_interval when 'month' then plan.monthly_price else plan.annual_price end;
  end if;

  for tier in select value from jsonb_array_elements(plan.tiers) loop
    if jsonb_typeof(tier -> 'up_to_beds') is distinct from 'number'
       or beds <= (tier ->> 'up_to_beds')::integer then
      return case p_interval
               when 'month' then (tier ->> 'monthly_price')::integer
               else (tier ->> 'annual_price')::integer
             end;
    end if;
  end loop;
  -- More beds than the last tier allows: the plan's bed limit refuses this
  -- account anyway.
  return null;
end;
$$;

-- ---------------------------------------------------------------------------
-- Subscriptions (E14-T2)
-- ---------------------------------------------------------------------------
create table public.subscriptions (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null unique references public.profiles (id) on delete cascade,
  plan_id uuid not null references public.plans (id),
  billing_interval text not null default 'month',
  status text not null,
  trial_ends_at timestamptz,
  current_period_start timestamptz,
  -- Null while active means no end: the grandfathered and open-ended
  -- complimentary plans.
  current_period_end timestamptz,
  -- The price of one period excluding GST, fixed when the period was priced.
  amount integer not null default 0,
  beds_at_renewal integer,
  cancel_at_period_end boolean not null default false,
  cancel_reason text,
  past_due_since timestamptz,
  -- Plan or interval to switch to at the next renewal (downgrades, and
  -- monthly/annual switches).
  pending_plan_id uuid references public.plans (id),
  pending_interval text,
  -- Set by an admin for a complimentary plan (E10-T7).
  complimentary boolean not null default false,
  gateway text,
  gateway_customer_id text,
  gateway_subscription_id text unique,
  -- The gateway plan the subscription is set to charge from its next cycle.
  gateway_plan_id text,
  -- What the owner is checking out at the gateway, until it activates.
  checkout_plan_id uuid references public.plans (id),
  checkout_interval text,
  checkout_coupon_id uuid,
  checkout_started_at timestamptz,
  coupon_id uuid,
  coupon_cycles_left integer,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint subscriptions_status_valid check (
    status in ('trialing', 'active', 'past_due', 'read_only', 'cancelled')
  ),
  constraint subscriptions_interval_valid check (billing_interval in ('month', 'year')),
  constraint subscriptions_pending_interval_valid check (
    pending_interval is null or pending_interval in ('month', 'year')
  ),
  constraint subscriptions_checkout_interval_valid check (
    checkout_interval is null or checkout_interval in ('month', 'year')
  ),
  constraint subscriptions_trial_has_end check (status <> 'trialing' or trial_ends_at is not null),
  constraint subscriptions_past_due_since check ((status = 'past_due') = (past_due_since is not null)),
  constraint subscriptions_amount_non_negative check (amount >= 0),
  constraint subscriptions_period_order check (
    current_period_end is null or current_period_start is null
    or current_period_end > current_period_start
  ),
  constraint subscriptions_cancel_reason_length check (char_length(cancel_reason) <= 500),
  constraint subscriptions_gateway_valid check (gateway is null or gateway in ('razorpay'))
);

comment on table public.subscriptions is
  'One per owner account. Written only by billing functions (webhooks, admins, the billing job); every change is logged in subscription_events.';

create index subscriptions_status_idx on public.subscriptions (status);
create index subscriptions_plan_idx on public.subscriptions (plan_id);

create trigger subscriptions_set_updated_at
  before update on public.subscriptions
  for each row execute function private.set_updated_at();

-- Every status, plan or period change, with who caused it. The functions set
-- billing.source and billing.reason for their transaction; the trigger
-- records them.
create table public.subscription_events (
  id bigint generated always as identity primary key,
  -- Plain values, not foreign keys: the history outlives a closed account.
  subscription_id uuid not null,
  owner_id uuid not null,
  source text not null,
  from_status text,
  to_status text not null,
  from_plan_id uuid,
  to_plan_id uuid not null,
  reason text,
  details jsonb not null default '{}'::jsonb,
  actor_id uuid default auth.uid(),
  created_at timestamptz not null default now(),

  constraint subscription_events_source_valid check (
    source in ('signup', 'migration', 'gateway', 'admin', 'job', 'owner', 'system')
  )
);

comment on table public.subscription_events is
  'Immutable history of every subscription change and what caused it.';

create index subscription_events_subscription_idx
  on public.subscription_events (subscription_id, created_at desc);
create index subscription_events_created_idx on public.subscription_events (created_at desc);

create or replace function private.subscription_events_immutable()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  raise exception 'Subscription history cannot be changed'
    using errcode = 'P0001', hint = 'history_immutable';
end;
$$;

create trigger subscription_events_immutable
  before update or delete on public.subscription_events
  for each row execute function private.subscription_events_immutable();

-- Runs a block of billing writes as one source, so the history says why.
create or replace function private.billing_source(p_source text, p_reason text default null)
returns void
language sql
volatile
set search_path = ''
as $$
  select set_config('billing.source', p_source, true),
         set_config('billing.reason', coalesce(left(p_reason, 500), ''), true);
$$;

create or replace function private.subscriptions_log()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  source text := coalesce(nullif(current_setting('billing.source', true), ''), 'system');
  reason text := nullif(current_setting('billing.reason', true), '');
begin
  if tg_op = 'UPDATE'
     and new.status is not distinct from old.status
     and new.plan_id is not distinct from old.plan_id
     and new.billing_interval is not distinct from old.billing_interval
     and new.current_period_end is not distinct from old.current_period_end
     and new.trial_ends_at is not distinct from old.trial_ends_at
     and new.cancel_at_period_end is not distinct from old.cancel_at_period_end
     and new.pending_plan_id is not distinct from old.pending_plan_id
     and new.pending_interval is not distinct from old.pending_interval
     and new.complimentary is not distinct from old.complimentary then
    return new;
  end if;

  insert into public.subscription_events
    (subscription_id, owner_id, source, from_status, to_status, from_plan_id, to_plan_id,
     reason, details)
  values (
    new.id, new.owner_id, source,
    case tg_op when 'UPDATE' then old.status end, new.status,
    case tg_op when 'UPDATE' then old.plan_id end, new.plan_id,
    reason,
    jsonb_strip_nulls(jsonb_build_object(
      'billing_interval', new.billing_interval,
      'trial_ends_at', new.trial_ends_at,
      'current_period_end', new.current_period_end,
      'cancel_at_period_end', new.cancel_at_period_end,
      'pending_plan_id', new.pending_plan_id,
      'pending_interval', new.pending_interval,
      'complimentary', new.complimentary,
      'amount', new.amount
    ))
  );
  return new;
end;
$$;

create trigger subscriptions_log
  after insert or update on public.subscriptions
  for each row execute function private.subscriptions_log();

-- Statuses move only along these paths. 'trialing' is entered only at sign-up
-- or by an admin extending a trial.
create or replace function private.subscriptions_guard_status()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if new.status = old.status then
    return new;
  end if;
  if new.status = 'trialing' and coalesce(current_setting('billing.source', true), '') <> 'admin' then
    raise exception 'Only an admin can restart a trial'
      using errcode = 'P0001', hint = 'subscription_status_transition';
  end if;
  if not (
    (old.status = 'trialing' and new.status in ('active', 'read_only', 'cancelled'))
    or (old.status = 'active' and new.status in ('past_due', 'read_only', 'cancelled'))
    or (old.status = 'past_due' and new.status in ('active', 'read_only', 'cancelled'))
    or (old.status = 'read_only' and new.status in ('active', 'trialing', 'cancelled'))
    or (old.status = 'cancelled' and new.status in ('active', 'trialing'))
  ) then
    raise exception 'A subscription cannot move from % to %', old.status, new.status
      using errcode = 'P0001', hint = 'subscription_status_transition';
  end if;
  return new;
end;
$$;

create trigger subscriptions_guard_status
  before update of status on public.subscriptions
  for each row execute function private.subscriptions_guard_status();

-- ---------------------------------------------------------------------------
-- Every owner has a subscription
-- ---------------------------------------------------------------------------
-- Existing owners move onto the grandfathered plan with no end date, so
-- nothing changes for them on release.
select private.billing_source('migration', 'Owners who joined before billing started');
insert into public.subscriptions (owner_id, plan_id, status, current_period_start)
select p.id, (select id from public.plans where code = 'founder'), 'active', now()
  from public.profiles p
 where p.role = 'owner';

-- A new owner's trial of the trial plan (E14-T3), with full features, starts
-- when they create their first hostel: that is when they start using the
-- product. Starting it at the profile would also give one to every staff
-- and admin account, which begin life as owner profiles.
--
-- Before-insert triggers fire in name order: this one ('begin') must run
-- before hostels_require_account_can_write ('require') reads the
-- subscription it creates.
create or replace function private.hostels_begin_trial()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  settings public.billing_settings;
begin
  if exists (select 1 from public.subscriptions s where s.owner_id = new.owner_id) then
    return new;
  end if;
  select * into settings from public.billing_settings;
  perform private.billing_source('signup', null);
  insert into public.subscriptions (owner_id, plan_id, status, trial_ends_at)
  values (
    new.owner_id,
    (select p.id from public.plans p where p.code = settings.trial_plan_code),
    'trialing',
    now() + make_interval(days => settings.trial_days)
  )
  on conflict (owner_id) do nothing;
  return new;
end;
$$;

create trigger hostels_begin_trial
  before insert on public.hostels
  for each row execute function private.hostels_begin_trial();

-- ---------------------------------------------------------------------------
-- May this account write? (E14-T2, used by E14-T9)
-- ---------------------------------------------------------------------------
create or replace function private.account_can_write(p_owner_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((
    select case s.status
             when 'trialing' then s.trial_ends_at > now()
             when 'active' then not (s.cancel_at_period_end
                                     and s.current_period_end is not null
                                     and s.current_period_end <= now())
             when 'past_due' then s.past_due_since
                                  + make_interval(days => (select b.grace_days from public.billing_settings b))
                                  > now()
             else false
           end
      from public.subscriptions s
     where s.owner_id = p_owner_id
  ), false);
$$;

comment on function private.account_can_write(uuid) is
  'Whether the owner account may write tenant data now, derived from its subscription status and dates.';

-- Why an account cannot write, for messages and banners.
create or replace function private.account_state(p_owner_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'status', s.status,
    'can_write', private.account_can_write(s.owner_id),
    'plan_code', p.code,
    'plan_name', p.name,
    'trial_ends_at', s.trial_ends_at,
    'current_period_end', s.current_period_end,
    'cancel_at_period_end', s.cancel_at_period_end,
    'grace_ends_at', case when s.status = 'past_due' then
      s.past_due_since + make_interval(days => (select b.grace_days from public.billing_settings b))
    end,
    'complimentary', s.complimentary
  )
  from public.subscriptions s
  join public.plans p on p.id = s.plan_id
  where s.owner_id = p_owner_id;
$$;

-- The state of the account that owns a hostel, for anyone who works in it.
-- Staff see whether they can work and why not; never prices.
create or replace function public.hostel_account_state(p_hostel_id uuid)
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
  select private.hostel_account_state(p_hostel_id);
$$;

create or replace function private.hostel_account_state(p_hostel_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select private.account_state(h.owner_id)
    from public.hostels h
   where h.id = p_hostel_id
     and h.id in (select private.user_hostel_ids());
$$;

-- ---------------------------------------------------------------------------
-- Read-only mode (E14-T9)
-- ---------------------------------------------------------------------------
-- Refuses every tenant write by a signed-in user when the owning account
-- cannot write. The service role (worker job links, resident complaints,
-- gateway webhooks) and scheduled jobs are not users and are not refused:
-- money a resident pays through the gateway is always recorded.
--
-- Erasing a resident (DPDP Act) is a right, not a feature, so it stays
-- open: it is the only residents update that sets erased_at.
create or replace function private.owner_of_hostel(p_hostel_id uuid)
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select h.owner_id from public.hostels h where h.id = p_hostel_id;
$$;

create or replace function private.raise_read_only()
returns void
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'This account is read-only until its subscription is paid'
    using errcode = 'P0001', hint = 'account_read_only';
end;
$$;

create or replace function private.require_account_can_write()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  row_data jsonb;
  owner uuid;
begin
  if coalesce((select auth.jwt() ->> 'role'), '') <> 'authenticated' then
    return case tg_op when 'DELETE' then old else new end;
  end if;

  row_data := case tg_op when 'DELETE' then to_jsonb(old) else to_jsonb(new) end;

  if tg_table_name = 'residents' and tg_op = 'UPDATE' then
    if (to_jsonb(old) ->> 'erased_at') is null and (row_data ->> 'erased_at') is not null then
      return new;
    end if;
  end if;

  if tg_table_name in ('hostels', 'workers') then
    owner := (row_data ->> 'owner_id')::uuid;
  elsif tg_table_name = 'worker_unavailability' then
    owner := (select w.owner_id from public.workers w where w.id = (row_data ->> 'worker_id')::uuid);
  else
    owner := private.owner_of_hostel((row_data ->> 'hostel_id')::uuid);
  end if;

  if owner is not null and not private.account_can_write(owner) then
    perform private.raise_read_only();
  end if;
  return case tg_op when 'DELETE' then old else new end;
end;
$$;

-- The tenant tables. Account-level tables stay writable on purpose:
-- profiles, data_requests (the owner's data rights), announcement
-- dismissals, the admin audit log and billing itself.
do $$
declare
  t text;
begin
  foreach t in array array[
    'hostels', 'rooms', 'beds', 'residents', 'allocations', 'allocation_events',
    'fee_structures', 'invoices', 'invoice_lines', 'payments',
    'fee_heads', 'fee_head_rates', 'resident_charges', 'discounts', 'late_fee_rules',
    'resident_fee_exemptions', 'resident_credit', 'deposit_amounts', 'deposit_ledger',
    'electricity_rates', 'meter_readings',
    'complaints', 'complaint_categories', 'complaint_events', 'complaint_attachments',
    'complaint_job_links', 'complaint_targets', 'maintenance_schedules', 'vendor_payouts',
    'workers', 'worker_hostels', 'worker_unavailability'
  ] loop
    execute format(
      'create trigger %I before insert or update or delete on public.%I
         for each row execute function private.require_account_can_write()',
      t || '_require_account_can_write', t
    );
  end loop;
end;
$$;

-- ---------------------------------------------------------------------------
-- Plan limits (E14-T4)
-- ---------------------------------------------------------------------------
-- Enforced for every writer, the service role included: limits are what was
-- sold. Existing data above a limit is never deleted or hidden; only new
-- beds, hostels and staff are refused.
create or replace function private.account_usage(p_owner_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'beds', (select count(*) from public.beds b
              join public.hostels h on h.id = b.hostel_id
             where h.owner_id = p_owner_id and b.archived_at is null),
    'hostels', (select count(*) from public.hostels h where h.owner_id = p_owner_id),
    'staff', (select count(*) from public.profiles p
               join public.hostels h on h.id = p.hostel_id
              where h.owner_id = p_owner_id and p.role = 'staff')
  );
$$;

create or replace function private.account_plan(p_owner_id uuid)
returns public.plans
language sql
stable
security definer
set search_path = ''
as $$
  select p.* from public.subscriptions s join public.plans p on p.id = s.plan_id
   where s.owner_id = p_owner_id;
$$;

create or replace function private.check_plan_limit(p_owner_id uuid, p_what text)
returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  plan public.plans := private.account_plan(p_owner_id);
  usage jsonb;
  limit_value integer;
begin
  if plan.id is null then
    return;
  end if;
  limit_value := case p_what
                   when 'beds' then plan.max_beds
                   when 'hostels' then plan.max_hostels
                   when 'staff' then plan.max_staff
                 end;
  if limit_value is null then
    return;
  end if;
  usage := private.account_usage(p_owner_id);
  if (usage ->> p_what)::integer > limit_value then
    raise exception 'Your % plan allows up to % %', plan.name, limit_value,
      case p_what when 'beds' then 'beds' when 'hostels' then case limit_value when 1 then 'hostel' else 'hostels' end
                  else 'staff accounts' end
      using errcode = 'P0001', hint = 'plan_limit_' || p_what,
            detail = json_build_object('limit', limit_value, 'plan', plan.name)::text;
  end if;
end;
$$;

-- Beds: checked once per statement, after a whole room or range of rooms
-- has made its beds, so a bulk generation is refused as one.
create or replace function private.beds_check_plan_limit()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  owner uuid;
begin
  for owner in
    select distinct h.owner_id
      from new_rows n join public.hostels h on h.id = n.hostel_id
     where n.archived_at is null
  loop
    perform private.check_plan_limit(owner, 'beds');
  end loop;
  return null;
end;
$$;

create trigger beds_check_plan_limit_insert
  after insert on public.beds
  referencing new table as new_rows
  for each statement execute function private.beds_check_plan_limit();

-- An update trigger cannot have both a column list and transition tables.
create or replace function private.beds_check_plan_limit_update()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  owner uuid;
begin
  for owner in
    select distinct h.owner_id
      from new_rows n
      join old_rows o on o.id = n.id
      join public.hostels h on h.id = n.hostel_id
     where n.archived_at is null and o.archived_at is not null
  loop
    perform private.check_plan_limit(owner, 'beds');
  end loop;
  return null;
end;
$$;

create trigger beds_check_plan_limit_update
  after update on public.beds
  referencing old table as old_rows new table as new_rows
  for each statement execute function private.beds_check_plan_limit_update();

create or replace function private.hostels_check_plan_limit()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.check_plan_limit(new.owner_id, 'hostels');
  return null;
end;
$$;

create trigger hostels_check_plan_limit
  after insert on public.hostels
  for each row execute function private.hostels_check_plan_limit();

create or replace function private.profiles_check_staff_limit()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.role = 'staff' and new.hostel_id is not null
     and (tg_op = 'INSERT' or old.role is distinct from 'staff'
          or old.hostel_id is distinct from new.hostel_id) then
    perform private.check_plan_limit(private.owner_of_hostel(new.hostel_id), 'staff');
  end if;
  return null;
end;
$$;

create trigger profiles_check_staff_limit
  after insert or update of role, hostel_id on public.profiles
  for each row execute function private.profiles_check_staff_limit();

-- What would have to go before an account fits a plan: an empty array when
-- it fits. Used to refuse downgrades (E14-T4) with what to remove.
create or replace function private.plan_violations(p_owner_id uuid, p_plan_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  with usage as (select private.account_usage(p_owner_id) as u),
       plan as (select * from public.plans where id = p_plan_id)
  select coalesce(jsonb_agg(v), '[]'::jsonb) from (
    select jsonb_build_object('what', 'beds', 'limit', plan.max_beds,
                              'used', (usage.u ->> 'beds')::integer) as v
      from usage, plan where plan.max_beds is not null and (usage.u ->> 'beds')::integer > plan.max_beds
    union all
    select jsonb_build_object('what', 'hostels', 'limit', plan.max_hostels,
                              'used', (usage.u ->> 'hostels')::integer)
      from usage, plan where plan.max_hostels is not null and (usage.u ->> 'hostels')::integer > plan.max_hostels
    union all
    select jsonb_build_object('what', 'staff', 'limit', plan.max_staff,
                              'used', (usage.u ->> 'staff')::integer)
      from usage, plan where plan.max_staff is not null and (usage.u ->> 'staff')::integer > plan.max_staff
  ) x;
$$;

-- ---------------------------------------------------------------------------
-- Privileges and row-level security
-- ---------------------------------------------------------------------------
alter table public.billing_settings enable row level security;
alter table public.plans enable row level security;
alter table public.subscriptions enable row level security;
alter table public.subscription_events enable row level security;

revoke all on public.billing_settings, public.plans, public.subscriptions,
  public.subscription_events from authenticated, anon;

-- Prices and limits are public information for signed-in users; writes go
-- through the admin functions.
grant select on public.plans to authenticated;
create policy "plans: signed-in users read active plans, admins read all"
  on public.plans for select to authenticated
  using (is_active or (select private.is_platform_admin()));

grant select on public.billing_settings to authenticated;
create policy "billing settings: signed-in users read"
  on public.billing_settings for select to authenticated using (true);

-- An owner reads their own subscription and its history; staff never do.
grant select on public.subscriptions to authenticated;
create policy "subscriptions: owners read their own"
  on public.subscriptions for select to authenticated
  using (owner_id = (select auth.uid()) or (select private.is_platform_admin()));

grant select on public.subscription_events to authenticated;
create policy "subscription events: owners read their own"
  on public.subscription_events for select to authenticated
  using (owner_id = (select auth.uid()) or (select private.is_platform_admin()));

revoke all on function private.plans_check_tiers(), private.plan_amount(uuid, text, integer),
  private.subscription_events_immutable(), private.billing_source(text, text),
  private.subscriptions_log(), private.subscriptions_guard_status(),
  private.hostels_begin_trial(), private.account_can_write(uuid), private.account_state(uuid),
  private.hostel_account_state(uuid), private.owner_of_hostel(uuid), private.raise_read_only(),
  private.require_account_can_write(), private.account_usage(uuid), private.account_plan(uuid),
  private.check_plan_limit(uuid, text), private.beds_check_plan_limit(),
  private.beds_check_plan_limit_update(), private.hostels_check_plan_limit(),
  private.profiles_check_staff_limit(), private.plan_violations(uuid, uuid) from public;

grant execute on function private.hostel_account_state(uuid) to authenticated;
revoke execute on function public.hostel_account_state(uuid) from public, anon;
grant execute on function public.hostel_account_state(uuid) to authenticated;
