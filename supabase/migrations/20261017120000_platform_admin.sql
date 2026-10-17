-- Platform super admin, plans and trials (EP-10).
--
-- The people running Hostel ERP need to see every hostel, put a customer on
-- a plan or extend their trial, and suspend a hostel, without ever reading
-- residents' personal data or acting inside a hostel.
--
-- Rules:
-- - Plan, trial end and suspension are written only through the admin
--   functions below (or the service role). Owners and staff can read them
--   for their own hostel but never change them.
-- - A new hostel starts on a 90-day trial, counted from creation in India.
-- - A suspended hostel is a member of nobody: the membership helpers skip
--   it, so every tenant table becomes unreadable and unwritable at once.
--   Owners still see the hostel row itself (and why it was suspended)
--   through the direct owner_id test in the hostels policy.
-- - Admin functions check the caller's role first and return only counts
--   and hostel-level details, never resident rows.

alter table public.hostels
  add column plan text not null default 'trial',
  add column trial_ends_at date,
  add column suspension_reason text;

-- Existing hostels get the same 90 days from today.
update public.hostels set trial_ends_at = private.today_ist() + 90 where trial_ends_at is null;

alter table public.hostels
  add constraint hostels_plan_valid check (plan in ('trial', 'paid', 'free')),
  add constraint hostels_trial_has_end check (plan <> 'trial' or trial_ends_at is not null),
  add constraint hostels_suspension_reason_length
    check (char_length(btrim(suspension_reason)) between 1 and 500);

comment on column public.hostels.plan is
  'trial, paid or free (complimentary). Set by platform admins only.';
comment on column public.hostels.trial_ends_at is
  'Last day of the free trial (India date). Required while on trial.';
comment on column public.hostels.suspension_reason is
  'Why a platform admin suspended the hostel. Shown to the owner.';

create or replace function private.hostels_start_trial()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- Only the service role may choose a plan at creation (fixtures, imports).
  if current_user = 'authenticated' then
    new.plan := 'trial';
    new.trial_ends_at := null;
    new.suspension_reason := null;
  end if;
  if new.plan = 'trial' and new.trial_ends_at is null then
    new.trial_ends_at := private.today_ist() + 90;
  end if;
  return new;
end;
$$;

create trigger hostels_start_trial
  before insert on public.hostels
  for each row execute function private.hostels_start_trial();

-- ---------------------------------------------------------------------------
-- Suspended hostels have no members
-- ---------------------------------------------------------------------------
create or replace function private.user_hostel_ids()
returns setof uuid
language sql
stable
security definer
set search_path = ''
as $$
  select h.id from public.hostels h
  where h.owner_id = (select auth.uid()) and h.status <> 'suspended'
  union
  select p.hostel_id from public.profiles p
  join public.hostels h on h.id = p.hostel_id
  where p.id = (select auth.uid())
    and p.hostel_id is not null
    and p.deactivated_at is null
    and h.status <> 'suspended';
$$;

create or replace function private.user_owned_hostel_ids()
returns setof uuid
language sql
stable
security definer
set search_path = ''
as $$
  select h.id from public.hostels h
  where h.owner_id = (select auth.uid()) and h.status <> 'suspended';
$$;

-- ---------------------------------------------------------------------------
-- Admin functions
-- ---------------------------------------------------------------------------
create or replace function private.require_platform_admin()
returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if coalesce((select p.role from public.profiles p where p.id = (select auth.uid())), '') <> 'platform_admin' then
    raise exception 'Only platform admins can do this'
      using errcode = '42501', hint = 'not_platform_admin';
  end if;
end;
$$;

