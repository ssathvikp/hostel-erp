-- Platform admin (EP-10): who is an admin, the immutable audit log, and the
-- functions behind the admin area (E10-T1 to T6, T8, T9, T11).
--
-- A platform admin is a profile with role 'platform_admin'. No app path can
-- grant it: profiles.role is not updatable by any signed-in user, and
-- signup always creates owners. It is set by scripts/admin/grant-admin.mts
-- with the service role (docs/admin.md).
--
-- Admin power needs both the role and a session verified with TOTP MFA
-- (aal2). The role is read from profiles on every call, so removing it
-- takes effect on the admin's next request, not when their token expires.
--
-- Admins are members of no hostel, so tenant RLS already refuses them every
-- customer row. They read customer data only through the functions below,
-- which check the admin first, require a reason where the plan says so,
-- and write the audit log themselves. None of them writes customer data
-- except suspension, which only changes a hostel's status.

-- The public wrappers are SQL functions defined before the private
-- functions they call; their bodies are checked when first called instead.
set check_function_bodies = off;

-- ---------------------------------------------------------------------------
-- Who is an admin
-- ---------------------------------------------------------------------------
create or replace function private.is_platform_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((select auth.jwt() ->> 'aal') = 'aal2', false)
     and exists (
       select 1 from public.profiles p
        where p.id = (select auth.uid()) and p.role = 'platform_admin'
     );
$$;

comment on function private.is_platform_admin() is
  'True for a platform_admin profile whose session passed MFA (aal2). Read on every call.';

-- Refuses everyone else with the same error, whoever they are.
create or replace function private.require_platform_admin()
returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not private.is_platform_admin() then
    raise exception 'Not found' using errcode = '42501';
  end if;
end;
$$;

create or replace function private.require_reason(p_reason text)
returns text
language plpgsql
immutable
set search_path = ''
as $$
begin
  if char_length(btrim(coalesce(p_reason, ''))) < 5 then
    raise exception 'Give a reason' using errcode = 'P0001', hint = 'reason_required';
  end if;
  return left(btrim(p_reason), 500);
end;
$$;

-- ---------------------------------------------------------------------------
-- Audit log (E10-T3)
-- ---------------------------------------------------------------------------
create table public.admin_audit_log (
  id bigint generated always as identity primary key,
  actor_id uuid,
  actor_email text not null,
  action text not null,
  -- Kept as plain values, not foreign keys: the record outlives the hostel
  -- or account it is about.
  hostel_id uuid,
  hostel_name text,
  account_id uuid,
  account_email text,
  reason text,
  details jsonb not null default '{}'::jsonb,
  request_id text,
  created_at timestamptz not null default now(),

  constraint admin_audit_log_action_valid check (action in (
    'view_account', 'view_hostel', 'suspend_hostel', 'restore_hostel',
    'resend_confirmation', 'password_reset', 'sign_out_everywhere',
    'create_announcement', 'end_announcement', 'complete_closure'
  ))
);

comment on table public.admin_audit_log is
  'Every admin look at customer data and every admin change. Written only by admin functions; never changed.';

create index admin_audit_log_created_idx on public.admin_audit_log (created_at desc);
create index admin_audit_log_hostel_idx on public.admin_audit_log (hostel_id, created_at desc);
create index admin_audit_log_actor_idx on public.admin_audit_log (actor_id, created_at desc);

create or replace function private.admin_audit_log_immutable()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  raise exception 'The admin audit log cannot be changed'
    using errcode = 'P0001', hint = 'history_immutable';
end;
$$;

create trigger admin_audit_log_immutable
  before update or delete on public.admin_audit_log
  for each row execute function private.admin_audit_log_immutable();

-- The request id the app forwards, so a log line and an audit row can be matched.
create or replace function private.request_id()
returns text
language sql
stable
set search_path = ''
as $$
  select left(nullif(current_setting('request.headers', true), '')::json ->> 'x-request-id', 64);
$$;

