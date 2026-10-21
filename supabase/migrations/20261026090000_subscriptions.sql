-- Subscription billing groundwork (ClickUp EP-14), with no payment gateway.
--
-- T1  plans: prices in paise, pricing basis, limits and feature flags,
--     managed by platform admins. The seeded prices are PLACEHOLDERS for the
--     owner to set (docs/pricing.md).
-- T2  one subscription per owner account, with a status machine, a log, and
--     private.account_can_write(owner). Gateway ids stay empty until there is
--     a gateway. hostels.plan and hostels.trial_ends_at are kept, mirrored
--     from the subscription, so existing screens and reports keep working.
-- T3  every new owner starts a trial of the full product, of the length
--     platform admins set. When it ends the account becomes read-only, not
--     deleted; the admin decides what happens next.
-- T4  plan limits on beds, hostels and staff, enforced here; a downgrade
--     below current usage is refused; data already over a limit is kept.
-- T9  read-only mode: when an account cannot write, every write to its
--     hostels' data is refused. Reads, printing and exports keep working.
-- T11 the version of the terms a new owner accepted at sign-up.
-- Revenue figures for the platform admin, from subscriptions.

-- ---------------------------------------------------------------------------
-- Plans (T1)
-- ---------------------------------------------------------------------------
create table public.plans (
  id text primary key,
  name text not null,
  monthly_price integer not null,
  yearly_price integer,
  pricing_basis text not null default 'flat',
  -- Null means no limit.
  max_beds integer,
  max_hostels integer,
  max_staff integer,
  features jsonb not null default '{}'::jsonb,
  gst_inclusive boolean not null default false,
  -- Offered to owners; a plan that is not public can still be given by an admin.
  public boolean not null default true,
  active boolean not null default true,
  position integer not null default 0,
  updated_at timestamptz not null default now(),

  constraint plans_id_format check (id ~ '^[a-z][a-z0-9_]{1,30}$'),
  constraint plans_name_length check (char_length(btrim(name)) between 1 and 60),
  constraint plans_monthly_range check (monthly_price between 0 and 100000000),
  constraint plans_yearly_range check (yearly_price between 0 and 1000000000),
  constraint plans_basis_valid check (pricing_basis in ('flat', 'per_bed', 'tiered')),
  constraint plans_beds_range check (max_beds between 1 and 100000),
  constraint plans_hostels_range check (max_hostels between 1 and 1000),
  constraint plans_staff_range check (max_staff between 0 and 1000),
  constraint plans_features_object check (jsonb_typeof(features) = 'object')
);

comment on table public.plans is
  'Subscription plans (EP-14 T1). Seeded prices are placeholders for the owner to set; see docs/pricing.md.';

insert into public.plans (id, name, monthly_price, yearly_price, max_beds, max_hostels, max_staff, features, public, position)
values
  ('free', 'Free (grandfathered)', 0, 0, null, null, null, '{"reports": true, "complaints": true}', false, 0),
  ('starter', 'Starter', 49900, 499000, 50, 1, 2, '{"reports": true, "complaints": true}', true, 1),
  ('growth', 'Growth', 99900, 999000, 200, 3, 10, '{"reports": true, "complaints": true}', true, 2),
  ('pro', 'Pro', 199900, 1999000, null, null, null, '{"reports": true, "complaints": true}', true, 3);

alter table public.plans enable row level security;
revoke all on public.plans from authenticated, anon;
grant select on public.plans to authenticated;
create policy "plans: everyone signed in reads" on public.plans for select to authenticated using (true);

-- ---------------------------------------------------------------------------
-- Subscriptions (T2)
-- ---------------------------------------------------------------------------
create table public.subscriptions (
  owner_id uuid primary key references public.profiles (id) on delete cascade,
  plan_id text not null references public.plans (id),
  status text not null,
  trial_ends_at date,
  current_period_start date,
  current_period_end date,
  -- The monthly price when this plan was given: a later price change applies
  -- only from the next renewal.
  price_monthly integer not null default 0,
  beds_at_renewal integer,
  cancel_at_period_end boolean not null default false,
  gateway_customer_id text,
  gateway_subscription_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint subscriptions_status_valid check (
    status in ('trialing', 'active', 'past_due', 'read_only', 'cancelled')
  ),
  constraint subscriptions_trial_has_end check (status <> 'trialing' or trial_ends_at is not null),
  constraint subscriptions_period_order check (current_period_end >= current_period_start),
  constraint subscriptions_price_range check (price_monthly between 0 and 100000000)
);

