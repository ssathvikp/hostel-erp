-- Online rent collection through the hostel's own payment gateway
-- (E13-T10).
--
-- Each hostel connects its own Razorpay account: rent goes straight to the
-- owner, never through Hostel ERP. The keys are encrypted by the app before
-- they reach the database (AES-256-GCM, PAYMENT_KEYS_ENCRYPTION_KEY) and the
-- encrypted columns cannot be read by any signed-in user; only the server
-- reads them, with the service role, to create links and verify webhooks.
--
-- An open invoice gets a payment link for its balance. The gateway's signed
-- webhook, not the browser, records the money: collect_gateway_event stores
-- each event id and each gateway payment id once, so a replayed event
-- changes nothing. Money beyond what the invoice still needs (it was paid in
-- cash meanwhile) becomes the resident's credit. Refunds made in the gateway
-- void the payment (re-recording any part that was kept) or come out of
-- credit, and anything that cannot be mirrored is shown, never dropped.

set check_function_bodies = off;

-- ---------------------------------------------------------------------------
-- A new payment mode
-- ---------------------------------------------------------------------------
alter table public.payments drop constraint payments_mode_valid;
alter table public.payments add constraint payments_mode_valid
  check (mode in ('cash', 'upi', 'bank_transfer', 'card', 'cheque', 'credit', 'deposit', 'online'));

alter table public.resident_credit drop constraint resident_credit_mode_valid;
alter table public.resident_credit add constraint resident_credit_mode_valid
  check (mode in ('cash', 'upi', 'bank_transfer', 'card', 'online'));

-- Only the gateway's webhook records online money.
create or replace function private.payments_online_by_gateway_only()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if new.mode = 'online' and coalesce((select auth.jwt() ->> 'role'), '') = 'authenticated' then
    raise exception 'Online payments are recorded by the payment gateway'
      using errcode = 'P0001', hint = 'payment_mode_online';
  end if;
  return new;
end;
$$;

create trigger payments_online_by_gateway_only
  before insert on public.payments
  for each row execute function private.payments_online_by_gateway_only();
create trigger resident_credit_online_by_gateway_only
  before insert on public.resident_credit
  for each row execute function private.payments_online_by_gateway_only();

-- ---------------------------------------------------------------------------
-- The hostel's gateway account
-- ---------------------------------------------------------------------------
create table public.payment_gateway_accounts (
  hostel_id uuid primary key references public.hostels (id) on delete cascade,
  provider text not null default 'razorpay',
  key_id text not null,
  -- Encrypted by the app; never selectable by signed-in users.
  key_secret_encrypted text not null,
  webhook_secret_encrypted text not null,
  -- Names the hostel in the webhook URL. Not a secret: every webhook is
  -- verified with the hostel's own webhook secret.
  webhook_token text not null unique,
  enabled boolean not null default true,
  connected_by uuid default auth.uid() references public.profiles (id) on delete set null,
  connected_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint payment_gateway_accounts_provider_valid check (provider in ('razorpay')),
  constraint payment_gateway_accounts_key_id_format check (key_id ~ '^rzp_(test|live)_[A-Za-z0-9]{6,40}$'),
  constraint payment_gateway_accounts_encrypted_format check (
    key_secret_encrypted ~ '^v1\.' and webhook_secret_encrypted ~ '^v1\.'
  ),
  constraint payment_gateway_accounts_token_format check (webhook_token ~ '^[0-9a-f]{32}$')
);

comment on table public.payment_gateway_accounts is
  'The hostel''s own Razorpay account for rent. Secrets are app-encrypted and readable only by the service role.';

create trigger payment_gateway_accounts_set_updated_at
  before update on public.payment_gateway_accounts
  for each row execute function private.set_updated_at();