create or replace function private.admin_log(
  p_action text,
  p_reason text default null,
  p_hostel_id uuid default null,
  p_account_id uuid default null,
  p_details jsonb default '{}'::jsonb
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.admin_audit_log
    (actor_id, actor_email, action, hostel_id, hostel_name, account_id, account_email,
     reason, details, request_id)
  values (
    auth.uid(),
    coalesce((select u.email from auth.users u where u.id = auth.uid()), 'unknown'),
    p_action,
    p_hostel_id,
    (select h.name from public.hostels h where h.id = p_hostel_id),
    p_account_id,
    (select u.email from auth.users u where u.id = p_account_id),
    p_reason,
    coalesce(p_details, '{}'::jsonb),
    private.request_id()
  );
end;
$$;

-- Admins search the whole log.
create or replace function public.admin_audit_search(
  p_hostel_id uuid default null,
  p_actor text default null,
  p_from date default null,
  p_to date default null,
  p_page integer default 1
)
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
  select private.admin_audit_search(p_hostel_id, p_actor, p_from, p_to, p_page);
$$;

create or replace function private.admin_audit_search(
  p_hostel_id uuid,
  p_actor text,
  p_from date,
  p_to date,
  p_page integer
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  page_size constant integer := 50;
  result jsonb;
begin
  perform private.require_platform_admin();
  with matched as (
    select l.* from public.admin_audit_log l
     where (p_hostel_id is null or l.hostel_id = p_hostel_id)
       and (nullif(btrim(p_actor), '') is null or l.actor_email ilike '%' || btrim(p_actor) || '%')
       and (p_from is null or (l.created_at at time zone 'Asia/Kolkata')::date >= p_from)
       and (p_to is null or (l.created_at at time zone 'Asia/Kolkata')::date <= p_to)
  )
  select jsonb_build_object(
    'total', (select count(*) from matched),
    'rows', coalesce((
      select jsonb_agg(to_jsonb(x) order by x.created_at desc, x.id desc)
        from (select m.id, m.created_at, m.actor_email, m.action, m.hostel_id, m.hostel_name,
                     m.account_id, m.account_email, m.reason, m.details, m.request_id
                from matched m
               order by m.created_at desc, m.id desc
               limit page_size offset (greatest(coalesce(p_page, 1), 1) - 1) * page_size) x
    ), '[]'::jsonb)
  ) into result;
  return result;
end;
$$;

-- ---------------------------------------------------------------------------
-- Customer directory (E10-T4)
-- ---------------------------------------------------------------------------
create or replace function public.admin_customers(p_search text default null, p_page integer default 1)
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
  select private.admin_customers(p_search, p_page);
$$;

create or replace function private.admin_customers(p_search text, p_page integer)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  page_size constant integer := 25;
  q text := nullif(btrim(coalesce(p_search, '')), '');
  result jsonb;
begin
  perform private.require_platform_admin();
  with owners as (
    select p.id, u.email, p.full_name, u.created_at, u.email_confirmed_at, u.last_sign_in_at,
           (select count(*) from public.hostels h where h.owner_id = p.id) as hostels
      from public.profiles p
      join auth.users u on u.id = p.id
     where p.role = 'owner'
       and (q is null or u.email ilike '%' || q || '%' or p.full_name ilike '%' || q || '%'
            or exists (select 1 from public.hostels h where h.owner_id = p.id
                        and (h.name ilike '%' || q || '%' or h.city ilike '%' || q || '%'
                             or h.phone like '%' || q || '%')))
  )
  select jsonb_build_object(
    'total', (select count(*) from owners),
    'rows', coalesce((
      select jsonb_agg(to_jsonb(x) order by x.created_at desc, x.id)
        from (select * from owners o order by o.created_at desc, o.id
               limit page_size offset (greatest(coalesce(p_page, 1), 1) - 1) * page_size) x
    ), '[]'::jsonb)
  ) into result;
  return result;
end;
$$;

create or replace function public.admin_hostels(
  p_search text default null,
  p_status text default null,
  p_page integer default 1
)
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
  select private.admin_hostels(p_search, p_status, p_page);
$$;

create or replace function private.admin_hostels(p_search text, p_status text, p_page integer)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  page_size constant integer := 25;
  q text := nullif(btrim(coalesce(p_search, '')), '');
  month_start date := date_trunc('month', private.today_ist())::date;
  result jsonb;
begin
  perform private.require_platform_admin();
  with matched as (
    select h.id, h.name, h.status, h.city, h.phone, h.created_at, h.owner_id, u.email as owner_email
      from public.hostels h
      join auth.users u on u.id = h.owner_id
     where (p_status is null or h.status = p_status)
       and (q is null or h.name ilike '%' || q || '%' or h.city ilike '%' || q || '%'
            or h.phone like '%' || q || '%' or u.email ilike '%' || q || '%')
  ),
  page as (
    select * from matched m order by m.created_at desc, m.id
     limit page_size offset (greatest(coalesce(p_page, 1), 1) - 1) * page_size
  )
  select jsonb_build_object(
    'total', (select count(*) from matched),
    'rows', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', pg.id, 'name', pg.name, 'status', pg.status, 'city', pg.city, 'phone', pg.phone,
        'created_at', pg.created_at, 'owner_id', pg.owner_id, 'owner_email', pg.owner_email,
        'beds', (select count(*) from public.beds b where b.hostel_id = pg.id and b.archived_at is null),
        'active_residents', (select count(*) from public.residents r
                              where r.hostel_id = pg.id and r.status in ('active', 'notice')),
        'invoices_this_month', (select count(*) from public.invoices i
                                 where i.hostel_id = pg.id and i.period_month = month_start
                                   and i.status <> 'void'),
        'last_activity', greatest(
          (select max(a.updated_at) from public.allocations a where a.hostel_id = pg.id),
          (select max(p.created_at) from public.payments p where p.hostel_id = pg.id),
          (select max(i.created_at) from public.invoices i where i.hostel_id = pg.id),
          (select max(r.updated_at) from public.residents r where r.hostel_id = pg.id),
          (select h.updated_at from public.hostels h where h.id = pg.id)
        )
      ) order by pg.created_at desc, pg.id)
        from page pg
    ), '[]'::jsonb)
  ) into result;
  return result;
