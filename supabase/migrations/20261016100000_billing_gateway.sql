-- SaaS subscription billing, part 2 (EP-14 and E10-T7): checkout through the
-- payment gateway, its webhooks, GST invoices from the business to its
-- customers, failed payments and dunning, coupons, plan changes, the
-- owner's billing page, admin adjustments, revenue figures and terms
-- acceptance (E14-T5 to T8, T10 to T12).
--
-- Gateway: Razorpay Subscriptions (docs/billing.md says why). The app talks
-- to Razorpay; the database never does. Webhooks are verified by signature
-- in the app, normalised, and applied here by billing_apply_gateway_event
-- with the service role. Each gateway event id is stored once, so a
-- replayed or duplicated event changes nothing.
--
-- Money is integer paise. Plan prices exclude GST; the gateway charges the
-- price plus GST, and the tax invoice splits what was actually paid.

set check_function_bodies = off;

-- ---------------------------------------------------------------------------
-- Email outbox: billing messages, sent once each
-- ---------------------------------------------------------------------------
alter table public.email_outbox drop constraint email_outbox_kind_valid;
alter table public.email_outbox add constraint email_outbox_kind_valid check (kind in (
  'hostel_suspended', 'hostel_restored',
  'trial_reminder', 'trial_ended', 'payment_failed', 'grace_ending', 'account_read_only',
  'subscription_activated', 'subscription_cancelled', 'billing_invoice', 'billing_credit_note'
));
-- A reminder the billing job may consider every hour is queued at most once.
alter table public.email_outbox add column dedupe_key text;
create unique index email_outbox_dedupe_key on public.email_outbox (dedupe_key) where dedupe_key is not null;

create or replace function private.queue_owner_email(
  p_owner_id uuid,
  p_kind text,
  p_subject text,
  p_body text,
  p_dedupe_key text default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  address text := (select u.email from auth.users u where u.id = p_owner_id);
begin
  if address is null then
    return;
  end if;
  insert into public.email_outbox (to_email, kind, subject, body, dedupe_key)
  values (address, p_kind, p_subject, p_body, p_dedupe_key)
  on conflict (dedupe_key) where dedupe_key is not null do nothing;
end;
$$;

-- ---------------------------------------------------------------------------
-- The owner's business details, for B2B invoices (E14-T6)
-- ---------------------------------------------------------------------------
create table public.billing_profiles (
  owner_id uuid primary key default auth.uid() references public.profiles (id) on delete cascade,
  legal_name text not null,
  gstin text,
  address text not null,
  state_code text not null,
  billing_email text,
  updated_at timestamptz not null default now(),

  constraint billing_profiles_legal_name_length check (char_length(btrim(legal_name)) between 2 and 120),
  constraint billing_profiles_address_length check (char_length(btrim(address)) between 5 and 300),
  constraint billing_profiles_gstin_format check (
    gstin is null or gstin ~ '^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$'
  ),
  constraint billing_profiles_state_format check (state_code ~ '^[0-9]{2}$'),
  -- A GSTIN starts with its state code; the two must agree.
  constraint billing_profiles_gstin_state check (gstin is null or left(gstin, 2) = state_code),
  constraint billing_profiles_email_format check (
    billing_email is null or billing_email ~* '^[^@\s]+@[^@\s]+\.[^@\s]+$'
  )
);

comment on table public.billing_profiles is
  'The business name, GSTIN and address an owner wants on Hostel ERP''s tax invoices to them.';

create trigger billing_profiles_set_updated_at
  before update on public.billing_profiles
  for each row execute function private.set_updated_at();

-- ---------------------------------------------------------------------------
-- Coupons (E14-T10)
-- ---------------------------------------------------------------------------
-- Applied through the gateway as a Razorpay offer, so the gateway's charge
-- and our invoice always agree: a coupon without gateway_offer_id cannot be
-- redeemed online.
create table public.coupons (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  description text,
  percent_off integer,
  amount_off integer,
  duration text not null,
  duration_cycles integer,
  max_redemptions integer,
  redeem_by timestamptz,
  gateway_offer_id text,
  active boolean not null default true,
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),

  constraint coupons_code_format check (code ~ '^[A-Z0-9][A-Z0-9_-]{2,29}$'),
  constraint coupons_description_length check (char_length(description) <= 200),
  constraint coupons_one_discount check ((percent_off is null) <> (amount_off is null)),
  constraint coupons_percent_range check (percent_off is null or percent_off between 1 and 100),
  constraint coupons_amount_positive check (amount_off is null or amount_off > 0),
  constraint coupons_duration_valid check (duration in ('once', 'repeating', 'forever')),
  constraint coupons_cycles check ((duration = 'repeating') = (duration_cycles is not null)),
  constraint coupons_cycles_range check (duration_cycles is null or duration_cycles between 1 and 36),
  constraint coupons_max_redemptions_positive check (max_redemptions is null or max_redemptions >= 1)
);

comment on table public.coupons is
  'Launch and partner discounts, created by admins and applied through the gateway.';

create table public.coupon_redemptions (
  id uuid primary key default gen_random_uuid(),
  coupon_id uuid not null references public.coupons (id),
  owner_id uuid not null,
  subscription_id uuid not null,
  gateway_subscription_id text,
  created_at timestamptz not null default now(),
  constraint coupon_redemptions_once_per_owner unique (coupon_id, owner_id)
);

alter table public.subscriptions
  add constraint subscriptions_coupon_fkey foreign key (coupon_id) references public.coupons (id),
  add constraint subscriptions_checkout_coupon_fkey foreign key (checkout_coupon_id) references public.coupons (id);

-- ---------------------------------------------------------------------------
-- Gateway plans and events (E14-T5)
-- ---------------------------------------------------------------------------
-- Razorpay charges a fixed amount per plan, so each (plan, interval, amount
-- including GST) gets its own gateway plan, created on first use by the app.
create table public.gateway_plans (
  plan_id uuid not null references public.plans (id),
  billing_interval text not null,
  amount integer not null,
  gateway_plan_id text not null unique,
  created_at timestamptz not null default now(),
  primary key (plan_id, billing_interval, amount),
  constraint gateway_plans_interval_valid check (billing_interval in ('month', 'year')),
  constraint gateway_plans_amount_positive check (amount > 0)
);

comment on table public.gateway_plans is
  'Razorpay plan ids for each (plan, interval, amount including GST), created on first checkout.';

create table public.billing_gateway_events (
  event_id text primary key,
  event_type text not null,
  kind text not null,
  gateway_subscription_id text,
  result text not null,
  received_at timestamptz not null default now()
);

comment on table public.billing_gateway_events is
  'Every gateway webhook applied, by its event id, so a replay changes nothing.';

create index billing_gateway_events_received_idx on public.billing_gateway_events (received_at desc);

-- ---------------------------------------------------------------------------
-- Tax invoices and credit notes from the business (E14-T6)
-- ---------------------------------------------------------------------------
-- Numbered in one series per financial year (April to March, India time):
-- HE/26-27/00001 for invoices and HC/26-27/00001 for credit notes, at most
-- 16 characters as GST requires. Seller and buyer details are snapshots:
-- an issued invoice never changes, even if either side's details do.
create table public.platform_invoice_counters (
  series text not null,
  financial_year text not null,
  last_number integer not null default 0,
  primary key (series, financial_year)
);

create table public.platform_invoices (
  id uuid primary key default gen_random_uuid(),
  kind text not null,
  number text not null unique,
  financial_year text not null,
  -- Plain values: tax records outlive a closed account (8 years under GST).
  owner_id uuid not null,
  subscription_id uuid not null,
  original_invoice_id uuid references public.platform_invoices (id),
  gateway_payment_id text,
  gateway_refund_id text,
  issued_at timestamptz not null default now(),
  period_start timestamptz,
  period_end timestamptz,
  description text not null,
  seller jsonb not null,
  buyer jsonb not null,
  sac_code text not null,
  place_of_supply text,
  gst_rate_bps integer not null,
  taxable_value integer not null,
  cgst integer not null default 0,
  sgst integer not null default 0,
  igst integer not null default 0,
  total integer not null,

  constraint platform_invoices_kind_valid check (kind in ('invoice', 'credit_note')),
  constraint platform_invoices_credit_note_has_original check (
    (kind = 'credit_note') = (original_invoice_id is not null)
  ),
  constraint platform_invoices_amounts check (
    taxable_value >= 0 and cgst >= 0 and sgst >= 0 and igst >= 0
    and total = taxable_value + cgst + sgst + igst
  ),
  constraint platform_invoices_tax_split check (igst = 0 or (cgst = 0 and sgst = 0))
);

comment on table public.platform_invoices is
  'GST tax invoices and credit notes from Hostel ERP to its customers. Immutable.';