-- ---------------------------------------------------------------------------
-- Payment links
-- ---------------------------------------------------------------------------
create table public.payment_links (
  id uuid primary key default gen_random_uuid(),
  hostel_id uuid not null references public.hostels (id) on delete cascade,
  invoice_id uuid not null,
  resident_id uuid not null,
  amount integer not null,
  gateway_link_id text not null unique,
  short_url text not null,
  status text not null default 'created',
  expires_at timestamptz not null,
  created_by uuid default auth.uid() references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  paid_at timestamptz,
  gateway_payment_id text,

  constraint payment_links_hostel_id_id_key unique (hostel_id, id),
  constraint payment_links_invoice_fkey foreign key (hostel_id, invoice_id)
    references public.invoices (hostel_id, id),
  constraint payment_links_resident_fkey foreign key (hostel_id, resident_id)
    references public.residents (hostel_id, id),
  constraint payment_links_amount_positive check (amount > 0),
  constraint payment_links_status_valid check (status in ('created', 'paid', 'cancelled')),
  constraint payment_links_url_format check (short_url ~ '^https://'),
  constraint payment_links_paid check ((status = 'paid') = (paid_at is not null))
);

comment on table public.payment_links is
  'Gateway payment links for an invoice''s balance. Status changes only through the gateway webhook or a new link.';

-- At most one live link per invoice; a new one replaces it.
create unique index payment_links_one_live_per_invoice
  on public.payment_links (invoice_id) where status = 'created';
create index payment_links_hostel_idx on public.payment_links (hostel_id, created_at desc);

-- ---------------------------------------------------------------------------
-- What the gateway reported
-- ---------------------------------------------------------------------------
create table public.gateway_payments (
  id uuid primary key default gen_random_uuid(),
  hostel_id uuid not null references public.hostels (id) on delete cascade,
  gateway_payment_id text not null unique,
  payment_link_id uuid,
  invoice_id uuid,
  resident_id uuid,
  amount integer not null,
  fee integer,
  tax integer,
  method text,
  status text not null,
  refunded_amount integer not null default 0,
  -- Our records of the money: the payment against the invoice and any part
  -- kept as credit. Both null when it could not be recorded (see note).
  payment_id uuid,
  credit_id uuid,
  note text,
  received_at timestamptz not null default now(),

  constraint gateway_payments_hostel_id_id_key unique (hostel_id, id),
  constraint gateway_payments_link_fkey foreign key (hostel_id, payment_link_id)
    references public.payment_links (hostel_id, id),
  constraint gateway_payments_amount_non_negative check (amount >= 0 and refunded_amount >= 0),
  constraint gateway_payments_status_valid check (status in ('captured', 'failed', 'refunded'))
);

create index gateway_payments_hostel_idx on public.gateway_payments (hostel_id, received_at desc);

create table public.gateway_refunds (
  gateway_refund_id text primary key,
  hostel_id uuid not null references public.hostels (id) on delete cascade,
  gateway_payment_id text not null,
  amount integer not null,
  mirrored text not null,
  note text,
  created_at timestamptz not null default now(),
  constraint gateway_refunds_amount_positive check (amount > 0),
  constraint gateway_refunds_mirrored_valid check (mirrored in ('voided', 'credit', 'partly', 'not_found'))
);

create table public.gateway_settlements (
  hostel_id uuid not null references public.hostels (id) on delete cascade,
  gateway_settlement_id text not null,
  amount integer not null,
  fees integer not null default 0,
  tax integer not null default 0,
  utr text,
  settled_at timestamptz not null,
  primary key (hostel_id, gateway_settlement_id)
);

create table public.gateway_webhook_events (
  hostel_id uuid not null references public.hostels (id) on delete cascade,
  event_id text not null,
  event_type text not null,
  result text not null,
  received_at timestamptz not null default now(),
  primary key (hostel_id, event_id)
);