end;
$$;

-- One owner account: identity, hostels and recent admin activity. Logged.
create or replace function public.admin_account(p_account_id uuid)
returns jsonb
language sql
security invoker
set search_path = ''
as $$
  select private.admin_account(p_account_id);
$$;

create or replace function private.admin_account(p_account_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  result jsonb;
begin
  perform private.require_platform_admin();
  select jsonb_build_object(
    'id', p.id,
    'email', u.email,
    'full_name', p.full_name,
    'phone', p.phone,
    'role', p.role,
    'created_at', u.created_at,
    'email_confirmed_at', u.email_confirmed_at,
    'last_sign_in_at', u.last_sign_in_at,
    'sessions', (select count(*) from auth.sessions s where s.user_id = p.id),
    'hostels', coalesce((
      select jsonb_agg(jsonb_build_object('id', h.id, 'name', h.name, 'status', h.status,
                                          'city', h.city, 'created_at', h.created_at)
                       order by h.created_at)
        from public.hostels h where h.owner_id = p.id
    ), '[]'::jsonb),
    'activity', coalesce((
      select jsonb_agg(to_jsonb(x) order by x.created_at desc)
        from (select l.created_at, l.actor_email, l.action, l.reason, l.hostel_name
                from public.admin_audit_log l
               where l.account_id = p.id
                  or l.hostel_id in (select h.id from public.hostels h where h.owner_id = p.id)
               order by l.created_at desc limit 20) x
    ), '[]'::jsonb)
  ) into result
  from public.profiles p
  join auth.users u on u.id = p.id
  where p.id = p_account_id and p.role = 'owner';

  if result is not null then
    perform private.admin_log('view_account', null, null, p_account_id);
  end if;
  return result;
end;
$$;

-- ---------------------------------------------------------------------------
-- Read-only support view (E10-T5)
-- ---------------------------------------------------------------------------
-- What the owner sees, without the ability to change any of it. ID proofs:
-- only the type and last 4, never the file.
create or replace function public.admin_view_hostel(p_hostel_id uuid, p_reason text)
returns jsonb
language sql
security invoker
set search_path = ''
as $$
  select private.admin_view_hostel(p_hostel_id, p_reason);
$$;

create or replace function private.admin_view_hostel(p_hostel_id uuid, p_reason text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  reason text;
  month_start date := date_trunc('month', private.today_ist())::date;
  result jsonb;
begin
  perform private.require_platform_admin();
  reason := private.require_reason(p_reason);

  select jsonb_build_object(
    'hostel', jsonb_build_object(
      'id', h.id, 'name', h.name, 'status', h.status, 'type', h.type, 'phone', h.phone,
      'email', h.email, 'address', concat_ws(', ', h.address, h.city, h.state, h.pincode),
      'floors', h.floors, 'created_at', h.created_at,
      'owner_id', h.owner_id,
      'owner_email', (select u.email from auth.users u where u.id = h.owner_id)
    ),
    'occupancy', jsonb_build_object(
      'beds', (select count(*) from public.bed_states b where b.hostel_id = h.id),
      'occupied', (select count(*) from public.bed_states b
                    where b.hostel_id = h.id and b.status = 'occupied'),
      'available', (select count(*) from public.bed_states b
                     where b.hostel_id = h.id and b.status = 'available'),
      'out_of_service', (select count(*) from public.bed_states b
                          where b.hostel_id = h.id and b.status in ('blocked', 'maintenance'))
    ),
    'rooms', coalesce((
      select jsonb_agg(jsonb_build_object(
        'room_number', r.room_number, 'floor', r.floor, 'sharing_type', r.sharing_type,
        'total_beds', r.total_beds, 'occupied_beds', r.occupied_beds,
        'available_beds', r.available_beds, 'status', r.status
      ) order by r.floor, r.room_sort)
        from public.room_inventory r where r.hostel_id = h.id
    ), '[]'::jsonb),
    'residents', coalesce((
      select jsonb_agg(jsonb_build_object(
        'full_name', d.full_name, 'phone', d.phone, 'status', d.status,
        'joining_date', d.joining_date, 'bed_label', d.bed_label,
        'id_proof', upper(replace(rs.id_proof_type, '_', ' ')) || ' ending ' || rs.id_proof_last4
      ) order by d.full_name)
        from public.resident_directory d
        join public.residents rs on rs.id = d.id
       where d.hostel_id = h.id
    ), '[]'::jsonb),
    'fees', jsonb_build_object(
      'month', month_start,
      'invoiced', (select coalesce(sum(i.amount), 0) from public.invoices i
                    where i.hostel_id = h.id and i.period_month = month_start
                      and i.status <> 'void'),
      'collected', (select coalesce(sum(p.amount), 0) from public.payments p
                     where p.hostel_id = h.id and p.voided_at is null
                       and p.paid_at >= month_start),
      'invoices', coalesce((
        select jsonb_agg(jsonb_build_object(
          'resident_name', b.resident_name, 'period_month', b.period_month,
          'amount', b.amount, 'balance', b.balance, 'status', b.status
        ) order by b.period_month desc, b.resident_name)
          from (select * from public.invoice_balances ib
                 where ib.hostel_id = h.id
                 order by ib.period_month desc, ib.resident_name limit 100) b
      ), '[]'::jsonb)
    )
  ) into result
  from public.hostels h
  where h.id = p_hostel_id;

  if result is null then
    raise exception 'Not found' using errcode = 'P0001', hint = 'hostel_not_found';
  end if;
  perform private.admin_log('view_hostel', reason, p_hostel_id,
                            (select h.owner_id from public.hostels h where h.id = p_hostel_id));
  return result;
end;
$$;

-- ---------------------------------------------------------------------------
-- Email outbox
-- ---------------------------------------------------------------------------
-- Messages the platform owes a customer. They are queued here and sent by
-- a delivery job once an email provider is set up (not yet: see
-- docs/admin.md). Nothing reads them but admins.
create table public.email_outbox (
  id uuid primary key default gen_random_uuid(),
  to_email text not null,
  kind text not null,
  subject text not null,
  body text not null,
  created_at timestamptz not null default now(),
  sent_at timestamptz,
  constraint email_outbox_kind_valid check (kind in ('hostel_suspended', 'hostel_restored'))
);

create index email_outbox_unsent_idx on public.email_outbox (created_at) where sent_at is null;

-- ---------------------------------------------------------------------------
-- Suspension (E10-T6)
-- ---------------------------------------------------------------------------
-- Suspended means: the hostel leaves the app for its owner and staff (the
-- app shows only that it is suspended), nothing is deleted, and no invoice
-- or payment can be written for it. Restoring brings everything back.
create or replace function public.admin_set_hostel_status(
  p_hostel_id uuid,
  p_status text,
  p_reason text
)
returns void
language sql
security invoker
set search_path = ''
as $$
  select private.admin_set_hostel_status(p_hostel_id, p_status, p_reason);
$$;

create or replace function private.admin_set_hostel_status(
  p_hostel_id uuid,
  p_status text,
  p_reason text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  reason text;
  h record;
  owner_email text;
begin
  perform private.require_platform_admin();
  reason := private.require_reason(p_reason);
  select hs.id, hs.name, hs.status, hs.owner_id into h
    from public.hostels hs where hs.id = p_hostel_id for update;
  if h.id is null then
    raise exception 'Not found' using errcode = 'P0001', hint = 'hostel_not_found';
  end if;
  if not ((h.status = 'active' and p_status = 'suspended')
          or (h.status = 'suspended' and p_status = 'active')) then
    raise exception 'A hostel cannot move from % to %', h.status, p_status
      using errcode = 'P0001', hint = 'hostel_status_transition';
  end if;

  update public.hostels set status = p_status where id = p_hostel_id;
  perform private.admin_log(case p_status when 'suspended' then 'suspend_hostel' else 'restore_hostel' end,
                            reason, p_hostel_id, h.owner_id);

  select u.email into owner_email from auth.users u where u.id = h.owner_id;
  insert into public.email_outbox (to_email, kind, subject, body)
  values (
    owner_email,
    case p_status when 'suspended' then 'hostel_suspended' else 'hostel_restored' end,
    case p_status
      when 'suspended' then h.name || ' has been suspended on Hostel ERP'
      else h.name || ' is active again on Hostel ERP'
    end,
    case p_status
      when 'suspended' then
        'Your hostel ' || h.name || ' has been suspended. You and your staff cannot work in it '
        || 'until it is restored. None of its data has been deleted. To find out why, or to '
        || 'restore it, reply to this email or contact Hostel ERP support.'
      else
        'Your hostel ' || h.name || ' is active again. You and your staff can sign in and work '
        || 'in it as before; all of its data is as you left it.'
    end
  );
end;
$$;

-- No new money for a hostel that is not active.
create or replace function private.require_active_hostel()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if (select h.status from public.hostels h where h.id = new.hostel_id) <> 'active' then
    raise exception 'This hostel is suspended' using errcode = 'P0001', hint = 'hostel_suspended';
  end if;
  return new;
end;
$$;

create trigger invoices_require_active_hostel
  before insert on public.invoices
  for each row execute function private.require_active_hostel();
create trigger payments_require_active_hostel
  before insert on public.payments
  for each row execute function private.require_active_hostel();

-- ---------------------------------------------------------------------------
-- Platform metrics (E10-T8)
-- ---------------------------------------------------------------------------
-- Aggregates only: no customer names.
create or replace function public.admin_platform_metrics()
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
  select private.admin_platform_metrics();
$$;

create or replace function private.admin_platform_metrics()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  today date := private.today_ist();
  result jsonb;
begin
  perform private.require_platform_admin();
  select jsonb_build_object(
    'owners', (select count(*) from public.profiles p where p.role = 'owner'),
    'hostels', jsonb_build_object(
      'total', (select count(*) from public.hostels),
      'draft', (select count(*) from public.hostels where status = 'draft'),
      'active', (select count(*) from public.hostels where status = 'active'),
      'suspended', (select count(*) from public.hostels where status = 'suspended')
    ),
    -- Owners who created a hostel and finished onboarding at least one.
    'onboarding_rate', (
      select case when count(*) = 0 then null
                  else round(100.0 * count(*) filter (where finished) / count(*), 1) end
        from (select bool_or(h.status <> 'draft') as finished
                from public.hostels h group by h.owner_id) o
    ),
    'active_last_30_days', (
      select count(distinct x.hostel_id) from (
        select a.hostel_id from public.allocation_events a where a.created_at > now() - interval '30 days'
        union all
        select p.hostel_id from public.payments p where p.created_at > now() - interval '30 days'
        union all
        select i.hostel_id from public.invoices i where i.created_at > now() - interval '30 days'
        union all
        select r.hostel_id from public.residents r where r.created_at > now() - interval '30 days'
      ) x
    ),
    'beds', (select count(*) from public.bed_states),
    'occupied_beds', (select count(*) from public.bed_states where status = 'occupied'),
    'residents', (select count(*) from public.residents where status in ('active', 'notice')),
    'signups_by_week', coalesce((
      select jsonb_agg(jsonb_build_object('week', w.week, 'count', w.count) order by w.week)
        from (select date_trunc('week', u.created_at at time zone 'Asia/Kolkata')::date as week,
                     count(*) as count
                from auth.users u join public.profiles p on p.id = u.id and p.role = 'owner'
               where u.created_at > now() - interval '12 weeks'
               group by 1) w
    ), '[]'::jsonb),
    'money_by_month', coalesce((
      select jsonb_agg(jsonb_build_object(
        'month', m.month,
        'invoices', (select count(*) from public.invoices i
                      where i.period_month = m.month and i.status <> 'void'),
        'invoiced', (select coalesce(sum(i.amount), 0) from public.invoices i
                      where i.period_month = m.month and i.status <> 'void'),
        'payments', (select count(*) from public.payments p
                      where p.voided_at is null
                        and date_trunc('month', p.paid_at)::date = m.month),
        'collected', (select coalesce(sum(p.amount), 0) from public.payments p
                       where p.voided_at is null
                         and date_trunc('month', p.paid_at)::date = m.month)
      ) order by m.month)
        from (select (date_trunc('month', today) - make_interval(months => n))::date as month
                from generate_series(0, 5) n) m
    ), '[]'::jsonb)
  ) into result;
  return result;
end;
$$;

-- ---------------------------------------------------------------------------
-- Account support (E10-T9)
-- ---------------------------------------------------------------------------
-- Admins never see or set a password. The app sends the confirmation or
-- reset email through Supabase Auth after this records the action and
-- returns the owner's address.
create or replace function public.admin_support_action(
  p_account_id uuid,
  p_action text,
  p_reason text
)
returns text
language sql
security invoker
set search_path = ''
as $$
  select private.admin_support_action(p_account_id, p_action, p_reason);
$$;

create or replace function private.admin_support_action(
  p_account_id uuid,
  p_action text,
  p_reason text
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  reason text;
  account record;
begin
  perform private.require_platform_admin();
  reason := private.require_reason(p_reason);
  select u.id, u.email, u.email_confirmed_at into account
    from auth.users u join public.profiles p on p.id = u.id and p.role = 'owner'
   where u.id = p_account_id;
  if account.id is null then
    raise exception 'Not found' using errcode = 'P0001', hint = 'account_not_found';
  end if;

  if p_action = 'resend_confirmation' then
    if account.email_confirmed_at is not null then
      raise exception 'This email address is already confirmed'
        using errcode = 'P0001', hint = 'already_confirmed';
    end if;
  elsif p_action = 'sign_out_everywhere' then
    -- Ends every refresh token; access tokens expire within the hour.
    delete from auth.sessions s where s.user_id = account.id;
  elsif p_action <> 'password_reset' then
    raise exception 'Unknown action' using errcode = 'P0001', hint = 'support_action';
  end if;

  perform private.admin_log(p_action, reason, null, account.id);
  return account.email;
end;
$$;

-- ---------------------------------------------------------------------------
-- Announcements (E10-T11)
-- ---------------------------------------------------------------------------
create table public.announcements (
  id uuid primary key default gen_random_uuid(),
  message text not null,
  severity text not null default 'info',
  starts_at timestamptz not null default now(),
  ends_at timestamptz not null,
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  constraint announcements_message_length check (char_length(btrim(message)) between 1 and 500),
  constraint announcements_severity_valid check (severity in ('info', 'warning', 'critical')),
  constraint announcements_window check (ends_at > starts_at)
);

create index announcements_window_idx on public.announcements (ends_at, starts_at);

create table public.announcement_dismissals (
  announcement_id uuid not null references public.announcements (id) on delete cascade,
  user_id uuid not null default auth.uid() references public.profiles (id) on delete cascade,
  dismissed_at timestamptz not null default now(),
  primary key (announcement_id, user_id)
);

create or replace function public.admin_create_announcement(
  p_message text,
  p_severity text,
  p_starts_at timestamptz,
  p_ends_at timestamptz
)
returns uuid
language sql
security invoker
set search_path = ''
as $$
  select private.admin_create_announcement(p_message, p_severity, p_starts_at, p_ends_at);
$$;

create or replace function private.admin_create_announcement(
  p_message text,
  p_severity text,
  p_starts_at timestamptz,
  p_ends_at timestamptz
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  created uuid;
begin
  perform private.require_platform_admin();
  insert into public.announcements (message, severity, starts_at, ends_at, created_by)
  values (btrim(p_message), p_severity, coalesce(p_starts_at, now()), p_ends_at, auth.uid())
  returning id into created;
  perform private.admin_log('create_announcement', null, null, null,
                            jsonb_build_object('announcement_id', created, 'message', btrim(p_message),
                                               'severity', p_severity));
  return created;
end;
$$;

create or replace function public.admin_end_announcement(p_announcement_id uuid)
returns void
language sql
security invoker
set search_path = ''
as $$
  select private.admin_end_announcement(p_announcement_id);
$$;

create or replace function private.admin_end_announcement(p_announcement_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.require_platform_admin();
  update public.announcements set ends_at = greatest(starts_at + interval '1 second', now())
   where id = p_announcement_id and ends_at > now();
  if found then
    perform private.admin_log('end_announcement', null, null, null,
                              jsonb_build_object('announcement_id', p_announcement_id));
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- Privileges and row-level security
-- ---------------------------------------------------------------------------
alter table public.admin_audit_log enable row level security;
alter table public.email_outbox enable row level security;
alter table public.announcements enable row level security;
alter table public.announcement_dismissals enable row level security;

revoke all on public.admin_audit_log, public.email_outbox, public.announcements,
  public.announcement_dismissals from authenticated, anon;

-- Owners see that support looked at their hostel, and why: never who.
grant select (id, hostel_id, action, reason, created_at) on public.admin_audit_log to authenticated;
create policy "admin audit log: owners see support views of their hostels"
  on public.admin_audit_log for select to authenticated
  using (action = 'view_hostel' and hostel_id in (select private.user_owned_hostel_ids()));

-- Admins read the outbox; nobody writes it but the functions above.
grant select on public.email_outbox to authenticated;
create policy "email outbox: admins read"
  on public.email_outbox for select to authenticated
  using ((select private.is_platform_admin()));

grant select on public.announcements to authenticated;
create policy "announcements: everyone reads current ones, admins read all"
  on public.announcements for select to authenticated
  using ((starts_at <= now() and ends_at > now()) or (select private.is_platform_admin()));

grant select, insert on public.announcement_dismissals to authenticated;
create policy "announcement dismissals: own"
  on public.announcement_dismissals for select to authenticated
  using (user_id = (select auth.uid()));
create policy "announcement dismissals: add own"
  on public.announcement_dismissals for insert to authenticated
  with check (user_id = (select auth.uid()));

revoke all on function private.is_platform_admin(), private.require_platform_admin(),
  private.require_reason(text), private.admin_audit_log_immutable(), private.request_id(),
  private.admin_log(text, text, uuid, uuid, jsonb),
  private.admin_audit_search(uuid, text, date, date, integer),
  private.admin_customers(text, integer), private.admin_hostels(text, text, integer),
  private.admin_account(uuid), private.admin_view_hostel(uuid, text),
  private.admin_set_hostel_status(uuid, text, text), private.require_active_hostel(),
  private.admin_platform_metrics(), private.admin_support_action(uuid, text, text),
  private.admin_create_announcement(text, text, timestamptz, timestamptz),
  private.admin_end_announcement(uuid) from public;

-- Every admin function checks the admin itself, so any signed-in user may
-- call one and be refused.
grant execute on function private.is_platform_admin(), private.require_platform_admin(),
  private.require_reason(text), private.request_id(),
  private.admin_audit_search(uuid, text, date, date, integer),
  private.admin_customers(text, integer), private.admin_hostels(text, text, integer),
  private.admin_account(uuid), private.admin_view_hostel(uuid, text),
  private.admin_set_hostel_status(uuid, text, text), private.admin_platform_metrics(),
  private.admin_support_action(uuid, text, text),
  private.admin_create_announcement(text, text, timestamptz, timestamptz),
  private.admin_end_announcement(uuid) to authenticated;

revoke execute on function public.admin_audit_search(uuid, text, date, date, integer),
  public.admin_customers(text, integer), public.admin_hostels(text, text, integer),
  public.admin_account(uuid), public.admin_view_hostel(uuid, text),
  public.admin_set_hostel_status(uuid, text, text), public.admin_platform_metrics(),
  public.admin_support_action(uuid, text, text),
  public.admin_create_announcement(text, text, timestamptz, timestamptz),
  public.admin_end_announcement(uuid) from public, anon;
grant execute on function public.admin_audit_search(uuid, text, date, date, integer),
  public.admin_customers(text, integer), public.admin_hostels(text, text, integer),
  public.admin_account(uuid), public.admin_view_hostel(uuid, text),
  public.admin_set_hostel_status(uuid, text, text), public.admin_platform_metrics(),
  public.admin_support_action(uuid, text, text),
  public.admin_create_announcement(text, text, timestamptz, timestamptz),
  public.admin_end_announcement(uuid) to authenticated;