create unique index platform_invoices_payment_once
  on public.platform_invoices (gateway_payment_id) where kind = 'invoice';
create unique index platform_invoices_refund_once
  on public.platform_invoices (gateway_refund_id) where kind = 'credit_note';
create index platform_invoices_owner_idx on public.platform_invoices (owner_id, issued_at desc);

create or replace function private.platform_invoices_immutable()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  raise exception 'An issued tax invoice cannot be changed; issue a credit note'
    using errcode = 'P0001', hint = 'history_immutable';
end;
$$;

create trigger platform_invoices_immutable
  before update or delete on public.platform_invoices
  for each row execute function private.platform_invoices_immutable();

create or replace function private.financial_year(p_at timestamptz)
returns text
language sql
immutable
set search_path = ''
as $$
  with d as (select (p_at at time zone 'Asia/Kolkata')::date as day)
  select to_char(make_date(y, 1, 1), 'YY') || '-' || to_char(make_date(y + 1, 1, 1), 'YY')
    from (select case when extract(month from day) >= 4 then extract(year from day)::integer
                      else extract(year from day)::integer - 1 end as y from d) x;
$$;

create or replace function private.next_platform_invoice_number(p_series text, p_financial_year text)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  next_number integer;
begin
  insert into public.platform_invoice_counters as c (series, financial_year, last_number)
  values (p_series, p_financial_year, 1)
  on conflict (series, financial_year) do update set last_number = c.last_number + 1
  returning last_number into next_number;
  return p_series || '/' || p_financial_year || '/' || lpad(next_number::text, 5, '0');
end;
$$;

-- GST included in a total: taxable value and the tax split by place of supply.
create or replace function private.gst_split(
  p_total integer,
  p_rate_bps integer,
  p_place_of_supply text,
  p_seller_state text
)
returns table (taxable_value integer, cgst integer, sgst integer, igst integer)
language plpgsql
immutable
set search_path = ''
as $$
declare
  taxable integer := round(p_total::numeric * 10000 / (10000 + p_rate_bps));
  tax integer := p_total - taxable;
begin
  if p_seller_state is not null and p_place_of_supply = p_seller_state then
    return query select taxable, tax / 2, tax - tax / 2, 0;
  else
    return query select taxable, 0, 0, tax;
  end if;
end;
$$;

-- Price plus GST: what the gateway charges for one period.
create or replace function private.with_gst(p_amount integer)
returns integer
language sql
stable
security definer
set search_path = ''
as $$
  select round(p_amount::numeric * (10000 + b.gst_rate_bps) / 10000)::integer
    from public.billing_settings b;
$$;

create or replace function private.issue_platform_invoice(
  p_subscription_id uuid,
  p_payment_id text,
  p_total integer,
  p_period_start timestamptz,
  p_period_end timestamptz
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  existing uuid;
  s public.subscriptions;
  plan public.plans;
  settings public.billing_settings;
  profile public.billing_profiles;
  owner_email text;
  place text;
  split record;
  fy text := private.financial_year(now());
  created uuid;
  invoice_number text;
begin
  select i.id into existing from public.platform_invoices i
   where i.gateway_payment_id = p_payment_id and i.kind = 'invoice';
  if existing is not null then
    return existing;
  end if;

  select * into s from public.subscriptions where id = p_subscription_id;
  select * into plan from public.plans where id = s.plan_id;
  select * into settings from public.billing_settings;
  select * into profile from public.billing_profiles where owner_id = s.owner_id;
  select u.email into owner_email from auth.users u where u.id = s.owner_id;
  place := coalesce(profile.state_code, settings.seller_state_code);
  select * into split from private.gst_split(p_total, settings.gst_rate_bps, place, settings.seller_state_code);
  invoice_number := private.next_platform_invoice_number('HE', fy);

  insert into public.platform_invoices
    (kind, number, financial_year, owner_id, subscription_id, gateway_payment_id, period_start,
     period_end, description, seller, buyer, sac_code, place_of_supply, gst_rate_bps,
     taxable_value, cgst, sgst, igst, total)
  values (
    'invoice', invoice_number, fy, s.owner_id, s.id, p_payment_id, p_period_start, p_period_end,
    'Hostel ERP ' || plan.name || ' plan, ' || case s.billing_interval when 'year' then 'annual' else 'monthly' end
      || ' subscription',
    jsonb_build_object('legal_name', settings.seller_legal_name, 'address', settings.seller_address,
                       'gstin', settings.seller_gstin, 'state_code', settings.seller_state_code,
                       'email', settings.seller_email),
    jsonb_build_object('legal_name', coalesce(profile.legal_name,
                                              (select pr.full_name from public.profiles pr where pr.id = s.owner_id)),
                       'gstin', profile.gstin, 'address', profile.address,
                       'state_code', profile.state_code,
                       'email', coalesce(profile.billing_email, owner_email)),
    settings.sac_code, place, settings.gst_rate_bps,
    split.taxable_value, split.cgst, split.sgst, split.igst, p_total
  )
  returning id into created;

  perform private.queue_owner_email(
    s.owner_id, 'billing_invoice',
    'Your Hostel ERP invoice ' || invoice_number,
    'Thank you for your payment of Rs ' || to_char(p_total / 100.0, 'FM99,99,99,990.00')
    || '. Your tax invoice ' || invoice_number || ' is ready to download under Settings, Billing.',
    'billing_invoice:' || created
  );
  return created;
end;
$$;

create or replace function private.issue_platform_credit_note(
  p_payment_id text,
  p_refund_id text,
  p_amount integer
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  existing uuid;
  original public.platform_invoices;
  split record;
  fy text := private.financial_year(now());
  created uuid;
  note_number text;
  amount integer;
begin
  select i.id into existing from public.platform_invoices i
   where i.gateway_refund_id = p_refund_id and i.kind = 'credit_note';
  if existing is not null then
    return existing;
  end if;
  select * into original from public.platform_invoices i
   where i.gateway_payment_id = p_payment_id and i.kind = 'invoice';
  if original.id is null then
    return null;
  end if;

  -- Never credit more than is left on the invoice.
  amount := least(p_amount, original.total - coalesce((
    select sum(c.total) from public.platform_invoices c where c.original_invoice_id = original.id
  ), 0));
  if amount <= 0 then
    return null;
  end if;

  select * into split from private.gst_split(amount, original.gst_rate_bps, original.place_of_supply,
                                             original.seller ->> 'state_code');
  note_number := private.next_platform_invoice_number('HC', fy);
  insert into public.platform_invoices
    (kind, number, financial_year, owner_id, subscription_id, original_invoice_id, gateway_payment_id,
     gateway_refund_id, period_start, period_end, description, seller, buyer, sac_code,
     place_of_supply, gst_rate_bps, taxable_value, cgst, sgst, igst, total)
  values (
    'credit_note', note_number, fy, original.owner_id, original.subscription_id, original.id,
    p_payment_id, p_refund_id, original.period_start, original.period_end,
    'Refund against invoice ' || original.number, original.seller, original.buyer,
    original.sac_code, original.place_of_supply, original.gst_rate_bps,
    split.taxable_value, split.cgst, split.sgst, split.igst, amount
  )
  returning id into created;

  perform private.queue_owner_email(
    original.owner_id, 'billing_credit_note',
    'Credit note ' || note_number || ' from Hostel ERP',
    'We have refunded Rs ' || to_char(amount / 100.0, 'FM99,99,99,990.00') || ' against invoice '
    || original.number || '. The credit note ' || note_number || ' is under Settings, Billing.',
    'billing_credit_note:' || created
  );
  return created;
end;
$$;

-- ---------------------------------------------------------------------------
-- Owner functions: the billing page (E14-T8)
-- ---------------------------------------------------------------------------
create or replace function private.require_owner_account()
returns uuid
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if private.current_user_role() is distinct from 'owner' then
    raise exception 'Only the owner can manage billing' using errcode = '42501';
  end if;
  return auth.uid();
end;
$$;

create or replace function private.plan_offer(p_plan public.plans, p_beds integer)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'id', p_plan.id, 'code', p_plan.code, 'name', p_plan.name, 'description', p_plan.description,
    'pricing_basis', p_plan.pricing_basis, 'monthly_price', p_plan.monthly_price,
    'annual_price', p_plan.annual_price, 'minimum_beds', p_plan.minimum_beds, 'tiers', p_plan.tiers,
    'max_beds', p_plan.max_beds, 'max_hostels', p_plan.max_hostels, 'max_staff', p_plan.max_staff,
    'features', to_jsonb(p_plan.features),
    'month_amount', private.plan_amount(p_plan.id, 'month', p_beds),
    'year_amount', private.plan_amount(p_plan.id, 'year', p_beds)
  );
$$;

create or replace function public.billing_overview()
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
  select private.billing_overview();
$$;

create or replace function private.billing_overview()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  owner uuid := private.require_owner_account();
  s public.subscriptions;
  usage jsonb := private.account_usage(owner);
  beds integer := (usage ->> 'beds')::integer;
  settings public.billing_settings;
begin
  select * into s from public.subscriptions where owner_id = owner;
  select * into settings from public.billing_settings;
  if s.id is null then
    return null;
  end if;
  return jsonb_build_object(
    'subscription', jsonb_build_object(
      'id', s.id, 'status', s.status, 'billing_interval', s.billing_interval,
      'trial_ends_at', s.trial_ends_at, 'current_period_start', s.current_period_start,
      'current_period_end', s.current_period_end, 'amount', s.amount,
      'amount_with_gst', private.with_gst(s.amount),
      'cancel_at_period_end', s.cancel_at_period_end, 'cancel_reason', s.cancel_reason,
      'past_due_since', s.past_due_since, 'complimentary', s.complimentary,
      'has_gateway', s.gateway_subscription_id is not null,
      'pending_plan', (select p.name from public.plans p where p.id = s.pending_plan_id),
      'pending_interval', s.pending_interval,
      'checkout_started_at', s.checkout_started_at,
      'can_write', private.account_can_write(owner),
      'grace_ends_at', case when s.status = 'past_due'
                            then s.past_due_since + make_interval(days => settings.grace_days) end
    ),
    'plan', private.plan_offer((select p from public.plans p where p.id = s.plan_id), beds),
    'usage', usage,
    'plans', coalesce((
      select jsonb_agg(private.plan_offer(p, beds) order by p.sort_order, p.name)
        from public.plans p where p.is_public and p.is_active
    ), '[]'::jsonb),
    'gst_rate_bps', settings.gst_rate_bps,
    'grace_days', settings.grace_days,
    'profile', (select to_jsonb(b) - 'owner_id' from public.billing_profiles b where b.owner_id = owner),
    'invoices', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', i.id, 'kind', i.kind, 'number', i.number, 'issued_at', i.issued_at,
        'description', i.description, 'total', i.total
      ) order by i.issued_at desc)
        from public.platform_invoices i where i.owner_id = owner
    ), '[]'::jsonb),
    'history', coalesce((
      select jsonb_agg(to_jsonb(x) order by x.created_at desc)
        from (select e.created_at, e.source, e.from_status, e.to_status,
                     (select p.name from public.plans p where p.id = e.to_plan_id) as plan, e.reason
                from public.subscription_events e
               where e.owner_id = owner
               order by e.created_at desc limit 20) x
    ), '[]'::jsonb)
  );