-- ---------------------------------------------------------------------------
-- Creating a link (members of the hostel)
-- ---------------------------------------------------------------------------
-- What a new link needs: the open balance (less cheques still clearing),
-- the resident to address it to, and a live link that can be reused if the
-- balance has not changed. Refuses an invoice that has nothing to pay or a
-- hostel with no gateway connected.
create or replace function public.prepare_payment_link(p_invoice_id uuid)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  inv record;
  live record;
  account record;
begin
  select b.id, b.hostel_id, b.resident_id, b.resident_name, b.number, b.period_month, b.status,
         b.balance - b.pending_cheques as open
    into inv
    from public.invoice_balances b where b.id = p_invoice_id;
  if not found then
    raise exception 'Invoice not found' using errcode = 'P0001', hint = 'invoice_not_found';
  end if;
  if inv.status <> 'issued' then
    raise exception 'A void invoice cannot be paid' using errcode = 'P0001', hint = 'invoice_void';
  end if;
  if inv.open <= 0 then
    raise exception 'Nothing is due on this invoice' using errcode = 'P0001', hint = 'nothing_due';
  end if;
  select a.enabled into account from public.payment_gateway_accounts a where a.hostel_id = inv.hostel_id;
  if not found or not account.enabled then
    raise exception 'Online payment is not set up for this hostel'
      using errcode = 'P0001', hint = 'gateway_not_connected';
  end if;
  select l.id, l.amount, l.short_url, l.gateway_link_id, l.expires_at into live
    from public.payment_links l where l.invoice_id = inv.id and l.status = 'created';

  return jsonb_build_object(
    'hostel_id', inv.hostel_id,
    'invoice_id', inv.id,
    'invoice_number', inv.number,
    'period_month', inv.period_month,
    'resident_id', inv.resident_id,
    'resident_name', inv.resident_name,
    'resident_phone', (select r.phone from public.residents r where r.id = inv.resident_id),
    'resident_email', (select r.email from public.residents r where r.id = inv.resident_id),
    'hostel_name', (select h.name from public.hostels h where h.id = inv.hostel_id),
    'amount', inv.open,
    'live', case when live.id is null then null else jsonb_build_object(
      'id', live.id, 'amount', live.amount, 'short_url', live.short_url,
      'gateway_link_id', live.gateway_link_id, 'expires_at', live.expires_at,
      'reusable', live.amount = inv.open and live.expires_at > now() + interval '1 day'
    ) end
  );
end;
$$;

-- Records a link the gateway created, replacing any live one for the invoice.
create or replace function public.record_payment_link(
  p_invoice_id uuid,
  p_amount integer,
  p_gateway_link_id text,
  p_short_url text,
  p_expires_at timestamptz
)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  inv record;
  created uuid;
begin
  select i.hostel_id, i.resident_id into inv from public.invoices i where i.id = p_invoice_id;
  if not found then
    raise exception 'Invoice not found' using errcode = 'P0001', hint = 'invoice_not_found';
  end if;
  perform private.cancel_live_payment_link(p_invoice_id);
  insert into public.payment_links
    (hostel_id, invoice_id, resident_id, amount, gateway_link_id, short_url, expires_at)
  values (inv.hostel_id, p_invoice_id, inv.resident_id, p_amount, p_gateway_link_id, p_short_url,
          p_expires_at)
  returning id into created;
  return created;
end;
$$;

