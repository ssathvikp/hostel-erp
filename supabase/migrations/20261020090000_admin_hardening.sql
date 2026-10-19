-- Platform admin hardening (ClickUp EP-10).
--
-- 1. An immutable audit log of every admin action (E10-T3).
-- 2. Plan changes, suspension and restoring need a reason and are logged.
-- 3. A customer directory of owners, searched and paged in the database (E10-T4).
-- 4. A read-only support view into a hostel, opened with a reason, shown to
--    its owner, with identity numbers masked (E10-T5).
-- 5. Support actions without passwords: sign an account out everywhere,
--    and a record of the e-mail actions the app sends through Supabase Auth (E10-T8).
-- 6. Announcements from the platform to every owner and staff member (E10-T11).
-- 7. Admin functions require a second factor (aal2) (E10-T1).
--
-- Earlier migrations are not edited.

-- ---------------------------------------------------------------------------
-- 1. Admin audit log
-- ---------------------------------------------------------------------------
-- Snapshots of names and e-mails are kept so an entry stays readable after
-- the person or hostel is gone. No foreign keys: nothing may ever change or
-- remove an entry, not even a cascade.
create table public.admin_audit_log (
  id bigint generated always as identity primary key,
  actor_id uuid not null,
  actor_email text not null,
  action text not null,
  hostel_id uuid,
  hostel_name text,
  target_user_id uuid,
  target_email text,
  reason text,
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),

  constraint admin_audit_log_action_valid check (action in (
    'plan_changed', 'hostel_suspended', 'hostel_restored', 'trial_length_changed',
    'support_view_opened', 'signed_out_everywhere', 'confirmation_resent',
    'password_reset_sent', 'announcement_created', 'announcement_ended'
  )),
  constraint admin_audit_log_reason_length check (char_length(btrim(reason)) between 1 and 500),
  constraint admin_audit_log_details_object check (jsonb_typeof(details) = 'object')
);

comment on table public.admin_audit_log is
  'Append-only record of every platform admin action. Written only by admin functions; never updated or deleted.';

create index admin_audit_log_created_idx on public.admin_audit_log (created_at desc);
create index admin_audit_log_hostel_idx on public.admin_audit_log (hostel_id, created_at desc)
  where hostel_id is not null;
create index admin_audit_log_actor_idx on public.admin_audit_log (actor_id, created_at desc);

alter table public.admin_audit_log enable row level security;
revoke all on public.admin_audit_log from authenticated, anon;

create or replace function private.admin_audit_log_immutable()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  raise exception 'Admin audit entries cannot be changed or removed'
    using errcode = 'P0001', hint = 'audit_immutable';
end;
$$;

create trigger admin_audit_log_immutable
  before update or delete on public.admin_audit_log
  for each row execute function private.admin_audit_log_immutable();

-- Actions that must say why. The others (settings, announcements) explain
-- themselves through their details.
create or replace function private.admin_reason_required(p_action text)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select p_action in (
    'plan_changed', 'hostel_suspended', 'hostel_restored', 'support_view_opened',
    'signed_out_everywhere', 'confirmation_resent', 'password_reset_sent'
  );
$$;

-- Writes one entry for the calling admin. Callers check the role first.
create or replace function private.admin_audit(
  p_action text,
  p_hostel_id uuid,
  p_target_user_id uuid,
  p_reason text,
  p_details jsonb default '{}'::jsonb
)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  reason text := nullif(btrim(p_reason), '');
begin
  if private.admin_reason_required(p_action) and reason is null then
    raise exception 'Say why' using errcode = 'P0001', hint = 'reason_required';
  end if;
  insert into public.admin_audit_log
    (actor_id, actor_email, action, hostel_id, hostel_name, target_user_id, target_email,
     reason, details)
  values (
    (select auth.uid()),
    coalesce((select u.email::text from auth.users u where u.id = (select auth.uid())), ''),
    p_action,
    p_hostel_id,
    (select h.name from public.hostels h where h.id = p_hostel_id),
    p_target_user_id,
    (select u.email::text from auth.users u where u.id = p_target_user_id),
    left(reason, 500),
    coalesce(p_details, '{}'::jsonb)
  );