end;
$$;

-- Validates a checkout and records what is being bought. Returns what the
-- app needs to create the gateway subscription. Nothing changes status
-- until the gateway confirms (billing_apply_gateway_event).
create or replace function public.billing_prepare_checkout(
  p_plan_code text,
  p_interval text,
  p_coupon_code text default null
)
returns jsonb
language sql
security invoker
set search_path = ''
as $$
  select private.billing_prepare_checkout(p_plan_code, p_interval, p_coupon_code);
$$;

create or replace function private.billing_prepare_checkout(
  p_plan_code text,
  p_interval text,
  p_coupon_code text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  owner uuid := private.require_owner_account();
  s public.subscriptions;
  plan public.plans;
  coupon public.coupons;
  violations jsonb;
  beds integer := (private.account_usage(owner) ->> 'beds')::integer;
  price integer;
begin
  select * into s from public.subscriptions where owner_id = owner for update;
  if s.id is null then
    raise exception 'Create your hostel first' using errcode = 'P0001', hint = 'no_subscription';
  end if;
  if s.status in ('active', 'past_due') and s.gateway_subscription_id is not null
     and not s.cancel_at_period_end then
    raise exception 'You already have a paid plan; change it instead'
      using errcode = 'P0001', hint = 'already_subscribed';
  end if;

  select * into plan from public.plans p
   where p.code = p_plan_code and p.is_public and p.is_active;
  if plan.id is null then
    raise exception 'That plan is not available' using errcode = 'P0001', hint = 'plan_not_found';
  end if;
  if p_interval not in ('month', 'year') then
    raise exception 'Unknown billing interval' using errcode = 'P0001', hint = 'billing_interval';
  end if;

  violations := private.plan_violations(owner, plan.id);
  if jsonb_array_length(violations) > 0 then
    raise exception 'Your account is larger than this plan allows'
      using errcode = 'P0001', hint = 'plan_too_small', detail = violations::text;
  end if;

  price := private.plan_amount(plan.id, p_interval, beds);
  if price is null or price <= 0 then
    raise exception 'That plan cannot be bought online' using errcode = 'P0001', hint = 'plan_not_found';
  end if;

  if nullif(btrim(p_coupon_code), '') is not null then
    select * into coupon from public.coupons c where c.code = upper(btrim(p_coupon_code));
    if coupon.id is null or not coupon.active
       or (coupon.redeem_by is not null and coupon.redeem_by < now())
       or (coupon.max_redemptions is not null
           and (select count(*) from public.coupon_redemptions r where r.coupon_id = coupon.id)
               >= coupon.max_redemptions) then
      raise exception 'That coupon is not valid' using errcode = 'P0001', hint = 'coupon_invalid';
    end if;
    if exists (select 1 from public.coupon_redemptions r
                where r.coupon_id = coupon.id and r.owner_id = owner) then
      raise exception 'You have already used that coupon' using errcode = 'P0001', hint = 'coupon_used';
    end if;
    if coupon.gateway_offer_id is null then
      raise exception 'That coupon cannot be used for online payment yet'
        using errcode = 'P0001', hint = 'coupon_not_online';
    end if;
  end if;

  perform private.billing_source('owner', null);
  update public.subscriptions
     set checkout_plan_id = plan.id, checkout_interval = p_interval,
         checkout_coupon_id = coupon.id, checkout_started_at = now()
   where id = s.id;

  return jsonb_build_object(
    'subscription_id', s.id,
    'plan_id', plan.id,
    'plan_code', plan.code,
    'plan_name', plan.name,
    'interval', p_interval,
    'amount', price,
    'amount_with_gst', private.with_gst(price),
    'gateway_plan_id', (select g.gateway_plan_id from public.gateway_plans g
                         where g.plan_id = plan.id and g.billing_interval = p_interval
                           and g.amount = private.with_gst(price)),
    'offer_id', coupon.gateway_offer_id,
    'coupon_code', coupon.code,
    'owner_email', (select u.email from auth.users u where u.id = owner),
    'owner_name', (select p.full_name from public.profiles p where p.id = owner),
    'owner_phone', (select p.phone from public.profiles p where p.id = owner)
  );
end;
$$;

-- What a plan change would do, for the owner to confirm (E14-T8):
-- an upgrade (dearer per period) takes effect now with the unused part of
-- this period credited; a downgrade or a monthly/annual switch waits for
-- the next renewal. A plan the account does not fit is refused with what
-- must be removed first (E14-T4).
create or replace function public.billing_quote_change(p_plan_code text, p_interval text)
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
  select private.billing_quote_change(p_plan_code, p_interval);
$$;

create or replace function private.billing_quote_change(p_plan_code text, p_interval text)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  owner uuid := private.require_owner_account();
  s public.subscriptions;
  plan public.plans;
  violations jsonb;
  beds integer := (private.account_usage(owner) ->> 'beds')::integer;
  new_amount integer;
  old_monthly numeric;
  new_monthly numeric;
  remaining numeric;
  effect text;
  proration integer := 0;
begin
  select * into s from public.subscriptions where owner_id = owner;
  if s.id is null or s.status not in ('active', 'past_due') or s.gateway_subscription_id is null then
    raise exception 'Choose a plan first' using errcode = 'P0001', hint = 'no_paid_plan';
  end if;
  select * into plan from public.plans p where p.code = p_plan_code and p.is_public and p.is_active;
  if plan.id is null or p_interval not in ('month', 'year') then
    raise exception 'That plan is not available' using errcode = 'P0001', hint = 'plan_not_found';
  end if;
  if plan.id = s.plan_id and p_interval = s.billing_interval then
    raise exception 'You are already on this plan' using errcode = 'P0001', hint = 'plan_unchanged';
  end if;

  violations := private.plan_violations(owner, plan.id);
  if jsonb_array_length(violations) > 0 then
    raise exception 'Your account is larger than this plan allows'
      using errcode = 'P0001', hint = 'plan_too_small', detail = violations::text;
  end if;

  new_amount := private.plan_amount(plan.id, p_interval, beds);
  old_monthly := s.amount::numeric / case s.billing_interval when 'year' then 12 else 1 end;
  new_monthly := new_amount::numeric / case p_interval when 'year' then 12 else 1 end;

  if p_interval = s.billing_interval and new_monthly > old_monthly then
    effect := 'now';
    if s.current_period_end is not null and s.current_period_start is not null
       and s.current_period_end > now() then
      remaining := extract(epoch from s.current_period_end - now())
                   / extract(epoch from s.current_period_end - s.current_period_start);
      proration := round((new_amount - s.amount) * remaining);
    end if;
  else
    effect := 'renewal';
  end if;

  return jsonb_build_object(
    'plan_id', plan.id, 'plan_code', plan.code, 'plan_name', plan.name, 'interval', p_interval,
    'amount', new_amount, 'amount_with_gst', private.with_gst(new_amount),
    'effect', effect, 'proration', proration,
    'proration_with_gst', private.with_gst(proration),
    'effective_at', case effect when 'now' then now() else s.current_period_end end,
    'gateway_subscription_id', s.gateway_subscription_id,
    'gateway_plan_id', (select g.gateway_plan_id from public.gateway_plans g
                         where g.plan_id = plan.id and g.billing_interval = p_interval
                           and g.amount = private.with_gst(new_amount))
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- Service-role functions: called by the app after it has talked to the
-- gateway, never by a browser
-- ---------------------------------------------------------------------------
create or replace function private.billing_record_gateway_plan(
  p_plan_id uuid,
  p_interval text,
  p_amount integer,
  p_gateway_plan_id text
)
returns void
language sql
security definer
set search_path = ''
as $$
  insert into public.gateway_plans (plan_id, billing_interval, amount, gateway_plan_id)
  values (p_plan_id, p_interval, p_amount, p_gateway_plan_id)
  on conflict (plan_id, billing_interval, amount) do nothing;
$$;

create or replace function private.billing_attach_checkout(
  p_subscription_id uuid,
  p_gateway_subscription_id text,
  p_gateway_customer_id text,
  p_gateway_plan_id text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.billing_source('owner', 'Checkout started');
  update public.subscriptions
     set gateway = 'razorpay',
         gateway_subscription_id = p_gateway_subscription_id,
         gateway_plan_id = p_gateway_plan_id,
         gateway_customer_id = coalesce(p_gateway_customer_id, gateway_customer_id)
   where id = p_subscription_id and checkout_plan_id is not null;
  if not found then
    raise exception 'No checkout in progress' using errcode = 'P0001', hint = 'no_checkout';
  end if;
end;
$$;

-- Records a plan change the gateway has accepted.
create or replace function private.billing_apply_plan_change(
  p_owner_id uuid,
  p_plan_id uuid,
  p_interval text,
  p_effect text,
  p_gateway_plan_id text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  beds integer := (private.account_usage(p_owner_id) ->> 'beds')::integer;
begin
  perform private.billing_source('owner',
    case p_effect when 'now' then 'Upgraded' else 'Plan change at renewal' end);
  if p_effect = 'now' then
    update public.subscriptions
       set plan_id = p_plan_id, billing_interval = p_interval,
           amount = private.plan_amount(p_plan_id, p_interval, beds),
           pending_plan_id = null, pending_interval = null,
           gateway_plan_id = p_gateway_plan_id
     where owner_id = p_owner_id;
  else
    update public.subscriptions
       set pending_plan_id = p_plan_id, pending_interval = p_interval,
           gateway_plan_id = p_gateway_plan_id
     where owner_id = p_owner_id;
  end if;
end;
$$;

create or replace function private.billing_mark_cancel(p_owner_id uuid, p_reason text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.billing_source('owner', p_reason);
  update public.subscriptions
     set cancel_at_period_end = true, cancel_reason = left(btrim(p_reason), 500),
         pending_plan_id = null, pending_interval = null
   where owner_id = p_owner_id and status in ('active', 'past_due');
  if not found then
    raise exception 'There is no paid plan to cancel' using errcode = 'P0001', hint = 'no_paid_plan';
  end if;
end;
$$;

-- Owner-side check before the app cancels at the gateway: returns the
-- gateway subscription id to cancel.
create or replace function public.billing_cancel_target()
returns text
language sql
stable
security invoker
set search_path = ''
as $$
  select private.billing_cancel_target();
$$;

create or replace function private.billing_cancel_target()
returns text
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  owner uuid := private.require_owner_account();
  s public.subscriptions;
begin
  select * into s from public.subscriptions where owner_id = owner;
  if s.id is null or s.status not in ('active', 'past_due') or s.gateway_subscription_id is null
     or s.cancel_at_period_end then
    raise exception 'There is no paid plan to cancel' using errcode = 'P0001', hint = 'no_paid_plan';
  end if;
  return s.gateway_subscription_id;
end;
$$;

-- Applies one verified gateway webhook (E14-T5, T6, T7). p_data is the
-- event normalised by the app (src/features/billing/razorpay-events.ts):
--   subscription_id, customer_id, status, current_start, current_end,
--   payment {id, amount}, refund {id, payment_id, amount}
-- Returns what happened: 'applied', 'duplicate', 'ignored' or
-- 'unknown_subscription'.
create or replace function private.billing_apply_gateway_event(
  p_event_id text,
  p_event_type text,
  p_kind text,
  p_data jsonb
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  gateway_sub text := p_data ->> 'subscription_id';
  s public.subscriptions;
  settings public.billing_settings;
  period_start timestamptz := (p_data ->> 'current_start')::timestamptz;
  period_end timestamptz := (p_data ->> 'current_end')::timestamptz;
  beds integer;
  outcome text := 'applied';
  is_renewal boolean;
  next_plan uuid;
  next_interval text;
begin
  insert into public.billing_gateway_events (event_id, event_type, kind, gateway_subscription_id, result)
  values (p_event_id, p_event_type, p_kind, gateway_sub, 'pending')
  on conflict (event_id) do nothing;
  if not found then
    return 'duplicate';
  end if;

  if p_kind = 'refunded' then
    if private.issue_platform_credit_note(p_data -> 'refund' ->> 'payment_id', p_data -> 'refund' ->> 'id',
                                          (p_data -> 'refund' ->> 'amount')::integer) is null then
      outcome := 'ignored';
    end if;
    update public.billing_gateway_events set result = outcome where event_id = p_event_id;
    return outcome;
  end if;

  select * into s from public.subscriptions where gateway_subscription_id = gateway_sub for update;
  if s.id is null then
    update public.billing_gateway_events set result = 'unknown_subscription' where event_id = p_event_id;
    return 'unknown_subscription';
  end if;
  select * into settings from public.billing_settings;
  beds := (private.account_usage(s.owner_id) ->> 'beds')::integer;
  perform private.billing_source('gateway', p_event_type);

  if p_kind in ('activated', 'charged') then
    -- A checkout completing: the plan being bought becomes the plan.
    if s.checkout_plan_id is not null then
      update public.subscriptions
         set plan_id = s.checkout_plan_id, billing_interval = s.checkout_interval,
             amount = private.plan_amount(s.checkout_plan_id, s.checkout_interval, beds),
             coupon_id = s.checkout_coupon_id,
             coupon_cycles_left = (select c.duration_cycles from public.coupons c where c.id = s.checkout_coupon_id),
             checkout_plan_id = null, checkout_interval = null, checkout_coupon_id = null,
             checkout_started_at = null, complimentary = false
       where id = s.id;
      if s.checkout_coupon_id is not null then
        insert into public.coupon_redemptions (coupon_id, owner_id, subscription_id, gateway_subscription_id)
        values (s.checkout_coupon_id, s.owner_id, s.id, gateway_sub)
        on conflict (coupon_id, owner_id) do nothing;
      end if;
      perform private.queue_owner_email(
        s.owner_id, 'subscription_activated', 'Your Hostel ERP plan is active',
        'Thank you. Your plan is active and you have full access. Invoices appear under Settings, Billing.',
        'subscription_activated:' || gateway_sub
      );
    end if;

    select * into s from public.subscriptions where id = s.id;
    is_renewal := period_start is not null and s.current_period_end is not null
                  and period_start >= s.current_period_end;
    next_plan := case when is_renewal then coalesce(s.pending_plan_id, s.plan_id) else s.plan_id end;
    next_interval := case when is_renewal then coalesce(s.pending_interval, s.billing_interval)
                          else s.billing_interval end;

    update public.subscriptions
       set status = 'active',
           past_due_since = null,
           trial_ends_at = case when status = 'trialing' then trial_ends_at else trial_ends_at end,
           current_period_start = case when period_start is not null
                                        and (current_period_start is null or period_start >= current_period_start)
                                       then period_start else current_period_start end,
           current_period_end = case when period_end is not null
                                      and (current_period_end is null or period_end >= current_period_end
                                           or status <> 'active')
                                     then period_end else current_period_end end,
           plan_id = next_plan,
           billing_interval = next_interval,
           pending_plan_id = case when is_renewal then null else pending_plan_id end,
           pending_interval = case when is_renewal then null else pending_interval end,
           -- A renewal costs what the gateway charged for it, without GST; the
           -- app then sets the gateway to charge today's price from the next
           -- cycle (billing_renewal_target).
           amount = case when is_renewal and p_data -> 'payment' ->> 'amount' is not null
                         then round((p_data -> 'payment' ->> 'amount')::numeric * 10000
                                    / (10000 + settings.gst_rate_bps))::integer
                         else amount end,
           beds_at_renewal = case when p_kind = 'charged' then beds else beds_at_renewal end,
           coupon_cycles_left = case when p_kind = 'charged' and coupon_cycles_left is not null
                                     then greatest(coupon_cycles_left - 1, 0) else coupon_cycles_left end,
           cancel_at_period_end = case when status in ('cancelled', 'read_only') then false else cancel_at_period_end end
     where id = s.id;

    if p_kind = 'charged' and p_data -> 'payment' ->> 'id' is not null then
      perform private.issue_platform_invoice(s.id, p_data -> 'payment' ->> 'id',
                                             (p_data -> 'payment' ->> 'amount')::integer,
                                             period_start, period_end);
    end if;

  elsif p_kind in ('pending', 'halted') then
    -- A charge failed; the gateway retries on its own schedule (E14-T7).
    if s.status = 'active' then
      update public.subscriptions set status = 'past_due', past_due_since = now() where id = s.id;
      perform private.queue_owner_email(
        s.owner_id, 'payment_failed', 'Your Hostel ERP payment did not go through',
        'We could not collect your Hostel ERP subscription payment. Your bank or card may have '
        || 'declined it, or your UPI mandate may need attention. You keep full access for '
        || settings.grace_days || ' days while we retry. To avoid interruption, update your payment '
        || 'method under Settings, Billing.',
        'payment_failed:' || s.id || ':' || coalesce(s.current_period_end::text, 'none')
      );
    else
      outcome := 'ignored';
    end if;

  elsif p_kind in ('cancelled', 'completed') then
    if s.status <> 'cancelled' then
      update public.subscriptions
         set status = 'cancelled', past_due_since = null,
             current_period_end = coalesce(period_end, current_period_end, now())
       where id = s.id;
      perform private.queue_owner_email(
        s.owner_id, 'subscription_cancelled', 'Your Hostel ERP plan has ended',
        'Your plan has ended and your account is now read-only. All of your data is kept: you can '
        || 'still view, print and export it. Choose a plan under Settings, Billing to work again.',
        'subscription_cancelled:' || gateway_sub
      );
    else
      outcome := 'ignored';
    end if;

  elsif p_kind = 'authenticated' then
    update public.subscriptions
       set gateway_customer_id = coalesce(p_data ->> 'customer_id', gateway_customer_id)
     where id = s.id;
  else
    outcome := 'ignored';
  end if;

  update public.billing_gateway_events set result = outcome where event_id = p_event_id;
  return outcome;
end;
$$;

-- What the gateway should charge from the next cycle: today's price for the
-- plan (or the pending plan) and bed count (E14-T1: a price change reaches
-- a running subscription only at renewal). gateway_plan_id is null when no
-- gateway plan exists yet for that amount.
create or replace function private.billing_renewal_target(p_gateway_subscription_id text)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  s public.subscriptions;
  plan public.plans;
  next_interval text;
  price integer;
begin
  select * into s from public.subscriptions where gateway_subscription_id = p_gateway_subscription_id;
  if s.id is null or s.status not in ('active', 'past_due') or s.cancel_at_period_end then
    return null;
  end if;
  select * into plan from public.plans where id = coalesce(s.pending_plan_id, s.plan_id);
  next_interval := coalesce(s.pending_interval, s.billing_interval);
  price := private.plan_amount(plan.id, next_interval,
                               (private.account_usage(s.owner_id) ->> 'beds')::integer);
  if price is null or price <= 0 then
    return null;
  end if;
  return jsonb_build_object(
    'subscription_id', s.id,
    'plan_id', plan.id, 'plan_code', plan.code, 'plan_name', plan.name, 'interval', next_interval,
    'amount', price, 'amount_with_gst', private.with_gst(price),
    'current_gateway_plan_id', s.gateway_plan_id,
    'gateway_plan_id', (select g.gateway_plan_id from public.gateway_plans g
                         where g.plan_id = plan.id and g.billing_interval = next_interval
                           and g.amount = private.with_gst(price))
  );
end;
$$;

create or replace function private.billing_set_gateway_plan(p_subscription_id uuid, p_gateway_plan_id text)
returns void
language sql
security definer
set search_path = ''
as $$
  update public.subscriptions set gateway_plan_id = p_gateway_plan_id where id = p_subscription_id;
$$;

-- ---------------------------------------------------------------------------
-- The billing job (E14-T3, T7)
-- ---------------------------------------------------------------------------
-- Hourly. Records transitions the dates have already made true (access is
-- derived by account_can_write) and queues each reminder once.
create or replace function private.billing_run()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  settings public.billing_settings;
  s record;
  reminders integer := 0;
  read_only integer := 0;
  ended integer := 0;
  days_left integer;
begin
  select * into settings from public.billing_settings;
  perform private.billing_source('job', null);

  -- Trial reminders 7, 3 and 1 days before the end.
  for s in
    select * from public.subscriptions
     where status = 'trialing' and trial_ends_at > now() and trial_ends_at <= now() + interval '7 days'
  loop
    days_left := case when s.trial_ends_at <= now() + interval '1 day' then 1
                      when s.trial_ends_at <= now() + interval '3 days' then 3
                      else 7 end;
    perform private.queue_owner_email(
      s.owner_id, 'trial_reminder',
      'Your Hostel ERP trial ends in ' || days_left || case days_left when 1 then ' day' else ' days' end,
      'Your free trial ends on ' || to_char(s.trial_ends_at at time zone 'Asia/Kolkata', 'DD Mon YYYY')
      || '. Choose a plan under Settings, Billing to keep working without interruption. If you do not, '
      || 'your account becomes read-only: nothing is deleted.',
      'trial_reminder:' || s.id || ':' || days_left || ':' || (s.trial_ends_at::date)::text
    );
    reminders := reminders + 1;
  end loop;

  -- Trials that ended without a plan become read-only, never deleted.
  for s in select * from public.subscriptions where status = 'trialing' and trial_ends_at <= now() loop
    update public.subscriptions set status = 'read_only' where id = s.id;
    perform private.queue_owner_email(
      s.owner_id, 'trial_ended', 'Your Hostel ERP trial has ended',
      'Your free trial has ended and your account is now read-only. Your data is safe: you can view, '
      || 'print and export it. Choose a plan under Settings, Billing to start working again.',
      'trial_ended:' || s.id || ':' || (s.trial_ends_at::date)::text
    );
    read_only := read_only + 1;
  end loop;

  -- Failed payments: a warning two days before the grace period ends, then
  -- read-only when it does. Paying at any point restores access at once.
  for s in
    select * from public.subscriptions
     where status = 'past_due'
       and past_due_since + make_interval(days => settings.grace_days) <= now() + interval '2 days'
       and past_due_since + make_interval(days => settings.grace_days) > now()
  loop
    perform private.queue_owner_email(
      s.owner_id, 'grace_ending', 'Action needed: your Hostel ERP account becomes read-only soon',
      'We still have not been able to collect your subscription payment. On '
      || to_char((s.past_due_since + make_interval(days => settings.grace_days)) at time zone 'Asia/Kolkata', 'DD Mon YYYY')
      || ' your account becomes read-only. Update your payment method under Settings, Billing.',
      'grace_ending:' || s.id || ':' || s.past_due_since::text
    );
    reminders := reminders + 1;
  end loop;

  for s in
    select * from public.subscriptions
     where status = 'past_due' and past_due_since + make_interval(days => settings.grace_days) <= now()
  loop
    update public.subscriptions set status = 'read_only', past_due_since = null where id = s.id;
    perform private.queue_owner_email(
      s.owner_id, 'account_read_only', 'Your Hostel ERP account is now read-only',
      'We could not collect your subscription payment, so your account is now read-only. Nothing has '
      || 'been deleted. Pay under Settings, Billing and full access returns immediately.',
      'account_read_only:' || s.id || ':' || s.past_due_since::text
    );
    read_only := read_only + 1;
  end loop;

  -- Plans cancelled for the end of their period, and complimentary plans
  -- that have run out.
  for s in
    select * from public.subscriptions
     where status = 'active' and cancel_at_period_end
       and current_period_end is not null and current_period_end <= now()
  loop
    update public.subscriptions
       set status = case when s.complimentary then 'read_only' else 'cancelled' end
     where id = s.id;
    perform private.queue_owner_email(
      s.owner_id, 'subscription_cancelled', 'Your Hostel ERP plan has ended',
      'Your plan has ended and your account is now read-only. All of your data is kept. Choose a plan '
      || 'under Settings, Billing to work again.',
      'subscription_ended:' || s.id || ':' || s.current_period_end::text
    );
    ended := ended + 1;
  end loop;

  return jsonb_build_object('reminders', reminders, 'read_only', read_only, 'ended', ended);
end;
$$;

select cron.schedule('billing-run', '7 * * * *', $$select private.billing_run()$$);

-- ---------------------------------------------------------------------------
-- Admin: plans, coupons, settings and account adjustments (E14-T1, T10, E10-T7)
-- ---------------------------------------------------------------------------
alter table public.admin_audit_log drop constraint admin_audit_log_action_valid;
alter table public.admin_audit_log add constraint admin_audit_log_action_valid check (action in (
  'view_account', 'view_hostel', 'suspend_hostel', 'restore_hostel',
  'resend_confirmation', 'password_reset', 'sign_out_everywhere',
  'create_announcement', 'end_announcement', 'complete_closure',
  'billing_adjustment', 'save_plan', 'save_coupon', 'save_billing_settings'
));

create or replace function public.admin_save_plan(p_plan jsonb)
returns uuid
language sql
security invoker
set search_path = ''
as $$
  select private.admin_save_plan(p_plan);
$$;

create or replace function private.admin_save_plan(p_plan jsonb)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  saved uuid;
  limit_of jsonb := p_plan;
begin
  perform private.require_platform_admin();
  insert into public.plans as p
    (code, name, description, pricing_basis, monthly_price, annual_price, minimum_beds, tiers,
     max_beds, max_hostels, max_staff, features, is_public, is_active, sort_order)
  values (
    p_plan ->> 'code', btrim(p_plan ->> 'name'), nullif(btrim(p_plan ->> 'description'), ''),
    p_plan ->> 'pricing_basis',
    coalesce((p_plan ->> 'monthly_price')::integer, 0), coalesce((p_plan ->> 'annual_price')::integer, 0),
    coalesce((p_plan ->> 'minimum_beds')::integer, 1), coalesce(p_plan -> 'tiers', '[]'::jsonb),
    (limit_of ->> 'max_beds')::integer, (limit_of ->> 'max_hostels')::integer,
    (limit_of ->> 'max_staff')::integer,
    coalesce((select array_agg(value) from jsonb_array_elements_text(p_plan -> 'features')), '{}'),
    coalesce((p_plan ->> 'is_public')::boolean, true), coalesce((p_plan ->> 'is_active')::boolean, true),
    coalesce((p_plan ->> 'sort_order')::integer, 0)
  )
  on conflict (code) do update set
    name = excluded.name, description = excluded.description,
    pricing_basis = excluded.pricing_basis, monthly_price = excluded.monthly_price,
    annual_price = excluded.annual_price, minimum_beds = excluded.minimum_beds, tiers = excluded.tiers,
    max_beds = excluded.max_beds, max_hostels = excluded.max_hostels, max_staff = excluded.max_staff,
    features = excluded.features, is_public = excluded.is_public, is_active = excluded.is_active,
    sort_order = excluded.sort_order
  returning id into saved;
  perform private.admin_log('save_plan', null, null, null, p_plan);
  return saved;
end;
$$;

create or replace function public.admin_save_coupon(p_coupon jsonb)
returns uuid
language sql
security invoker
set search_path = ''
as $$
  select private.admin_save_coupon(p_coupon);
$$;

create or replace function private.admin_save_coupon(p_coupon jsonb)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  saved uuid;
begin
  perform private.require_platform_admin();
  if p_coupon ? 'id' and p_coupon ->> 'id' is not null then
    -- Only these may change once a coupon exists: its terms were sold.
    update public.coupons
       set description = nullif(btrim(p_coupon ->> 'description'), ''),
           gateway_offer_id = nullif(btrim(p_coupon ->> 'gateway_offer_id'), ''),
           active = coalesce((p_coupon ->> 'active')::boolean, active),
           redeem_by = (p_coupon ->> 'redeem_by')::timestamptz,
           max_redemptions = (p_coupon ->> 'max_redemptions')::integer
     where id = (p_coupon ->> 'id')::uuid
    returning id into saved;
  else
    insert into public.coupons
      (code, description, percent_off, amount_off, duration, duration_cycles, max_redemptions,
       redeem_by, gateway_offer_id, created_by)
    values (
      upper(btrim(p_coupon ->> 'code')), nullif(btrim(p_coupon ->> 'description'), ''),
      (p_coupon ->> 'percent_off')::integer, (p_coupon ->> 'amount_off')::integer,
      p_coupon ->> 'duration', (p_coupon ->> 'duration_cycles')::integer,
      (p_coupon ->> 'max_redemptions')::integer, (p_coupon ->> 'redeem_by')::timestamptz,
      nullif(btrim(p_coupon ->> 'gateway_offer_id'), ''), auth.uid()
    )
    returning id into saved;
  end if;
  if saved is null then
    raise exception 'Not found' using errcode = 'P0001', hint = 'coupon_not_found';
  end if;
  perform private.admin_log('save_coupon', null, null, null, p_coupon);
  return saved;
end;
$$;

create or replace function public.admin_coupons()
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
  select private.admin_coupons();
$$;

create or replace function private.admin_coupons()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform private.require_platform_admin();
  return coalesce((
    select jsonb_agg(to_jsonb(c) || jsonb_build_object(
      'redemptions', (select count(*) from public.coupon_redemptions r where r.coupon_id = c.id)
    ) order by c.created_at desc)
      from public.coupons c
  ), '[]'::jsonb);
end;
$$;

create or replace function public.admin_save_billing_settings(p_settings jsonb)
returns void
language sql
security invoker
set search_path = ''
as $$
  select private.admin_save_billing_settings(p_settings);
$$;

create or replace function private.admin_save_billing_settings(p_settings jsonb)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.require_platform_admin();
  if not exists (select 1 from public.plans p where p.code = p_settings ->> 'trial_plan_code') then
    raise exception 'Choose an existing plan for trials' using errcode = 'P0001', hint = 'plan_not_found';
  end if;
  update public.billing_settings
     set trial_days = (p_settings ->> 'trial_days')::integer,
         trial_plan_code = p_settings ->> 'trial_plan_code',
         grace_days = (p_settings ->> 'grace_days')::integer,
         gst_rate_bps = (p_settings ->> 'gst_rate_bps')::integer,
         sac_code = p_settings ->> 'sac_code',
         seller_legal_name = nullif(btrim(p_settings ->> 'seller_legal_name'), ''),
         seller_address = nullif(btrim(p_settings ->> 'seller_address'), ''),
         seller_gstin = nullif(upper(btrim(p_settings ->> 'seller_gstin')), ''),
         seller_state_code = nullif(btrim(p_settings ->> 'seller_state_code'), ''),
         seller_email = nullif(btrim(p_settings ->> 'seller_email'), ''),
         terms_version = coalesce(nullif(btrim(p_settings ->> 'terms_version'), ''), terms_version);
  perform private.admin_log('save_billing_settings', null, null, null, p_settings);
end;
$$;

-- Plan and subscription per account, for the customer directory (E10-T7).
create or replace function public.admin_account_billing(p_account_ids uuid[])
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
  select private.admin_account_billing(p_account_ids);
$$;

create or replace function private.admin_account_billing(p_account_ids uuid[])
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform private.require_platform_admin();
  return coalesce((
    select jsonb_object_agg(s.owner_id, jsonb_build_object(
      'status', s.status, 'plan_code', p.code, 'plan_name', p.name,
      'billing_interval', s.billing_interval, 'amount', s.amount,
      'trial_ends_at', s.trial_ends_at, 'current_period_end', s.current_period_end,
      'next_billing_at', case when s.status in ('active', 'past_due') and not s.cancel_at_period_end
                                   and s.gateway_subscription_id is not null
                              then s.current_period_end end,
      'cancel_at_period_end', s.cancel_at_period_end, 'complimentary', s.complimentary,
      'can_write', private.account_can_write(s.owner_id),
      'gateway_subscription_id', s.gateway_subscription_id,
      'pending_plan', (select pp.name from public.plans pp where pp.id = s.pending_plan_id),
      'usage', private.account_usage(s.owner_id),
      'history', coalesce((
        select jsonb_agg(to_jsonb(x) order by x.created_at desc)
          from (select e.created_at, e.source, e.from_status, e.to_status, e.reason,
                       (select pl.name from public.plans pl where pl.id = e.to_plan_id) as plan
                  from public.subscription_events e where e.subscription_id = s.id
                 order by e.created_at desc limit 10) x
      ), '[]'::jsonb)
    ))
      from public.subscriptions s join public.plans p on p.id = s.plan_id
     where s.owner_id = any (p_account_ids)
  ), '{}'::jsonb);
end;
$$;

-- Manual corrections, always with a reason and audited. They change our
-- records only: a gateway subscription is never altered from here, and a
-- complimentary plan is an admin adjustment, not a payment.
--   extend_trial  p_days more days of trial (a read-only trial reopens)
--   complimentary p_plan_code free until p_until (null: no end)
--   correct_plan  p_plan_code/p_interval recorded without charging
create or replace function public.admin_billing_adjust(
  p_account_id uuid,
  p_action text,
  p_reason text,
  p_plan_code text default null,
  p_interval text default null,
  p_days integer default null,
  p_until date default null
)
returns void
language sql
security invoker
set search_path = ''
as $$
  select private.admin_billing_adjust(p_account_id, p_action, p_reason, p_plan_code, p_interval,
                                      p_days, p_until);
$$;

create or replace function private.admin_billing_adjust(
  p_account_id uuid,
  p_action text,
  p_reason text,
  p_plan_code text,
  p_interval text,
  p_days integer,
  p_until date
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  reason text;
  s public.subscriptions;
  plan public.plans;
  beds integer;
begin
  perform private.require_platform_admin();
  reason := private.require_reason(p_reason);
  select * into s from public.subscriptions where owner_id = p_account_id for update;
  if s.id is null then
    raise exception 'This account has no subscription yet' using errcode = 'P0001', hint = 'no_subscription';
  end if;
  beds := (private.account_usage(p_account_id) ->> 'beds')::integer;
  perform private.billing_source('admin', reason);

  if p_action = 'extend_trial' then
    if p_days is null or p_days not between 1 and 90 then
      raise exception 'Extend by 1 to 90 days' using errcode = 'P0001', hint = 'days_range';
    end if;
    if s.status not in ('trialing', 'read_only') or s.gateway_subscription_id is not null then
      raise exception 'Only an unpaid trial can be extended' using errcode = 'P0001', hint = 'not_a_trial';
    end if;
    update public.subscriptions
       set status = 'trialing',
           trial_ends_at = greatest(coalesce(trial_ends_at, now()), now()) + make_interval(days => p_days),
           past_due_since = null
     where id = s.id;

  elsif p_action in ('complimentary', 'correct_plan') then
    select * into plan from public.plans p where p.code = p_plan_code;
    if plan.id is null then
      raise exception 'That plan is not available' using errcode = 'P0001', hint = 'plan_not_found';
    end if;
    if p_interval is not null and p_interval not in ('month', 'year') then
      raise exception 'Unknown billing interval' using errcode = 'P0001', hint = 'billing_interval';
    end if;

    if p_action = 'complimentary' then
      if s.gateway_subscription_id is not null and s.status in ('active', 'past_due')
         and not s.cancel_at_period_end then
        raise exception 'This account pays through the gateway; cancel that first'
          using errcode = 'P0001', hint = 'has_gateway_subscription';
      end if;
      if p_until is not null and p_until <= private.today_ist() then
        raise exception 'The end date must be in the future' using errcode = 'P0001', hint = 'until_past';
      end if;
      update public.subscriptions
         set status = 'active', plan_id = plan.id, complimentary = true, amount = 0,
             past_due_since = null,
             current_period_start = now(),
             current_period_end = case when p_until is null then null
                                       else (p_until::timestamp at time zone 'Asia/Kolkata') end,
             cancel_at_period_end = p_until is not null,
             pending_plan_id = null, pending_interval = null
       where id = s.id;
    else
      update public.subscriptions
         set plan_id = plan.id,
             billing_interval = coalesce(p_interval, billing_interval),
             amount = case when complimentary then 0
                           else coalesce(private.plan_amount(plan.id, coalesce(p_interval, billing_interval), beds), amount)
                      end
       where id = s.id;
    end if;
  else
    raise exception 'Unknown adjustment' using errcode = 'P0001', hint = 'billing_adjustment';
  end if;

  perform private.admin_log('billing_adjustment', reason, null, p_account_id,
                            jsonb_build_object('action', p_action, 'plan', p_plan_code,
                                               'interval', p_interval, 'days', p_days, 'until', p_until));
end;
$$;

-- ---------------------------------------------------------------------------
-- Revenue figures for the platform admin (E14-T12)
-- ---------------------------------------------------------------------------
-- Excluding GST. MRR counts paying subscriptions (active or past due, not
-- complimentary) at their current price, annual plans as a twelfth.
create or replace function public.admin_revenue_metrics()
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
  select private.admin_revenue_metrics();
$$;

create or replace function private.admin_revenue_metrics()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  mrr numeric;
  paying integer;
  churned integer;
  trials_finished integer;
  trials_converted integer;
  today date := private.today_ist();
begin
  perform private.require_platform_admin();

  select coalesce(sum(case s.billing_interval when 'year' then s.amount / 12.0 else s.amount end), 0),
         count(*)
    into mrr, paying
    from public.subscriptions s
   where s.status in ('active', 'past_due') and not s.complimentary and s.amount > 0;

  -- Paying accounts that left (cancelled, or read-only after failing to
  -- pay) in the last 30 days.
  select count(distinct e.subscription_id) into churned
    from public.subscription_events e
   where e.created_at > now() - interval '30 days'
     and e.from_status in ('active', 'past_due') and e.to_status in ('cancelled', 'read_only')
     and exists (select 1 from public.subscriptions s where s.id = e.subscription_id and s.amount > 0);

  -- Trials that ended (or converted) in the last 90 days.
  select count(*), count(*) filter (where converted)
    into trials_finished, trials_converted
    from (
      select e.subscription_id,
             bool_or(e.from_status = 'trialing' and e.to_status = 'active' and e.source = 'gateway') as converted
        from public.subscription_events e
       where e.created_at > now() - interval '90 days'
         and e.from_status = 'trialing' and e.to_status in ('active', 'read_only', 'cancelled')
       group by e.subscription_id
    ) t;

  return jsonb_build_object(
    'mrr', round(mrr)::bigint,
    'arr', round(mrr * 12)::bigint,
    'paying', paying,
    'by_status', (
      select jsonb_object_agg(x.status, x.count) from (
        select st.status, (select count(*) from public.subscriptions s where s.status = st.status) as count
          from unnest(array['trialing', 'active', 'past_due', 'read_only', 'cancelled']) as st(status)
      ) x
    ),
    'complimentary', (select count(*) from public.subscriptions s
                       where s.complimentary and s.status = 'active'),
    'trial_conversion', case when trials_finished = 0 then null
                             else round(100.0 * trials_converted / trials_finished, 1) end,
    'trials_finished_90_days', trials_finished,
    'monthly_churn', case when paying + churned = 0 then null
                          else round(100.0 * churned / (paying + churned), 1) end,
    'churned_30_days', churned,
    'past_due', jsonb_build_object(
      'count', (select count(*) from public.subscriptions s where s.status = 'past_due'),
      'amount', (select coalesce(sum(private.with_gst(s.amount)), 0) from public.subscriptions s
                  where s.status = 'past_due')
    ),
    'invoiced_by_month', coalesce((
      select jsonb_agg(jsonb_build_object(
        'month', m.month,
        'invoiced', (select coalesce(sum(case i.kind when 'invoice' then i.taxable_value else -i.taxable_value end), 0)
                       from public.platform_invoices i
                      where date_trunc('month', i.issued_at at time zone 'Asia/Kolkata')::date = m.month)
      ) order by m.month)
        from (select (date_trunc('month', today) - make_interval(months => n))::date as month
                from generate_series(0, 5) n) m
    ), '[]'::jsonb)
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- Terms acceptance at sign-up (E14-T11)
-- ---------------------------------------------------------------------------
create table public.terms_acceptances (
  user_id uuid not null references public.profiles (id) on delete cascade,
  terms_version text not null,
  accepted_at timestamptz not null default now(),
  primary key (user_id, terms_version),
  constraint terms_acceptances_version_format check (terms_version ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$')
);

comment on table public.terms_acceptances is
  'Which version of the terms of service each user accepted, and when.';

-- The sign-up form sends the version shown; only the current one is recorded.
create or replace function private.record_terms_acceptance()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  version text := new.raw_user_meta_data ->> 'terms_version';
begin
  if version is not null and version = (select b.terms_version from public.billing_settings b) then
    insert into public.terms_acceptances (user_id, terms_version)
    values (new.id, version)
    on conflict do nothing;
  end if;
  return new;
end;
$$;

-- Runs after on_auth_user_created, which creates the profile ('r' > 'c').
create trigger on_auth_user_record_terms
  after insert on auth.users
  for each row execute function private.record_terms_acceptance();

-- ---------------------------------------------------------------------------
-- Privileges and row-level security
-- ---------------------------------------------------------------------------
alter table public.billing_profiles enable row level security;
alter table public.coupons enable row level security;
alter table public.coupon_redemptions enable row level security;
alter table public.gateway_plans enable row level security;
alter table public.billing_gateway_events enable row level security;
alter table public.platform_invoice_counters enable row level security;
alter table public.platform_invoices enable row level security;
alter table public.terms_acceptances enable row level security;

revoke all on public.billing_profiles, public.coupons, public.coupon_redemptions,
  public.gateway_plans, public.billing_gateway_events, public.platform_invoice_counters,
  public.platform_invoices, public.terms_acceptances from authenticated, anon;

-- Owners keep their own business details.
grant select, insert, update (legal_name, gstin, address, state_code, billing_email)
  on public.billing_profiles to authenticated;
create policy "billing profiles: owners read their own"
  on public.billing_profiles for select to authenticated
  using (owner_id = (select auth.uid()));
create policy "billing profiles: owners add their own"
  on public.billing_profiles for insert to authenticated
  with check (owner_id = (select auth.uid()) and (select private.current_user_role()) = 'owner');
create policy "billing profiles: owners change their own"
  on public.billing_profiles for update to authenticated
  using (owner_id = (select auth.uid()))
  with check (owner_id = (select auth.uid()));

-- Owners read their own tax documents; admins read all.
grant select on public.platform_invoices to authenticated;
create policy "platform invoices: owners read their own"
  on public.platform_invoices for select to authenticated
  using (owner_id = (select auth.uid()) or (select private.is_platform_admin()));

grant select on public.terms_acceptances to authenticated;
create policy "terms acceptances: own"
  on public.terms_acceptances for select to authenticated
  using (user_id = (select auth.uid()) or (select private.is_platform_admin()));

-- Admins read the rest through policies; nothing is written by users.
grant select on public.billing_gateway_events, public.coupon_redemptions to authenticated;
create policy "billing gateway events: admins read"
  on public.billing_gateway_events for select to authenticated
  using ((select private.is_platform_admin()));
create policy "coupon redemptions: admins read"
  on public.coupon_redemptions for select to authenticated
  using ((select private.is_platform_admin()));

revoke all on function private.queue_owner_email(uuid, text, text, text, text),
  private.platform_invoices_immutable(), private.financial_year(timestamptz),
  private.next_platform_invoice_number(text, text), private.gst_split(integer, integer, text, text),
  private.with_gst(integer), private.issue_platform_invoice(uuid, text, integer, timestamptz, timestamptz),
  private.issue_platform_credit_note(text, text, integer), private.require_owner_account(),
  private.plan_offer(public.plans, integer), private.billing_overview(),
  private.billing_prepare_checkout(text, text, text), private.billing_quote_change(text, text),
  private.billing_record_gateway_plan(uuid, text, integer, text),
  private.billing_attach_checkout(uuid, text, text, text),
  private.billing_apply_plan_change(uuid, uuid, text, text, text), private.billing_mark_cancel(uuid, text),
  private.billing_cancel_target(), private.billing_apply_gateway_event(text, text, text, jsonb),
  private.billing_renewal_target(text), private.billing_set_gateway_plan(uuid, text),
  private.billing_run(), private.admin_save_plan(jsonb), private.admin_save_coupon(jsonb),
  private.admin_coupons(), private.admin_save_billing_settings(jsonb),
  private.admin_account_billing(uuid[]),
  private.admin_billing_adjust(uuid, text, text, text, text, integer, date),
  private.admin_revenue_metrics(), private.record_terms_acceptance() from public;

-- Owner and admin functions check the caller themselves.
grant execute on function private.billing_overview(), private.billing_prepare_checkout(text, text, text),
  private.billing_quote_change(text, text), private.billing_cancel_target(),
  private.admin_save_plan(jsonb), private.admin_save_coupon(jsonb), private.admin_coupons(),
  private.admin_save_billing_settings(jsonb), private.admin_account_billing(uuid[]),
  private.admin_billing_adjust(uuid, text, text, text, text, integer, date),
  private.admin_revenue_metrics() to authenticated;

revoke execute on function public.billing_overview(), public.billing_prepare_checkout(text, text, text),
  public.billing_quote_change(text, text), public.billing_cancel_target(),
  public.admin_save_plan(jsonb), public.admin_save_coupon(jsonb), public.admin_coupons(),
  public.admin_save_billing_settings(jsonb), public.admin_account_billing(uuid[]),
  public.admin_billing_adjust(uuid, text, text, text, text, integer, date),
  public.admin_revenue_metrics() from public, anon;
grant execute on function public.billing_overview(), public.billing_prepare_checkout(text, text, text),
  public.billing_quote_change(text, text), public.billing_cancel_target(),
  public.admin_save_plan(jsonb), public.admin_save_coupon(jsonb), public.admin_coupons(),
  public.admin_save_billing_settings(jsonb), public.admin_account_billing(uuid[]),
  public.admin_billing_adjust(uuid, text, text, text, text, integer, date),
  public.admin_revenue_metrics() to authenticated;

-- ---------------------------------------------------------------------------
-- Gateway-side wrappers: only the service role may call them
-- ---------------------------------------------------------------------------
-- Security invoker, in public so the app's service-role client can reach
-- them; the private functions do the work.
create or replace function public.billing_record_gateway_plan(
  p_plan_id uuid, p_interval text, p_amount integer, p_gateway_plan_id text)
returns void language sql security invoker set search_path = ''
as $$ select private.billing_record_gateway_plan(p_plan_id, p_interval, p_amount, p_gateway_plan_id); $$;

create or replace function public.billing_attach_checkout(
  p_subscription_id uuid, p_gateway_subscription_id text, p_gateway_customer_id text,
  p_gateway_plan_id text)
returns void language sql security invoker set search_path = ''
as $$ select private.billing_attach_checkout(p_subscription_id, p_gateway_subscription_id,
                                             p_gateway_customer_id, p_gateway_plan_id); $$;

create or replace function public.billing_apply_plan_change(
  p_owner_id uuid, p_plan_id uuid, p_interval text, p_effect text, p_gateway_plan_id text)
returns void language sql security invoker set search_path = ''
as $$ select private.billing_apply_plan_change(p_owner_id, p_plan_id, p_interval, p_effect,
                                               p_gateway_plan_id); $$;

create or replace function public.billing_renewal_target(p_gateway_subscription_id text)
returns jsonb language sql stable security invoker set search_path = ''
as $$ select private.billing_renewal_target(p_gateway_subscription_id); $$;

create or replace function public.billing_set_gateway_plan(p_subscription_id uuid, p_gateway_plan_id text)
returns void language sql security invoker set search_path = ''
as $$ select private.billing_set_gateway_plan(p_subscription_id, p_gateway_plan_id); $$;

create or replace function public.billing_mark_cancel(p_owner_id uuid, p_reason text)
returns void language sql security invoker set search_path = ''
as $$ select private.billing_mark_cancel(p_owner_id, p_reason); $$;

create or replace function public.billing_apply_gateway_event(
  p_event_id text, p_event_type text, p_kind text, p_data jsonb)
returns text language sql security invoker set search_path = ''
as $$ select private.billing_apply_gateway_event(p_event_id, p_event_type, p_kind, p_data); $$;

revoke execute on function public.billing_record_gateway_plan(uuid, text, integer, text),
  public.billing_attach_checkout(uuid, text, text, text),
  public.billing_apply_plan_change(uuid, uuid, text, text, text), public.billing_mark_cancel(uuid, text),
  public.billing_apply_gateway_event(text, text, text, jsonb),
  public.billing_renewal_target(text), public.billing_set_gateway_plan(uuid, text)
  from public, anon, authenticated;
grant execute on function public.billing_record_gateway_plan(uuid, text, integer, text),
  public.billing_attach_checkout(uuid, text, text, text),
  public.billing_apply_plan_change(uuid, uuid, text, text, text), public.billing_mark_cancel(uuid, text),
  public.billing_apply_gateway_event(text, text, text, jsonb),
  public.billing_renewal_target(text), public.billing_set_gateway_plan(uuid, text) to service_role;
grant execute on function private.billing_record_gateway_plan(uuid, text, integer, text),
  private.billing_attach_checkout(uuid, text, text, text),
  private.billing_apply_plan_change(uuid, uuid, text, text, text), private.billing_mark_cancel(uuid, text),
  private.billing_apply_gateway_event(text, text, text, jsonb),
  private.billing_renewal_target(text), private.billing_set_gateway_plan(uuid, text) to service_role;