-- Members may not change link status directly; this is the one way.
create or replace function private.cancel_live_payment_link(p_invoice_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not exists (
    select 1 from public.invoices i
     where i.id = p_invoice_id and i.hostel_id in (select private.user_hostel_ids())
  ) and coalesce((select auth.jwt() ->> 'role'), '') = 'authenticated' then
    raise exception 'You do not have permission to do that' using errcode = '42501';
  end if;
  update public.payment_links set status = 'cancelled'
   where invoice_id = p_invoice_id and status = 'created';
end;
$$;

-- ---------------------------------------------------------------------------
-- Applying a verified gateway event (service role only)
-- ---------------------------------------------------------------------------
-- p_data is normalised by the app (src/lib/billing/razorpay-webhook.ts):
--   link_paid       link_id, payment {id, amount, fee, tax, method}
--   payment_failed  payment {id, amount, method, error}
--   refunded        refund {id, payment_id, amount}
--   settled         settlement {id, amount, fees, tax, utr, settled_at}
-- Returns 'applied', 'duplicate', 'ignored' or 'unrecorded'.
create or replace function private.collect_gateway_event(
  p_hostel_id uuid,
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
  outcome text := 'applied';
begin
  insert into public.gateway_webhook_events (hostel_id, event_id, event_type, result)
  values (p_hostel_id, p_event_id, p_event_type, 'pending')
  on conflict (hostel_id, event_id) do nothing;
  if not found then
    return 'duplicate';
  end if;

  if p_kind = 'link_paid' then
    outcome := private.collect_link_payment(p_hostel_id, p_data);
  elsif p_kind = 'payment_failed' then
    insert into public.gateway_payments (hostel_id, gateway_payment_id, amount, method, status, note)
    values (p_hostel_id, p_data -> 'payment' ->> 'id',
            coalesce((p_data -> 'payment' ->> 'amount')::integer, 0),
            p_data -> 'payment' ->> 'method', 'failed',
            left(p_data -> 'payment' ->> 'error', 300))
    on conflict (gateway_payment_id) do nothing;
  elsif p_kind = 'refunded' then
    outcome := private.collect_gateway_refund(p_hostel_id, p_data -> 'refund');
  elsif p_kind = 'settled' then
    insert into public.gateway_settlements
      (hostel_id, gateway_settlement_id, amount, fees, tax, utr, settled_at)
    values (p_hostel_id, p_data -> 'settlement' ->> 'id',
            (p_data -> 'settlement' ->> 'amount')::integer,
            coalesce((p_data -> 'settlement' ->> 'fees')::integer, 0),
            coalesce((p_data -> 'settlement' ->> 'tax')::integer, 0),
            p_data -> 'settlement' ->> 'utr',
            coalesce((p_data -> 'settlement' ->> 'settled_at')::timestamptz, now()))
    on conflict (hostel_id, gateway_settlement_id) do nothing;
  else
    outcome := 'ignored';
  end if;

  update public.gateway_webhook_events set result = outcome
   where hostel_id = p_hostel_id and event_id = p_event_id;
  return outcome;
end;
$$;

create or replace function private.collect_link_payment(p_hostel_id uuid, p_data jsonb)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  link public.payment_links;
  gateway_id text := p_data -> 'payment' ->> 'id';
  amount integer := (p_data -> 'payment' ->> 'amount')::integer;
  inv record;
  to_invoice integer := 0;
  extra integer;
  payment uuid;
  credit uuid;
  note text;
begin
  if exists (select 1 from public.gateway_payments g where g.gateway_payment_id = gateway_id
                                                       and g.status <> 'failed') then
    return 'duplicate';
  end if;
  select * into link from public.payment_links l
   where l.gateway_link_id = p_data ->> 'link_id' and l.hostel_id = p_hostel_id
   for update;
  if link.id is null then
    return 'ignored';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('payments:' || link.invoice_id::text, 0));
  select b.status, b.balance - b.pending_cheques as open into inv
    from public.invoice_balances b where b.id = link.invoice_id;
  if inv.status = 'issued' then
    to_invoice := least(amount, greatest(inv.open, 0));
  end if;
  extra := amount - to_invoice;

  -- A suspended hostel cannot take new money; the payment is kept on the
  -- gateway record for the owner to see and settle by hand.
  begin
    if to_invoice > 0 then
      insert into public.payments (hostel_id, invoice_id, amount, paid_at, mode, reference, recorded_by)
      values (p_hostel_id, link.invoice_id, to_invoice, private.today_ist(), 'online', gateway_id,
              private.acting_user(p_hostel_id))
      returning id into payment;
    end if;
    if extra > 0 then
      perform private.lock_resident_money(link.resident_id);
      insert into public.resident_credit
        (hostel_id, resident_id, kind, amount, paid_at, mode, reference, note, recorded_by)
      values (p_hostel_id, link.resident_id, 'received', extra, private.today_ist(), 'online',
              gateway_id, 'Paid online beyond the invoice', private.acting_user(p_hostel_id))
      returning id into credit;
      perform private.apply_credit_to_open_invoices(link.resident_id);
    end if;
  exception when sqlstate 'P0001' then
    payment := null;
    credit := null;
    note := 'Not recorded: ' || sqlerrm;
  end;

  insert into public.gateway_payments
    (hostel_id, gateway_payment_id, payment_link_id, invoice_id, resident_id, amount, fee, tax,
     method, status, payment_id, credit_id, note)
  values (p_hostel_id, gateway_id, link.id, link.invoice_id, link.resident_id, amount,
          (p_data -> 'payment' ->> 'fee')::integer, (p_data -> 'payment' ->> 'tax')::integer,
          p_data -> 'payment' ->> 'method', 'captured', payment, credit, note)
  on conflict (gateway_payment_id) do update set
    payment_link_id = excluded.payment_link_id, invoice_id = excluded.invoice_id,
    resident_id = excluded.resident_id, amount = excluded.amount, fee = excluded.fee,
    tax = excluded.tax, method = excluded.method, status = 'captured',
    payment_id = excluded.payment_id, credit_id = excluded.credit_id, note = excluded.note;

  update public.payment_links
     set status = 'paid', paid_at = now(), gateway_payment_id = gateway_id
   where id = link.id;
  return case when note is null then 'applied' else 'unrecorded' end;
end;
$$;

-- Mirrors a refund made in the gateway. The invoice payment is voided; if
-- only part was refunded, the rest is recorded again as a new online
-- payment. A refund larger than the invoice part comes out of the credit
-- the extra created, as far as credit remains. What cannot be mirrored is
-- noted on the refund for the owner, never dropped.
create or replace function private.collect_gateway_refund(p_hostel_id uuid, p_refund jsonb)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  refund_id text := p_refund ->> 'id';
  refund_amount integer := (p_refund ->> 'amount')::integer;
  g public.gateway_payments;
  original record;
  left_to_mirror integer := refund_amount;
  from_invoice integer := 0;
  from_credit integer := 0;
  credit_left integer;
  kept integer;
  resident uuid;
  mirrored text;
  note text;
begin
  if exists (select 1 from public.gateway_refunds r where r.gateway_refund_id = refund_id) then
    return 'duplicate';
  end if;
  select * into g from public.gateway_payments gp
   where gp.gateway_payment_id = p_refund ->> 'payment_id' and gp.hostel_id = p_hostel_id
   for update;
  if g.id is null then
    insert into public.gateway_refunds (gateway_refund_id, hostel_id, gateway_payment_id, amount, mirrored, note)
    values (refund_id, p_hostel_id, p_refund ->> 'payment_id', refund_amount, 'not_found',
            'The refunded payment is not one Hostel ERP recorded');
    return 'unrecorded';
  end if;

  if g.payment_id is not null then
    select p.id, p.invoice_id, p.amount, p.voided_at into original
      from public.payments p where p.id = g.payment_id;
    if original.voided_at is null then
      from_invoice := least(left_to_mirror, original.amount);
      update public.payments
         set voided_at = now(), voided_by = null,
             void_reason = 'Refunded online (' || refund_id || ')'
       where id = original.id;
      kept := original.amount - from_invoice;
      if kept > 0 then
        insert into public.payments (hostel_id, invoice_id, amount, paid_at, mode, reference, recorded_by)
        values (p_hostel_id, original.invoice_id, kept, private.today_ist(), 'online',
                g.gateway_payment_id, private.acting_user(p_hostel_id))
        returning id into g.payment_id;
      else
        g.payment_id := null;
      end if;
      left_to_mirror := left_to_mirror - from_invoice;
    end if;
  end if;

  if left_to_mirror > 0 and g.resident_id is not null then
    resident := g.resident_id;
    perform private.lock_resident_money(resident);
    credit_left := private.credit_balance(resident);
    from_credit := least(left_to_mirror, greatest(credit_left, 0));
    if from_credit > 0 then
      insert into public.resident_credit
        (hostel_id, resident_id, kind, amount, paid_at, mode, reference, note, recorded_by)
      values (p_hostel_id, resident, 'refund', from_credit, private.today_ist(), 'online',
              refund_id, 'Refunded online', private.acting_user(p_hostel_id));
      left_to_mirror := left_to_mirror - from_credit;
    end if;
  end if;

  if left_to_mirror = 0 then
    mirrored := case when from_credit > 0 and from_invoice = 0 then 'credit' else 'voided' end;
  else
    mirrored := 'partly';
    note := to_char(left_to_mirror / 100.0, 'FM999999990.00')
            || ' of this refund could not be taken back: the credit was already used. Settle it with the resident.';
  end if;

  insert into public.gateway_refunds (gateway_refund_id, hostel_id, gateway_payment_id, amount, mirrored, note)
  values (refund_id, p_hostel_id, g.gateway_payment_id, refund_amount, mirrored, note);
  update public.gateway_payments
     set refunded_amount = refunded_amount + refund_amount,
         status = case when refunded_amount + refund_amount >= amount then 'refunded' else status end,
         payment_id = g.payment_id
   where id = g.id;
  return case when mirrored = 'partly' then 'unrecorded' else 'applied' end;
end;
$$;

-- The account behind a webhook URL, with its encrypted secrets, for the
-- server to verify the signature. Service role only.
create or replace function private.gateway_account_for_webhook(p_token text)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object('hostel_id', a.hostel_id, 'webhook_secret_encrypted', a.webhook_secret_encrypted,
                            'enabled', a.enabled)
    from public.payment_gateway_accounts a where a.webhook_token = p_token;
$$;

-- The keys to create a link with. Service role only; the app checks the
-- caller is a member of the hostel first (prepare_payment_link).
create or replace function private.gateway_keys(p_hostel_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object('key_id', a.key_id, 'key_secret_encrypted', a.key_secret_encrypted)
    from public.payment_gateway_accounts a where a.hostel_id = p_hostel_id and a.enabled;
$$;

-- ---------------------------------------------------------------------------
-- Reconciliation (owners and staff)
-- ---------------------------------------------------------------------------
-- Gateway payments against what Hostel ERP recorded, gateway fees, refunds
-- and settlements, for a date range in India time.
create or replace function public.gateway_reconciliation(p_hostel_id uuid, p_from date, p_to date)
returns jsonb
language plpgsql
stable
security invoker
set search_path = ''
as $$
begin
  if p_hostel_id not in (select private.user_hostel_ids()) then
    raise exception 'You do not have permission to do that' using errcode = '42501';
  end if;
  return (
    with pay as (
      select g.*, (g.received_at at time zone 'Asia/Kolkata')::date as day
        from public.gateway_payments g
       where g.hostel_id = p_hostel_id
         and (g.received_at at time zone 'Asia/Kolkata')::date between p_from and p_to
    ),
    settled as (
      select s.* from public.gateway_settlements s
       where s.hostel_id = p_hostel_id
         and (s.settled_at at time zone 'Asia/Kolkata')::date between p_from and p_to
    )
    select jsonb_build_object(
      'totals', jsonb_build_object(
        'captured', (select coalesce(sum(p.amount), 0) from pay p where p.status <> 'failed'),
        'fees', (select coalesce(sum(p.fee), 0) from pay p where p.status <> 'failed'),
        'tax', (select coalesce(sum(p.tax), 0) from pay p where p.status <> 'failed'),
        'refunded', (select coalesce(sum(p.refunded_amount), 0) from pay p),
        'recorded', (select coalesce(sum(pm.amount), 0) from pay p
                      join public.payments pm on pm.id = p.payment_id and pm.voided_at is null),
        'to_credit', (select coalesce(sum(c.amount), 0) from pay p
                       join public.resident_credit c on c.id = p.credit_id),
        'settled', (select coalesce(sum(s.amount), 0) from settled s),
        'settlement_fees', (select coalesce(sum(s.fees + s.tax), 0) from settled s),
        'failed', (select count(*) from pay p where p.status = 'failed'),
        'unrecorded', (select count(*) from pay p
                        where p.status = 'captured' and p.payment_id is null and p.credit_id is null)
      ),
      'payments', coalesce((
        select jsonb_agg(jsonb_build_object(
          'gateway_payment_id', p.gateway_payment_id, 'received_at', p.received_at,
          'amount', p.amount, 'fee', p.fee, 'tax', p.tax, 'method', p.method, 'status', p.status,
          'refunded_amount', p.refunded_amount, 'note', p.note,
          'resident_name', (select r.full_name from public.residents r where r.id = p.resident_id),
          'invoice_id', p.invoice_id,
          'invoice_number', (select i.number from public.invoices i where i.id = p.invoice_id),
          'receipt_number', (select pm.number from public.payments pm where pm.id = p.payment_id),
          'credit_number', (select c.number from public.resident_credit c where c.id = p.credit_id)
        ) order by p.received_at desc)
          from pay p
      ), '[]'::jsonb),
      'refunds', coalesce((
        select jsonb_agg(to_jsonb(r) - 'hostel_id' order by r.created_at desc)
          from public.gateway_refunds r
         where r.hostel_id = p_hostel_id
           and (r.created_at at time zone 'Asia/Kolkata')::date between p_from and p_to
      ), '[]'::jsonb),
      'settlements', coalesce((
        select jsonb_agg(to_jsonb(s) - 'hostel_id' order by s.settled_at desc) from settled s
      ), '[]'::jsonb)
    )
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- Privileges and row-level security
-- ---------------------------------------------------------------------------
alter table public.payment_gateway_accounts enable row level security;
alter table public.payment_links enable row level security;
alter table public.gateway_payments enable row level security;
alter table public.gateway_refunds enable row level security;
alter table public.gateway_settlements enable row level security;
alter table public.gateway_webhook_events enable row level security;

revoke all on public.payment_gateway_accounts, public.payment_links, public.gateway_payments,
  public.gateway_refunds, public.gateway_settlements, public.gateway_webhook_events
  from authenticated, anon;

-- Owners connect, change and disconnect; members see that it is connected.
-- The encrypted columns are never granted for reading.
grant select (hostel_id, provider, key_id, webhook_token, enabled, connected_at, updated_at)
  on public.payment_gateway_accounts to authenticated;
grant insert (hostel_id, key_id, key_secret_encrypted, webhook_secret_encrypted, webhook_token)
  on public.payment_gateway_accounts to authenticated;
grant update (key_id, key_secret_encrypted, webhook_secret_encrypted, enabled)
  on public.payment_gateway_accounts to authenticated;
grant delete on public.payment_gateway_accounts to authenticated;
create policy "gateway accounts: members read"
  on public.payment_gateway_accounts for select to authenticated
  using (hostel_id in (select private.user_hostel_ids()));
create policy "gateway accounts: owners connect"
  on public.payment_gateway_accounts for insert to authenticated
  with check (hostel_id in (select private.user_owned_hostel_ids()));
create policy "gateway accounts: owners change"
  on public.payment_gateway_accounts for update to authenticated
  using (hostel_id in (select private.user_owned_hostel_ids()))
  with check (hostel_id in (select private.user_owned_hostel_ids()));
create policy "gateway accounts: owners disconnect"
  on public.payment_gateway_accounts for delete to authenticated
  using (hostel_id in (select private.user_owned_hostel_ids()));

-- Members create links (through record_payment_link) and read everything
-- the gateway reported for their hostel.
grant select on public.payment_links, public.gateway_payments, public.gateway_refunds,
  public.gateway_settlements to authenticated;
grant insert (hostel_id, invoice_id, resident_id, amount, gateway_link_id, short_url, expires_at)
  on public.payment_links to authenticated;
create policy "payment links: members read"
  on public.payment_links for select to authenticated
  using (hostel_id in (select private.user_hostel_ids()));
create policy "payment links: members create"
  on public.payment_links for insert to authenticated
  with check (hostel_id in (select private.user_hostel_ids()) and status = 'created');
create policy "gateway payments: members read"
  on public.gateway_payments for select to authenticated
  using (hostel_id in (select private.user_hostel_ids()));
create policy "gateway refunds: members read"
  on public.gateway_refunds for select to authenticated
  using (hostel_id in (select private.user_hostel_ids()));
create policy "gateway settlements: members read"
  on public.gateway_settlements for select to authenticated
  using (hostel_id in (select private.user_hostel_ids()));

-- Read-only mode (E14-T9) covers the new tenant tables.
do $$
declare
  t text;
begin
  foreach t in array array[
    'payment_gateway_accounts', 'payment_links', 'gateway_payments', 'gateway_refunds',
    'gateway_settlements', 'gateway_webhook_events'
  ] loop
    execute format(
      'create trigger %I before insert or update or delete on public.%I
         for each row execute function private.require_account_can_write()',
      t || '_require_account_can_write', t
    );
  end loop;
end;
$$;

revoke all on function private.payments_online_by_gateway_only(),
  private.cancel_live_payment_link(uuid),
  private.collect_gateway_event(uuid, text, text, text, jsonb),
  private.collect_link_payment(uuid, jsonb), private.collect_gateway_refund(uuid, jsonb),
  private.gateway_account_for_webhook(text), private.gateway_keys(uuid) from public;
grant execute on function private.cancel_live_payment_link(uuid) to authenticated;

revoke execute on function public.prepare_payment_link(uuid),
  public.record_payment_link(uuid, integer, text, text, timestamptz),
  public.gateway_reconciliation(uuid, date, date) from public, anon;
grant execute on function public.prepare_payment_link(uuid),
  public.record_payment_link(uuid, integer, text, text, timestamptz),
  public.gateway_reconciliation(uuid, date, date) to authenticated;

-- Service-role wrappers for the server.
create or replace function public.collect_gateway_event(
  p_hostel_id uuid, p_event_id text, p_event_type text, p_kind text, p_data jsonb)
returns text language sql security invoker set search_path = ''
as $$ select private.collect_gateway_event(p_hostel_id, p_event_id, p_event_type, p_kind, p_data); $$;

create or replace function public.gateway_account_for_webhook(p_token text)
returns jsonb language sql stable security invoker set search_path = ''
as $$ select private.gateway_account_for_webhook(p_token); $$;

create or replace function public.gateway_keys(p_hostel_id uuid)
returns jsonb language sql stable security invoker set search_path = ''
as $$ select private.gateway_keys(p_hostel_id); $$;

revoke execute on function public.collect_gateway_event(uuid, text, text, text, jsonb),
  public.gateway_account_for_webhook(text), public.gateway_keys(uuid)
  from public, anon, authenticated;
grant execute on function public.collect_gateway_event(uuid, text, text, text, jsonb),
  public.gateway_account_for_webhook(text), public.gateway_keys(uuid) to service_role;
grant execute on function private.collect_gateway_event(uuid, text, text, text, jsonb),
  private.collect_link_payment(uuid, jsonb), private.collect_gateway_refund(uuid, jsonb),
  private.gateway_account_for_webhook(text), private.gateway_keys(uuid) to service_role;