end;
$$;

revoke all on function private.admin_audit(text, uuid, uuid, text, jsonb) from public, anon, authenticated;
revoke all on function private.admin_reason_required(text) from public, anon;
grant execute on function private.admin_reason_required(text) to authenticated;

-- ---------------------------------------------------------------------------
-- 7. A second factor for admins
-- ---------------------------------------------------------------------------
-- Every admin function calls this first. A session that signed in with a
-- password only (aal1) is refused until the admin completes the TOTP step.
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
  if coalesce((select auth.jwt()) ->> 'aal', '') <> 'aal2' then
    raise exception 'Confirm your sign-in with your authenticator app first'
      using errcode = '42501', hint = 'mfa_required';
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- 2. Plan and suspension changes with a reason
-- ---------------------------------------------------------------------------
drop function public.admin_set_plan(uuid, text, date);
drop function private.admin_set_plan(uuid, text, date);

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
  select h.plan, h.trial_ends_at into prev from public.hostels h where h.id = p_hostel_id for update;
  if not found then
    raise exception 'Hostel not found' using errcode = 'P0001', hint = 'hostel_not_found';
  end if;
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

create or replace function public.admin_set_plan(
  p_hostel_id uuid,
  p_plan text,
  p_trial_ends_at date,
  p_reason text
)
returns void
language sql
volatile
security invoker
set search_path = ''
as $$ select private.admin_set_plan(p_hostel_id, p_plan, p_trial_ends_at, p_reason); $$;

-- Same signature as before; restoring now needs a reason too.
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
  if nullif(btrim(p_reason), '') is null then
    raise exception 'Say why'
      using errcode = 'P0001',
            hint = case when p_suspend then 'suspension_reason_required' else 'reason_required' end;
  end if;
  update public.hostels
     set status = case when p_suspend then 'suspended' else 'active' end,
         suspension_reason = case when p_suspend then btrim(p_reason) else null end
   where id = p_hostel_id;
  perform private.admin_audit(
    case when p_suspend then 'hostel_suspended' else 'hostel_restored' end,
    p_hostel_id, null, p_reason, jsonb_build_object('status_before', current_status)
  );
end;
$$;

-- Unchanged from 20261019090000 apart from the audit entry.
create or replace function private.admin_set_trial_days(p_days integer)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  prev integer := private.trial_days();
begin
  perform private.require_platform_admin();
  if p_days is null or p_days not between 7 and 180 then
    raise exception 'Choose between 7 and 180 days' using errcode = 'P0001', hint = 'trial_days_range';
  end if;
  -- The one row. Supabase refuses an update with no where clause.
  update public.platform_settings
     set trial_days = p_days, updated_at = now(), updated_by = (select auth.uid())
   where id;
  perform private.admin_audit('trial_length_changed', null, null, null,
    jsonb_build_object('from', prev, 'to', p_days));
end;
$$;