comment on table public.subscriptions is
  'One subscription per owner account (EP-14 T2). Changed only by admin functions now, and by the gateway''s webhooks once there is one.';

create table public.subscription_events (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.profiles (id) on delete cascade,
  from_status text,
  to_status text not null,
  from_plan text,
  to_plan text not null,
  reason text,
  actor_id uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now()
);

create index subscription_events_owner_idx on public.subscription_events (owner_id, created_at);

comment on table public.subscription_events is
  'Every subscription change: who, from what, to what, and why (EP-14 T2).';

create or replace function private.subscriptions_log()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' or new.status is distinct from old.status or new.plan_id is distinct from old.plan_id
     or new.trial_ends_at is distinct from old.trial_ends_at then
    insert into public.subscription_events (owner_id, from_status, to_status, from_plan, to_plan, reason, actor_id)
    values (new.owner_id,
            case when tg_op = 'UPDATE' then old.status end, new.status,
            case when tg_op = 'UPDATE' then old.plan_id end, new.plan_id,
            nullif(current_setting('app.subscription_reason', true), ''),
            (select auth.uid()));
  end if;
  new.updated_at := now();
  return new;
end;
$$;

create trigger subscriptions_log
  before insert or update on public.subscriptions
  for each row execute function private.subscriptions_log();

-- The status that counts today: a trial past its end is read-only.
create or replace function private.effective_status(p_status text, p_trial_ends_at date)
returns text
language sql
stable
set search_path = ''
as $$
  select case when p_status = 'trialing' and p_trial_ends_at < private.today_ist() then 'read_only' else p_status end;
$$;

grant execute on function private.effective_status(text, date) to authenticated, anon, service_role;