-- Every hostel with its owner and usage. Counts only; no resident data.
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
  last_activity_at timestamptz
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
      where i.hostel_id = h.id and i.status = 'issued' and i.period_month = month_start),
    (select coalesce(sum(pm.amount), 0)::bigint from public.payments pm
      where pm.hostel_id = h.id and pm.voided_at is null and pm.paid_at >= month_start),
    greatest(
      (select max(pm.created_at) from public.payments pm where pm.hostel_id = h.id),
      (select max(a.created_at) from public.allocations a where a.hostel_id = h.id),
      (select max(re.created_at) from public.residents re where re.hostel_id = h.id),
      h.updated_at
    )
  from public.hostels h
  join public.profiles op on op.id = h.owner_id
  join auth.users u on u.id = h.owner_id
  order by h.created_at desc;
end;
$$;

create or replace function private.admin_set_plan(p_hostel_id uuid, p_plan text, p_trial_ends_at date)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
  perform private.require_platform_admin();
  if p_plan not in ('trial', 'paid', 'free') then
    raise exception 'Choose trial, paid or free' using errcode = 'P0001', hint = 'plan_invalid';
  end if;
  if p_plan = 'trial' and p_trial_ends_at is null then
    raise exception 'A trial needs an end date' using errcode = 'P0001', hint = 'trial_end_required';
  end if;
  update public.hostels
     set plan = p_plan,
         trial_ends_at = case when p_plan = 'trial' then p_trial_ends_at else trial_ends_at end
   where id = p_hostel_id;
  if not found then
    raise exception 'Hostel not found' using errcode = 'P0001', hint = 'hostel_not_found';
  end if;
end;
$$;

create or replace function private.admin_set_suspended(p_hostel_id uuid, p_suspend boolean, p_reason text)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  current_status text;
begin
  perform private.require_platform_admin();
  select h.status into current_status from public.hostels h where h.id = p_hostel_id for update;
  if not found then
    raise exception 'Hostel not found' using errcode = 'P0001', hint = 'hostel_not_found';
  end if;
  if current_status = 'draft' then
    raise exception 'A hostel still being set up cannot be suspended'
      using errcode = 'P0001', hint = 'hostel_draft';
  end if;
  if p_suspend and nullif(btrim(p_reason), '') is null then
    raise exception 'Say why the hostel is suspended'
      using errcode = 'P0001', hint = 'suspension_reason_required';
  end if;
  update public.hostels
     set status = case when p_suspend then 'suspended' else 'active' end,
         suspension_reason = case when p_suspend then btrim(p_reason) else null end
   where id = p_hostel_id;
end;
$$;

-- Public wrappers are what rpc() reaches; the work runs in private.
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
  last_activity_at timestamptz
)
language sql
stable
security invoker
set search_path = ''
as $$ select * from private.admin_hostels(); $$;

create or replace function public.admin_set_plan(p_hostel_id uuid, p_plan text, p_trial_ends_at date)
returns void
language sql
volatile
security invoker
set search_path = ''
as $$ select private.admin_set_plan(p_hostel_id, p_plan, p_trial_ends_at); $$;

create or replace function public.admin_set_suspended(p_hostel_id uuid, p_suspend boolean, p_reason text)
returns void
language sql
volatile
security invoker
set search_path = ''
as $$ select private.admin_set_suspended(p_hostel_id, p_suspend, p_reason); $$;

revoke all on function private.require_platform_admin() from public, anon;
revoke all on function private.admin_hostels() from public, anon;
revoke all on function private.admin_set_plan(uuid, text, date) from public, anon;
revoke all on function private.admin_set_suspended(uuid, boolean, text) from public, anon;
revoke all on function public.admin_hostels() from public, anon;
revoke all on function public.admin_set_plan(uuid, text, date) from public, anon;
revoke all on function public.admin_set_suspended(uuid, boolean, text) from public, anon;

grant execute on function private.require_platform_admin() to authenticated;
grant execute on function private.admin_hostels() to authenticated;
grant execute on function private.admin_set_plan(uuid, text, date) to authenticated;
grant execute on function private.admin_set_suspended(uuid, boolean, text) to authenticated;
grant execute on function public.admin_hostels() to authenticated;
grant execute on function public.admin_set_plan(uuid, text, date) to authenticated;
grant execute on function public.admin_set_suspended(uuid, boolean, text) to authenticated;