-- ---------------------------------------------------------------------------
-- Reading the audit log
-- ---------------------------------------------------------------------------
create or replace function private.admin_audit_entries(
  p_hostel_id uuid default null,
  p_actor_id uuid default null,
  p_from date default null,
  p_to date default null,
  p_limit integer default 50,
  p_offset integer default 0,
  p_target_user_id uuid default null
)
returns table (
  id bigint,
  created_at timestamptz,
  actor_email text,
  action text,
  hostel_id uuid,
  hostel_name text,
  target_email text,
  reason text,
  details jsonb,
  total bigint
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform private.require_platform_admin();
  return query
  select a.id, a.created_at, a.actor_email, a.action, a.hostel_id, a.hostel_name,
         a.target_email, a.reason, a.details, count(*) over ()
    from public.admin_audit_log a
   where (p_hostel_id is null or a.hostel_id = p_hostel_id)
     and (p_actor_id is null or a.actor_id = p_actor_id)
     and (p_target_user_id is null or a.target_user_id = p_target_user_id)
     and (p_from is null or a.created_at >= (p_from::timestamp at time zone 'Asia/Kolkata'))
     and (p_to is null or a.created_at < ((p_to + 1)::timestamp at time zone 'Asia/Kolkata'))
   order by a.created_at desc, a.id desc
   limit least(greatest(coalesce(p_limit, 50), 1), 200)
  offset greatest(coalesce(p_offset, 0), 0);
end;
$$;

create or replace function public.admin_audit_entries(
  p_hostel_id uuid default null,
  p_actor_id uuid default null,
  p_from date default null,
  p_to date default null,
  p_limit integer default 50,
  p_offset integer default 0,
  p_target_user_id uuid default null
)
returns table (
  id bigint,
  created_at timestamptz,
  actor_email text,
  action text,
  hostel_id uuid,
  hostel_name text,
  target_email text,
  reason text,
  details jsonb,
  total bigint
)
language sql
stable
security invoker
set search_path = ''
as $$
  select * from private.admin_audit_entries(
    p_hostel_id, p_actor_id, p_from, p_to, p_limit, p_offset, p_target_user_id);
$$;

-- The admins, for the audit log's "by" filter.
create or replace function private.admin_list_admins()
returns table (id uuid, full_name text, email text)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform private.require_platform_admin();
  return query
  select p.id, p.full_name, u.email::text
    from public.profiles p join auth.users u on u.id = p.id
   where p.role = 'platform_admin'
   order by p.full_name;
end;
$$;

create or replace function public.admin_list_admins()
returns table (id uuid, full_name text, email text)
language sql
stable
security invoker
set search_path = ''
as $$ select * from private.admin_list_admins(); $$;

-- ---------------------------------------------------------------------------
-- 3. Customer directory
-- ---------------------------------------------------------------------------
-- Owners with their account state and hostels. Search matches name, e-mail,
-- phone, or the name or city of any of their hostels. Paged here, so the
-- page stays fast with thousands of owners.
create or replace function private.admin_owners(
  p_search text default null,
  p_limit integer default 50,
  p_offset integer default 0,
  p_owner_id uuid default null
)
returns table (
  id uuid,
  full_name text,
  email text,
  phone text,
  created_at timestamptz,
  email_confirmed_at timestamptz,
  last_sign_in_at timestamptz,
  hostels integer,
  active_hostels integer,
  draft_hostels integer,
  referred_by_name text,
  total bigint
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  pattern text := '%' || replace(replace(replace(lower(btrim(coalesce(p_search, ''))), '\', '\\'), '%', '\%'), '_', '\_') || '%';
begin
  perform private.require_platform_admin();
  return query
  select
    p.id, p.full_name, u.email::text, p.phone, p.created_at, u.email_confirmed_at,
    u.last_sign_in_at,
    (select count(*)::integer from public.hostels h where h.owner_id = p.id),
    (select count(*)::integer from public.hostels h where h.owner_id = p.id and h.status = 'active'),
    (select count(*)::integer from public.hostels h where h.owner_id = p.id and h.status = 'draft'),
    rp.full_name,
    count(*) over ()
  from public.profiles p
  join auth.users u on u.id = p.id
  left join public.profiles rp on rp.id = p.referred_by
  where p.role = 'owner'
    and (p_owner_id is null or p.id = p_owner_id)
    and (
      pattern = '%%'
      or lower(p.full_name) like pattern
      or lower(u.email::text) like pattern
      or coalesce(p.phone, '') like pattern
      or exists (
        select 1 from public.hostels h
         where h.owner_id = p.id
           and (lower(h.name) like pattern or lower(coalesce(h.city, '')) like pattern
                or h.phone like pattern)
      )
    )
  order by p.created_at desc, p.id
  limit least(greatest(coalesce(p_limit, 50), 1), 200)
  offset greatest(coalesce(p_offset, 0), 0);
end;
$$;

create or replace function public.admin_owners(
  p_search text default null,
  p_limit integer default 50,
  p_offset integer default 0,
  p_owner_id uuid default null
)
returns table (
  id uuid,
  full_name text,
  email text,
  phone text,
  created_at timestamptz,
  email_confirmed_at timestamptz,
  last_sign_in_at timestamptz,
  hostels integer,
  active_hostels integer,
  draft_hostels integer,
  referred_by_name text,
  total bigint
)
language sql
stable
security invoker
set search_path = ''
as $$ select * from private.admin_owners(p_search, p_limit, p_offset, p_owner_id); $$;

-- ---------------------------------------------------------------------------
-- 4. Read-only support view
-- ---------------------------------------------------------------------------
-- An admin opens the view with a reason; it lasts an hour. The owner sees
-- every opening in Settings → Hostel. The snapshot is built here and
-- returned as data: admins are members of no hostel, so no tenant table is
-- ever readable or writable to them directly.
create table public.support_access (
  id uuid primary key default gen_random_uuid(),
  hostel_id uuid not null references public.hostels (id) on delete cascade,
  admin_id uuid not null,
  admin_name text not null,
  reason text not null,
  opened_at timestamptz not null default now(),
  expires_at timestamptz not null default now() + interval '1 hour',
  constraint support_access_reason_length check (char_length(btrim(reason)) between 1 and 500)
);

comment on table public.support_access is
  'Each time a platform admin opened the read-only support view of a hostel. Shown to the owner.';

create index support_access_hostel_idx on public.support_access (hostel_id, opened_at desc);

alter table public.support_access enable row level security;
revoke all on public.support_access from authenticated, anon;
grant select (id, hostel_id, admin_name, reason, opened_at) on public.support_access to authenticated;

-- Owners see openings of their own hostels, suspended ones included.
create policy "support access: owners read"
  on public.support_access for select
  to authenticated
  using (hostel_id in (select h.id from public.hostels h where h.owner_id = (select auth.uid())));

create or replace function private.admin_open_support_view(p_hostel_id uuid, p_reason text)
returns uuid
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  result uuid;
begin
  perform private.require_platform_admin();
  if not exists (select 1 from public.hostels h where h.id = p_hostel_id) then
    raise exception 'Hostel not found' using errcode = 'P0001', hint = 'hostel_not_found';
  end if;
  if nullif(btrim(p_reason), '') is null then
    raise exception 'Say why you need to see this hostel'
      using errcode = 'P0001', hint = 'reason_required';
  end if;
  insert into public.support_access (hostel_id, admin_id, admin_name, reason)
  values (
    p_hostel_id,
    (select auth.uid()),
    coalesce((select p.full_name from public.profiles p where p.id = (select auth.uid())), 'Support'),
    left(btrim(p_reason), 500)
  )
  returning id into result;
  perform private.admin_audit('support_view_opened', p_hostel_id, null, p_reason, '{}'::jsonb);
  return result;
end;
$$;

-- Identity and contact numbers show their last four digits only.
create or replace function private.mask_digits(p_value text)
returns text
language sql
immutable
set search_path = ''
as $$
  select case when p_value is null or p_value = '' then null
              else repeat('•', greatest(char_length(p_value) - 4, 0)) || right(p_value, 4) end;
$$;

create or replace function private.admin_support_snapshot(p_hostel_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  today date := private.today_ist();
  access record;
  result jsonb;
begin
  perform private.require_platform_admin();
  select s.opened_at, s.expires_at, s.reason into access
    from public.support_access s
   where s.hostel_id = p_hostel_id and s.admin_id = (select auth.uid()) and s.expires_at > now()
   order by s.opened_at desc
   limit 1;
  if not found then
    raise exception 'Open the support view with a reason first'
      using errcode = 'P0001', hint = 'support_view_closed';
  end if;

  select jsonb_build_object(
    'opened_at', access.opened_at,
    'expires_at', access.expires_at,
    'reason', access.reason,
    'rooms', coalesce((
      select jsonb_agg(jsonb_build_object(
               'room_number', r.room_number,
               'floor', r.floor,
               'sharing_type', r.sharing_type,
               'status', r.status,
               'beds', (
                 select coalesce(jsonb_agg(jsonb_build_object(
                          'label', bs.bed_label,
                          'status', bs.status,
                          'occupant', (
                            select re.full_name from public.allocations a
                              join public.residents re on re.id = a.resident_id
                             where a.bed_id = bs.id and a.start_date <= today
                               and (a.end_date is null or a.end_date >= today)
                             limit 1)
                        ) order by bs.bed_label), '[]'::jsonb)
                   from public.bed_states bs where bs.room_id = r.id)
             ) order by r.floor, lpad(r.room_number, 20, '0'))
        from public.rooms r where r.hostel_id = p_hostel_id
    ), '[]'::jsonb),
    'residents', coalesce((
      select jsonb_agg(jsonb_build_object(
               'full_name', re.full_name,
               'phone', private.mask_digits(re.phone),
               'status', re.status,
               'joining_date', re.joining_date,
               'id_proof_type', re.id_proof_type,
               'id_proof', private.mask_digits(re.id_proof_last4),
               'erased', re.erased_at is not null
             ) order by re.full_name)
        from (select * from public.residents x where x.hostel_id = p_hostel_id
               order by x.full_name limit 500) re
    ), '[]'::jsonb),
    'residents_total', (select count(*) from public.residents x where x.hostel_id = p_hostel_id),
    'fees', jsonb_build_object(
      'outstanding', coalesce((select sum(b.balance) from public.invoice_balances b
                                where b.hostel_id = p_hostel_id and b.status = 'issued'), 0),
      'overdue', coalesce((select sum(b.balance) from public.invoice_balances b
                            where b.hostel_id = p_hostel_id and b.due_status = 'overdue'), 0),
      'recent', coalesce((
        select jsonb_agg(jsonb_build_object(
                 'period_month', b.period_month,
                 'kind', b.kind,
                 'resident_name', b.resident_name,
                 'amount', b.amount,
                 'paid', b.paid,
                 'due_status', b.due_status
               ) order by b.period_month desc, b.resident_name)
          from (select * from public.invoice_balances y
                 where y.hostel_id = p_hostel_id and y.status = 'issued'
                 order by y.period_month desc, y.resident_name limit 50) b
      ), '[]'::jsonb)
    )
  ) into result;
  return result;
end;
$$;

create or replace function public.admin_open_support_view(p_hostel_id uuid, p_reason text)
returns uuid
language sql
volatile
security invoker
set search_path = ''
as $$ select private.admin_open_support_view(p_hostel_id, p_reason); $$;

create or replace function public.admin_support_snapshot(p_hostel_id uuid)
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$ select private.admin_support_snapshot(p_hostel_id); $$;

-- ---------------------------------------------------------------------------
-- 5. Support actions
-- ---------------------------------------------------------------------------
-- Ends every session of an owner or staff member, e.g. after a lost phone.
-- Their current access token runs out within the hour; no refresh works.
create or replace function private.admin_sign_out_everywhere(p_user_id uuid, p_reason text)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  target_role text;
begin
  perform private.require_platform_admin();
  select p.role into target_role from public.profiles p where p.id = p_user_id;
  if target_role is null or target_role = 'platform_admin' then
    raise exception 'Account not found' using errcode = 'P0001', hint = 'account_not_found';
  end if;
  if nullif(btrim(p_reason), '') is null then
    raise exception 'Say why' using errcode = 'P0001', hint = 'reason_required';
  end if;
  delete from auth.sessions where user_id = p_user_id;
  perform private.admin_audit('signed_out_everywhere', null, p_user_id, p_reason, '{}'::jsonb);
end;
$$;

-- The app sends confirmation and reset e-mails through Supabase Auth; this
-- records that an admin did, with why. Only those two actions.
create or replace function private.admin_record_email_action(
  p_action text,
  p_user_id uuid,
  p_reason text
)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
  perform private.require_platform_admin();
  if p_action not in ('confirmation_resent', 'password_reset_sent') then
    raise exception 'Unknown action' using errcode = 'P0001', hint = 'action_invalid';
  end if;
  if not exists (select 1 from public.profiles p where p.id = p_user_id and p.role <> 'platform_admin') then
    raise exception 'Account not found' using errcode = 'P0001', hint = 'account_not_found';
  end if;
  perform private.admin_audit(p_action, null, p_user_id, p_reason, '{}'::jsonb);
end;
$$;

create or replace function public.admin_sign_out_everywhere(p_user_id uuid, p_reason text)
returns void
language sql
volatile
security invoker
set search_path = ''
as $$ select private.admin_sign_out_everywhere(p_user_id, p_reason); $$;

create or replace function public.admin_record_email_action(p_action text, p_user_id uuid, p_reason text)
returns void
language sql
volatile
security invoker
set search_path = ''
as $$ select private.admin_record_email_action(p_action, p_user_id, p_reason); $$;

-- ---------------------------------------------------------------------------
-- 6. Announcements
-- ---------------------------------------------------------------------------
create table public.announcements (
  id uuid primary key default gen_random_uuid(),
  message text not null,
  severity text not null default 'info',
  starts_at timestamptz not null default now(),
  ends_at timestamptz,
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  constraint announcements_message_length check (char_length(btrim(message)) between 1 and 500),
  constraint announcements_severity_valid check (severity in ('info', 'warning')),
  constraint announcements_ends_after_start check (ends_at is null or ends_at >= starts_at)
);

comment on table public.announcements is
  'Messages from the platform to every signed-in owner and staff member, between starts_at and ends_at.';

alter table public.announcements enable row level security;
revoke all on public.announcements from authenticated, anon;
grant select (id, message, severity, starts_at, ends_at) on public.announcements to authenticated;

create policy "announcements: signed-in users read live ones"
  on public.announcements for select
  to authenticated
  using (starts_at <= now() and (ends_at is null or ends_at > now()));

create table public.announcement_dismissals (
  user_id uuid not null references public.profiles (id) on delete cascade,
  announcement_id uuid not null references public.announcements (id) on delete cascade,
  dismissed_at timestamptz not null default now(),
  primary key (user_id, announcement_id)
);

alter table public.announcement_dismissals enable row level security;
revoke all on public.announcement_dismissals from authenticated, anon;
grant select, insert (user_id, announcement_id) on public.announcement_dismissals to authenticated;

create policy "announcement dismissals: own rows"
  on public.announcement_dismissals for select
  to authenticated
  using (user_id = (select auth.uid()));

create policy "announcement dismissals: dismiss for yourself"
  on public.announcement_dismissals for insert
  to authenticated
  with check (user_id = (select auth.uid()));

create or replace function private.admin_create_announcement(
  p_message text,
  p_severity text,
  p_starts_at timestamptz default null,
  p_ends_at timestamptz default null
)
returns uuid
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  result uuid;
begin
  perform private.require_platform_admin();
  if nullif(btrim(p_message), '') is null then
    raise exception 'Write the message' using errcode = 'P0001', hint = 'message_required';
  end if;
  if p_ends_at is not null and p_ends_at <= coalesce(p_starts_at, now()) then
    raise exception 'The end must be after the start'
      using errcode = 'P0001', hint = 'announcement_dates';
  end if;
  insert into public.announcements (message, severity, starts_at, ends_at, created_by)
  values (btrim(p_message), coalesce(p_severity, 'info'), coalesce(p_starts_at, now()), p_ends_at,
          (select auth.uid()))
  returning id into result;
  perform private.admin_audit('announcement_created', null, null, null,
    jsonb_build_object('announcement_id', result, 'message', btrim(p_message)));
  return result;
end;
$$;

create or replace function private.admin_end_announcement(p_id uuid)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
  perform private.require_platform_admin();
  update public.announcements
     set ends_at = greatest(now(), starts_at)
   where id = p_id and (ends_at is null or ends_at > now());
  if not found then
    raise exception 'Announcement not found or already ended'
      using errcode = 'P0001', hint = 'announcement_not_found';
  end if;
  perform private.admin_audit('announcement_ended', null, null, null,
    jsonb_build_object('announcement_id', p_id));
end;
$$;

-- Every announcement, newest first, for the admin page.
create or replace function private.admin_announcements()
returns table (
  id uuid,
  message text,
  severity text,
  starts_at timestamptz,
  ends_at timestamptz,
  created_at timestamptz,
  dismissals integer
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform private.require_platform_admin();
  return query
  select a.id, a.message, a.severity, a.starts_at, a.ends_at, a.created_at,
         (select count(*)::integer from public.announcement_dismissals d where d.announcement_id = a.id)
    from public.announcements a
   order by a.created_at desc
   limit 100;
end;
$$;

create or replace function public.admin_create_announcement(
  p_message text,
  p_severity text,
  p_starts_at timestamptz default null,
  p_ends_at timestamptz default null
)
returns uuid
language sql
volatile
security invoker
set search_path = ''
as $$ select private.admin_create_announcement(p_message, p_severity, p_starts_at, p_ends_at); $$;

create or replace function public.admin_end_announcement(p_id uuid)
returns void
language sql
volatile
security invoker
set search_path = ''
as $$ select private.admin_end_announcement(p_id); $$;

create or replace function public.admin_announcements()
returns table (
  id uuid,
  message text,
  severity text,
  starts_at timestamptz,
  ends_at timestamptz,
  created_at timestamptz,
  dismissals integer
)
language sql
stable
security invoker
set search_path = ''
as $$ select * from private.admin_announcements(); $$;

-- ---------------------------------------------------------------------------
-- Privileges
-- ---------------------------------------------------------------------------
do $$
declare
  fn text;
begin
  foreach fn in array array[
    'admin_set_plan(uuid, text, date, text)',
    'admin_audit_entries(uuid, uuid, date, date, integer, integer, uuid)',
    'admin_list_admins()',
    'admin_owners(text, integer, integer, uuid)',
    'admin_open_support_view(uuid, text)',
    'admin_support_snapshot(uuid)',
    'admin_sign_out_everywhere(uuid, text)',
    'admin_record_email_action(text, uuid, text)',
    'admin_create_announcement(text, text, timestamptz, timestamptz)',
    'admin_end_announcement(uuid)',
    'admin_announcements()'
  ] loop
    execute format('revoke all on function private.%s from public, anon', fn);
    execute format('revoke all on function public.%s from public, anon', fn);
    execute format('grant execute on function private.%s to authenticated', fn);
    execute format('grant execute on function public.%s to authenticated', fn);
  end loop;
end;
$$;

revoke all on function private.mask_digits(text) from public, anon, authenticated;

-- For scripts/grant-admin.mts (service role only): ends every session of an
-- account when an admin is revoked or loses their authenticator.
create or replace function private.account_sign_out(p_user_id uuid)
returns void
language sql
volatile
security definer
set search_path = ''
as $$ delete from auth.sessions where user_id = p_user_id; $$;

create or replace function public.account_sign_out(p_user_id uuid)
returns void
language sql
volatile
security invoker
set search_path = ''
as $$ select private.account_sign_out(p_user_id); $$;

revoke all on function private.account_sign_out(uuid) from public, anon, authenticated;
revoke all on function public.account_sign_out(uuid) from public, anon, authenticated;
grant execute on function private.account_sign_out(uuid) to service_role;
grant execute on function public.account_sign_out(uuid) to service_role;