-- Whether an owner's account may change its data. No subscription (should
-- not happen) is treated as writable rather than locking anyone out.
create or replace function private.account_can_write(p_owner_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((
    select private.effective_status(s.status, s.trial_ends_at) in ('trialing', 'active', 'past_due')
      from public.subscriptions s where s.owner_id = p_owner_id), true);
$$;

revoke all on function private.account_can_write(uuid) from public, anon;
grant execute on function private.account_can_write(uuid) to authenticated, service_role;

-- The per-hostel plan columns, mirrored from the owner's subscription.
create or replace function private.mirror_plan(p_status text, p_plan text)
returns text
language sql
immutable
set search_path = ''
as $$
  select case when p_status = 'trialing' then 'trial' when p_plan = 'free' then 'free' else 'paid' end;
$$;

create or replace function private.subscriptions_mirror()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.hostels h
     set plan = private.mirror_plan(new.status, new.plan_id),
         trial_ends_at = coalesce(new.trial_ends_at, h.trial_ends_at)
   where h.owner_id = new.owner_id
     and (h.plan is distinct from private.mirror_plan(new.status, new.plan_id)
          or (new.trial_ends_at is not null and h.trial_ends_at is distinct from new.trial_ends_at));
  return null;
end;
$$;

create trigger subscriptions_mirror
  after insert or update on public.subscriptions
  for each row execute function private.subscriptions_mirror();

-- Existing owners: paid anywhere wins, then free, then the latest trial end.
insert into public.subscriptions (owner_id, plan_id, status, trial_ends_at, current_period_start, current_period_end, price_monthly)
select o.owner_id,
       -- Legacy "paid" had no limits, so it becomes the plan without any.
       case when o.paid then 'pro' when o.free then 'free' else 'pro' end,
       case when o.paid or o.free then 'active' else 'trialing' end,
       case when o.paid or o.free then null else coalesce(o.trial_end, private.today_ist()) end,
       case when o.paid or o.free then private.today_ist() end,
       case when o.paid then (private.today_ist() + interval '1 month')::date end,
       case when o.paid then 199900 else 0 end
  from (
    select h.owner_id,
           bool_or(h.plan = 'paid') as paid,
           bool_or(h.plan = 'free') as free,
           max(h.trial_ends_at) as trial_end
      from public.hostels h group by h.owner_id
  ) o;

-- New hostels follow their owner's subscription; a first hostel starts one.
create or replace function private.hostels_start_trial()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  s record;
begin
  select * into s from public.subscriptions where owner_id = new.owner_id;
  if found and current_user = 'authenticated' then
    new.plan := private.mirror_plan(s.status, s.plan_id);
    new.trial_ends_at := coalesce(s.trial_ends_at, private.today_ist());
    return new;
  end if;
  -- Only the service role may choose a plan at creation (fixtures, imports).
  if current_user = 'authenticated' then
    new.plan := 'trial';
    new.trial_ends_at := null;
  end if;
  if new.plan = 'trial' and new.trial_ends_at is null then
    new.trial_ends_at := private.today_ist() + private.trial_days();
  end if;
  return new;
end;
$$;

create or replace function private.hostels_start_subscription()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.subscriptions (owner_id, plan_id, status, trial_ends_at, current_period_start, price_monthly)
  values (new.owner_id,
          case new.plan when 'free' then 'free' else 'pro' end,
          case when new.plan = 'trial' then 'trialing' else 'active' end,
          case when new.plan = 'trial' then new.trial_ends_at end,
          case when new.plan <> 'trial' then private.today_ist() end,
          case when new.plan = 'paid' then 199900 else 0 end)
  on conflict (owner_id) do nothing;
  return null;
end;
$$;

create trigger hostels_start_subscription
  after insert on public.hostels
  for each row execute function private.hostels_start_subscription();

alter table public.subscriptions enable row level security;
alter table public.subscription_events enable row level security;
revoke all on public.subscriptions, public.subscription_events from authenticated, anon;
grant select on public.subscriptions, public.subscription_events to authenticated;
create policy "subscriptions: owner reads own" on public.subscriptions for select to authenticated
  using (owner_id = (select auth.uid()));
create policy "subscription events: owner reads own" on public.subscription_events for select to authenticated
  using (owner_id = (select auth.uid()));

-- ---------------------------------------------------------------------------
-- Usage and limits (T4)
-- ---------------------------------------------------------------------------
create or replace function private.account_usage(p_owner_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'beds', (select count(*) from public.beds b join public.hostels h on h.id = b.hostel_id
              where h.owner_id = p_owner_id and b.archived_at is null),
    'hostels', (select count(*) from public.hostels h where h.owner_id = p_owner_id),
    'staff', (select count(*) from public.profiles p join public.hostels h on h.id = p.hostel_id
               where h.owner_id = p_owner_id and p.role = 'staff' and p.deactivated_at is null)
           + (select count(*) from public.staff_invitations i join public.hostels h on h.id = i.hostel_id
               where h.owner_id = p_owner_id and i.accepted_at is null and i.revoked_at is null)
  );
$$;

revoke all on function private.account_usage(uuid) from public, anon, authenticated;

-- What would be over the limits of a plan, as plain sentences; empty if none.
create or replace function private.over_limits(p_owner_id uuid, p_plan_id text)
returns text[]
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  usage jsonb := private.account_usage(p_owner_id);
  p public.plans;
  result text[] := '{}'::text[];
begin
  select * into p from public.plans where id = p_plan_id;
  if p.max_beds is not null and (usage ->> 'beds')::integer > p.max_beds then
    result := result || format('%s beds in use; %s allows %s', usage ->> 'beds', p.name, p.max_beds);
  end if;
  if p.max_hostels is not null and (usage ->> 'hostels')::integer > p.max_hostels then
    result := result || format('%s hostels; %s allows %s', usage ->> 'hostels', p.name, p.max_hostels);
  end if;
  if p.max_staff is not null and (usage ->> 'staff')::integer > p.max_staff then
    result := result || format('%s staff accounts and invitations; %s allows %s', usage ->> 'staff', p.name, p.max_staff);
  end if;
  return result;
end;
$$;

revoke all on function private.over_limits(uuid, text) from public, anon, authenticated;

-- Refuses a new bed, hostel or staff invitation past the plan's limit. Only
-- users are limited; fixtures and imports by the service role are not.
create or replace function private.guard_plan_limit()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_owner uuid;
  p public.plans;
  usage jsonb;
  v_kind text := case tg_table_name when 'beds' then 'beds' when 'hostels' then 'hostels' else 'staff' end;
  v_limit integer;
begin
  if coalesce((select auth.role()), '') <> 'authenticated' then
    return new;
  end if;
  -- Columns are read through jsonb: not every table has them.
  if tg_op = 'UPDATE' and not (to_jsonb(old) ->> 'archived_at' is not null and to_jsonb(new) ->> 'archived_at' is null) then
    return new;
  end if;
  v_owner := case when tg_table_name = 'hostels' then (to_jsonb(new) ->> 'owner_id')::uuid
                  else (select h.owner_id from public.hostels h where h.id = (to_jsonb(new) ->> 'hostel_id')::uuid) end;
  perform pg_advisory_xact_lock(hashtextextended('plan-limit:' || v_owner::text, 0));
  select pl.* into p from public.subscriptions s join public.plans pl on pl.id = s.plan_id where s.owner_id = v_owner;
  if not found then
    return new;
  end if;
  v_limit := case v_kind when 'beds' then p.max_beds when 'hostels' then p.max_hostels else p.max_staff end;
  if v_limit is null then
    return new;
  end if;
  usage := private.account_usage(v_owner);
  -- The row being inserted is not counted yet (BEFORE trigger).
  if (usage ->> v_kind)::integer + 1 > v_limit then
    raise exception 'Your % plan allows % %. Choose a bigger plan to add more.',
      p.name, v_limit, case v_kind when 'staff' then 'staff accounts' else v_kind end
      using errcode = 'P0001', hint = 'plan_limit';
  end if;
  return new;
end;
$$;

create trigger guard_plan_limit
  before insert or update of archived_at on public.beds
  for each row execute function private.guard_plan_limit();
create trigger guard_plan_limit
  before insert on public.hostels
  for each row execute function private.guard_plan_limit();
create trigger guard_plan_limit
  before insert on public.staff_invitations
  for each row execute function private.guard_plan_limit();

-- ---------------------------------------------------------------------------
-- Read-only mode (T9)
-- ---------------------------------------------------------------------------
-- Refuses a user's write to a hostel whose owner's account cannot write.
-- Applies inside the app's functions too (they run for the same user).
-- Platform admins, the service role and the job link are not limited, and a
-- resident's data can still be erased on request.
create or replace function private.guard_account_writable()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row jsonb := to_jsonb(coalesce(new, old));
  v_hostel uuid := (v_row ->> 'hostel_id')::uuid;
begin
  if coalesce((select auth.role()), '') <> 'authenticated' or v_hostel is null then
    return coalesce(new, old);
  end if;
  if tg_table_name = 'residents' and tg_op = 'UPDATE'
     and v_row ->> 'erased_at' is not null and to_jsonb(old) ->> 'erased_at' is null then
    return new;
  end if;
  if exists (select 1 from public.profiles p where p.id = (select auth.uid()) and p.role = 'platform_admin') then
    return coalesce(new, old);
  end if;
  if not private.account_can_write((select h.owner_id from public.hostels h where h.id = v_hostel)) then
    raise exception 'This account is read-only. Choose a plan to make changes again.'
      using errcode = 'P0001', hint = 'account_read_only';
  end if;
  return coalesce(new, old);
end;
$$;

do $$
declare
  t text;
begin
  foreach t in array array[
    'rooms', 'beds', 'residents', 'allocations', 'invoices', 'invoice_lines', 'payments',
    'deposit_entries', 'deposit_rates', 'resident_credit_entries', 'resident_charges',
    'resident_discounts', 'fee_structures', 'fee_heads', 'fee_head_prices',
    'allocation_fee_opt_outs', 'room_meter_readings', 'electricity_bills', 'staff_invitations',
    'reminder_log', 'settlements', 'complaints', 'complaint_costs', 'complaint_payouts',
    'complaint_attachments', 'maintenance_schedules', 'complaint_categories'
  ] loop
    if exists (select 1 from information_schema.columns c
                where c.table_schema = 'public' and c.table_name = t and c.column_name = 'hostel_id') then
      -- "aa_" so it runs before the table's other BEFORE triggers.
      execute format(
        'create trigger aa_account_writable before insert or update or delete on public.%I
           for each row execute function private.guard_account_writable()', t);
    end if;
  end loop;
end;
$$;

-- For writes the app makes with the service role (staff invitations send an
-- email through the auth admin API): the same two rules, checked first with
-- the user's own session. Raises like the triggers do.
create or replace function private.check_account_can_add(p_hostel_id uuid, p_kind text)
returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_owner uuid;
  p public.plans;
  v_limit integer;
begin
  if p_hostel_id is null or p_hostel_id not in (select private.user_owned_hostel_ids()) then
    raise exception 'Hostel not found' using errcode = 'P0001', hint = 'hostel_not_found';
  end if;
  select h.owner_id into v_owner from public.hostels h where h.id = p_hostel_id;
  if not private.account_can_write(v_owner) then
    raise exception 'This account is read-only. Choose a plan to make changes again.'
      using errcode = 'P0001', hint = 'account_read_only';
  end if;
  select pl.* into p from public.subscriptions s join public.plans pl on pl.id = s.plan_id where s.owner_id = v_owner;
  v_limit := case p_kind when 'beds' then p.max_beds when 'hostels' then p.max_hostels else p.max_staff end;
  if v_limit is not null and (private.account_usage(v_owner) ->> p_kind)::integer + 1 > v_limit then
    raise exception 'Your % plan allows % %. Choose a bigger plan to add more.',
      p.name, v_limit, case p_kind when 'staff' then 'staff accounts' else p_kind end
      using errcode = 'P0001', hint = 'plan_limit';
  end if;
end;
$$;

create or replace function public.check_account_can_add(p_hostel_id uuid, p_kind text)
returns void
language sql
stable
security invoker
set search_path = ''
as $$ select private.check_account_can_add(p_hostel_id, p_kind); $$;

revoke all on function private.check_account_can_add(uuid, text) from public, anon;
revoke all on function public.check_account_can_add(uuid, text) from public, anon;
grant execute on function private.check_account_can_add(uuid, text) to authenticated;
grant execute on function public.check_account_can_add(uuid, text) to authenticated;

-- ---------------------------------------------------------------------------
-- What the app shows about the account (owner and staff)
-- ---------------------------------------------------------------------------
create or replace function private.account_status(p_hostel_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_owner uuid;
  s record;
begin
  if p_hostel_id is null or p_hostel_id not in (select private.user_hostel_ids()) then
    return null;
  end if;
  select h.owner_id into v_owner from public.hostels h where h.id = p_hostel_id;
  select sub.*, pl.name as plan_name, pl.max_beds, pl.max_hostels, pl.max_staff, pl.monthly_price
    into s
    from public.subscriptions sub join public.plans pl on pl.id = sub.plan_id
   where sub.owner_id = v_owner;
  if not found then
    return jsonb_build_object('can_write', true);
  end if;
  return jsonb_build_object(
    'plan_id', s.plan_id,
    'plan_name', s.plan_name,
    'status', s.status,
    'effective_status', private.effective_status(s.status, s.trial_ends_at),
    'trial_ends_at', s.trial_ends_at,
    'current_period_end', s.current_period_end,
    'price_monthly', s.price_monthly,
    'cancel_at_period_end', s.cancel_at_period_end,
    'can_write', private.account_can_write(v_owner),
    'usage', private.account_usage(v_owner),
    'limits', jsonb_build_object('beds', s.max_beds, 'hostels', s.max_hostels, 'staff', s.max_staff)
  );
end;
$$;

create or replace function public.account_status(p_hostel_id uuid)
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$ select private.account_status(p_hostel_id); $$;

revoke all on function private.account_status(uuid) from public, anon;
revoke all on function public.account_status(uuid) from public, anon;
grant execute on function private.account_status(uuid) to authenticated;
grant execute on function public.account_status(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- Admin: plans and subscriptions (T1, T2), audited
-- ---------------------------------------------------------------------------
alter table public.admin_audit_log drop constraint admin_audit_log_action_valid;
alter table public.admin_audit_log
  add constraint admin_audit_log_action_valid check (action in (
    'plan_changed', 'hostel_suspended', 'hostel_restored', 'trial_length_changed',
    'support_view_opened', 'signed_out_everywhere', 'confirmation_resent',
    'password_reset_sent', 'announcement_created', 'announcement_ended',
    'subscription_changed', 'plan_saved'
  ));

create or replace function private.admin_reason_required(p_action text)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select p_action in (
    'plan_changed', 'hostel_suspended', 'hostel_restored', 'support_view_opened',
    'signed_out_everywhere', 'confirmation_resent', 'password_reset_sent',
    'subscription_changed', 'plan_saved'
  );
$$;

-- Sets an owner's plan and status. A downgrade below what they already use
-- is refused with the list of what to remove first.
create or replace function private.admin_set_subscription(
  p_owner_id uuid,
  p_plan_id text,
  p_status text,
  p_trial_ends_at date,
  p_period_end date,
  p_reason text
)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  prev record;
  v_over text[];
  v_price integer;
begin
  perform private.require_platform_admin();
  if nullif(btrim(p_reason), '') is null then
    raise exception 'Say why the subscription is changing' using errcode = 'P0001', hint = 'reason_required';
  end if;
  if p_status not in ('trialing', 'active', 'past_due', 'read_only', 'cancelled') then
    raise exception 'Choose a status' using errcode = 'P0001', hint = 'status_invalid';
  end if;
  if p_status = 'trialing' and p_trial_ends_at is null then
    raise exception 'A trial needs an end date' using errcode = 'P0001', hint = 'trial_end_required';
  end if;
  select monthly_price into v_price from public.plans where id = p_plan_id and active;
  if not found then
    raise exception 'Choose a plan' using errcode = 'P0001', hint = 'plan_invalid';
  end if;
  select * into prev from public.subscriptions where owner_id = p_owner_id for update;
  if not found then
    raise exception 'Owner not found' using errcode = 'P0001', hint = 'owner_not_found';
  end if;
  v_over := private.over_limits(p_owner_id, p_plan_id);
  if cardinality(v_over) > 0 then
    raise exception 'Remove these first: %', array_to_string(v_over, '; ')
      using errcode = 'P0001', hint = 'plan_downgrade';
  end if;
  perform set_config('app.subscription_reason', btrim(p_reason), true);
  update public.subscriptions
     set plan_id = p_plan_id,
         status = p_status,
         trial_ends_at = case when p_status = 'trialing' then p_trial_ends_at else trial_ends_at end,
         current_period_start = case when p_status = 'active' and prev.status <> 'active'
                                     then private.today_ist() else current_period_start end,
         current_period_end = coalesce(p_period_end, current_period_end),
         -- The price is fixed when the plan is given; a plan's later price
         -- change waits for the next renewal.
         price_monthly = case when p_plan_id <> prev.plan_id or prev.status <> 'active' then v_price else price_monthly end
   where owner_id = p_owner_id;
  perform private.admin_audit('subscription_changed', null, p_owner_id, p_reason, jsonb_build_object(
    'from_plan', prev.plan_id, 'to_plan', p_plan_id,
    'from_status', prev.status, 'to_status', p_status,
    'trial_ends_at', p_trial_ends_at, 'period_end', p_period_end));
end;
$$;

create or replace function public.admin_set_subscription(
  p_owner_id uuid,
  p_plan_id text,
  p_status text,
  p_trial_ends_at date default null,
  p_period_end date default null,
  p_reason text default null
)
returns void
language sql
volatile
security invoker
set search_path = ''
as $$ select private.admin_set_subscription(p_owner_id, p_plan_id, p_status, p_trial_ends_at, p_period_end, p_reason); $$;

revoke all on function private.admin_set_subscription(uuid, text, text, date, date, text) from public, anon;
revoke all on function public.admin_set_subscription(uuid, text, text, date, date, text) from public, anon;
grant execute on function private.admin_set_subscription(uuid, text, text, date, date, text) to authenticated;
grant execute on function public.admin_set_subscription(uuid, text, text, date, date, text) to authenticated;

-- The per-hostel plan form (trial, paid, free) now sets the owner's
-- subscription; the hostel columns follow it. Same signature and audit entry.
create or replace function private.admin_set_plan(
  p_hostel_id uuid,
  p_plan text,
  p_trial_ends_at date,
  p_reason text
)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  prev record;
  sub record;
begin
  perform private.require_platform_admin();
  if p_plan not in ('trial', 'paid', 'free') then
    raise exception 'Choose trial, paid or free' using errcode = 'P0001', hint = 'plan_invalid';
  end if;
  if p_plan = 'trial' and p_trial_ends_at is null then
    raise exception 'A trial needs an end date' using errcode = 'P0001', hint = 'trial_end_required';
  end if;
  if nullif(btrim(p_reason), '') is null then
    raise exception 'Say why the plan is changing' using errcode = 'P0001', hint = 'reason_required';
  end if;
  select h.plan, h.trial_ends_at, h.owner_id into prev from public.hostels h where h.id = p_hostel_id for update;
  if not found then
    raise exception 'Hostel not found' using errcode = 'P0001', hint = 'hostel_not_found';
  end if;
  select * into sub from public.subscriptions where owner_id = prev.owner_id for update;
  perform set_config('app.subscription_reason', btrim(p_reason), true);
  update public.subscriptions
     set status = case when p_plan = 'trial' then 'trialing' else 'active' end,
         plan_id = case p_plan
                     when 'free' then 'free'
                     when 'trial' then 'pro'
                     -- "Paid" keeps the owner's paid plan; from a trial or free it is the
                     -- plan without limits, so nobody is cut off by this form.
                     else case when sub.plan_id = 'free' or sub.status = 'trialing' then 'pro' else sub.plan_id end
                   end,
         trial_ends_at = case when p_plan = 'trial' then p_trial_ends_at else trial_ends_at end,
         current_period_start = case when p_plan <> 'trial' and sub.status <> 'active'
                                     then private.today_ist() else current_period_start end
   where owner_id = prev.owner_id;
  -- Hostels created by fixtures may not match yet; this one always does.
  update public.hostels
     set plan = p_plan,
         trial_ends_at = case when p_plan = 'trial' then p_trial_ends_at else trial_ends_at end
   where id = p_hostel_id;
  perform private.admin_audit('plan_changed', p_hostel_id, null, p_reason, jsonb_build_object(
    'from', prev.plan,
    'to', p_plan,
    'trial_ends_at_before', prev.trial_ends_at,
    'trial_ends_at', case when p_plan = 'trial' then p_trial_ends_at else prev.trial_ends_at end
  ));
end;
$$;

-- Edits a plan. A new price applies to subscriptions only from renewal.
create or replace function private.admin_save_plan(
  p_id text,
  p_name text,
  p_monthly_price integer,
  p_yearly_price integer,
  p_pricing_basis text,
  p_max_beds integer,
  p_max_hostels integer,
  p_max_staff integer,
  p_gst_inclusive boolean,
  p_public boolean,
  p_active boolean,
  p_reason text
)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  prev public.plans;
begin
  perform private.require_platform_admin();
  if nullif(btrim(p_reason), '') is null then
    raise exception 'Say why the plan is changing' using errcode = 'P0001', hint = 'reason_required';
  end if;
  select * into prev from public.plans where id = p_id;
  insert into public.plans (id, name, monthly_price, yearly_price, pricing_basis, max_beds, max_hostels,
                            max_staff, gst_inclusive, public, active, position)
  values (p_id, btrim(p_name), p_monthly_price, p_yearly_price, p_pricing_basis, p_max_beds, p_max_hostels,
          p_max_staff, p_gst_inclusive, p_public, p_active,
          coalesce((select max(position) + 1 from public.plans), 0))
  on conflict (id) do update
    set name = excluded.name,
        monthly_price = excluded.monthly_price,
        yearly_price = excluded.yearly_price,
        pricing_basis = excluded.pricing_basis,
        max_beds = excluded.max_beds,
        max_hostels = excluded.max_hostels,
        max_staff = excluded.max_staff,
        gst_inclusive = excluded.gst_inclusive,
        public = excluded.public,
        active = excluded.active,
        updated_at = now();
  perform private.admin_audit('plan_saved', null, null, p_reason, jsonb_build_object(
    'plan', p_id,
    'before', case when prev.id is null then null else to_jsonb(prev) end,
    'monthly_price', p_monthly_price,
    'max_beds', p_max_beds, 'max_hostels', p_max_hostels, 'max_staff', p_max_staff));
end;
$$;

create or replace function public.admin_save_plan(
  p_id text,
  p_name text,
  p_monthly_price integer,
  p_yearly_price integer,
  p_pricing_basis text,
  p_max_beds integer,
  p_max_hostels integer,
  p_max_staff integer,
  p_gst_inclusive boolean,
  p_public boolean,
  p_active boolean,
  p_reason text
)
returns void
language sql
volatile
security invoker
set search_path = ''
as $$
  select private.admin_save_plan(p_id, p_name, p_monthly_price, p_yearly_price, p_pricing_basis, p_max_beds,
                                 p_max_hostels, p_max_staff, p_gst_inclusive, p_public, p_active, p_reason);
$$;

revoke all on function private.admin_save_plan(text, text, integer, integer, text, integer, integer, integer, boolean, boolean, boolean, text) from public, anon;
revoke all on function public.admin_save_plan(text, text, integer, integer, text, integer, integer, integer, boolean, boolean, boolean, text) from public, anon;
grant execute on function private.admin_save_plan(text, text, integer, integer, text, integer, integer, integer, boolean, boolean, boolean, text) to authenticated;
grant execute on function public.admin_save_plan(text, text, integer, integer, text, integer, integer, integer, boolean, boolean, boolean, text) to authenticated;

-- One owner's subscription, for the admin console.
create or replace function private.admin_subscription(p_owner_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform private.require_platform_admin();
  return (
    select jsonb_build_object(
      'plan_id', s.plan_id,
      'status', s.status,
      'effective_status', private.effective_status(s.status, s.trial_ends_at),
      'trial_ends_at', s.trial_ends_at,
      'current_period_start', s.current_period_start,
      'current_period_end', s.current_period_end,
      'price_monthly', s.price_monthly,
      'usage', private.account_usage(s.owner_id),
      'events', coalesce((
        select jsonb_agg(jsonb_build_object(
                 'from_status', e.from_status, 'to_status', e.to_status,
                 'from_plan', e.from_plan, 'to_plan', e.to_plan,
                 'reason', e.reason, 'created_at', e.created_at) order by e.created_at desc)
          from public.subscription_events e where e.owner_id = s.owner_id), '[]'::jsonb)
    )
    from public.subscriptions s where s.owner_id = p_owner_id
  );
end;
$$;

create or replace function public.admin_subscription(p_owner_id uuid)
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$ select private.admin_subscription(p_owner_id); $$;

revoke all on function private.admin_subscription(uuid) from public, anon;
revoke all on function public.admin_subscription(uuid) from public, anon;
grant execute on function private.admin_subscription(uuid) to authenticated;
grant execute on function public.admin_subscription(uuid) to authenticated;

-- Revenue figures (EP-14, on the EP-10 metrics page). Failed payments wait
-- for the gateway; past-due accounts stand in for them.
create or replace function private.admin_revenue()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  month_start date := date_trunc('month', private.today_ist())::date;
  v_mrr bigint;
  v_trialed integer;
  v_converted integer;
  v_cancelled integer;
  v_active_start integer;
begin
  perform private.require_platform_admin();
  select coalesce(sum(s.price_monthly), 0) into v_mrr
    from public.subscriptions s
   where private.effective_status(s.status, s.trial_ends_at) in ('active', 'past_due');
  select count(distinct e.owner_id) into v_trialed from public.subscription_events e where e.to_status = 'trialing';
  select count(distinct e.owner_id) into v_converted
    from public.subscription_events e
   where e.from_status = 'trialing' and e.to_status = 'active' and e.to_plan <> 'free';
  select count(distinct e.owner_id) into v_cancelled
    from public.subscription_events e
   where e.to_status = 'cancelled' and (e.created_at at time zone 'Asia/Kolkata')::date >= month_start;
  select count(*) into v_active_start
    from public.subscriptions s
   where s.status in ('active', 'past_due') or (s.status = 'cancelled' and s.updated_at >= month_start);
  return jsonb_build_object(
    'mrr', v_mrr,
    'arr', v_mrr * 12,
    'by_status', (
      select coalesce(jsonb_object_agg(x.status, x.count), '{}'::jsonb)
        from (select private.effective_status(s.status, s.trial_ends_at) as status, count(*) as count
                from public.subscriptions s group by 1) x),
    'by_plan', (
      select coalesce(jsonb_object_agg(x.plan_id, x.count), '{}'::jsonb)
        from (select s.plan_id, count(*) as count from public.subscriptions s
               where private.effective_status(s.status, s.trial_ends_at) in ('active', 'past_due')
               group by 1) x),
    'trial_to_paid', case when v_trialed > 0 then round(100.0 * v_converted / v_trialed, 1) end,
    'trials_converted', v_converted,
    'trials_started', v_trialed,
    'churn_this_month', case when v_active_start > 0 then round(100.0 * v_cancelled / v_active_start, 1) end,
    'cancelled_this_month', v_cancelled,
    'past_due', (select count(*) from public.subscriptions s where s.status = 'past_due')
  );
end;
$$;

create or replace function public.admin_revenue()
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$ select private.admin_revenue(); $$;

revoke all on function private.admin_revenue() from public, anon;
revoke all on function public.admin_revenue() from public, anon;
grant execute on function private.admin_revenue() to authenticated;
grant execute on function public.admin_revenue() to authenticated;

-- ---------------------------------------------------------------------------
-- Terms accepted at sign-up (T11)
-- ---------------------------------------------------------------------------
alter table public.profiles
  add column terms_version text,
  add column terms_accepted_at timestamptz;

comment on column public.profiles.terms_version is
  'Version of the terms of service and privacy policy accepted at sign-up (EP-14 T11).';

-- Unchanged from 20261019090000, plus the terms version from the sign-up form.
create or replace function private.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  code text := upper(btrim(new.raw_user_meta_data ->> 'referral_code'));
  terms text := left(btrim(new.raw_user_meta_data ->> 'terms_version'), 40);
begin
  insert into public.profiles (id, full_name, role, referred_by, terms_version, terms_accepted_at)
  values (
    new.id,
    coalesce(
      nullif(left(btrim(new.raw_user_meta_data ->> 'full_name'), 120), ''),
      split_part(new.email, '@', 1)
    ),
    'owner',
    (select p.id from public.profiles p
      where code ~ '^[A-HJ-NP-Z2-9]{8}$' and p.referral_code = code and p.role = 'owner'),
    nullif(terms, ''),
    case when nullif(terms, '') is not null then now() end
  );
  return new;
end;
$$;
