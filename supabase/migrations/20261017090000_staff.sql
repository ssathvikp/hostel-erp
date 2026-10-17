-- Staff invitation and management (EP-12: staff were seed-only in the MVP).
--
-- An owner invites a person by email to work in one hostel. The server
-- action creates the auth user with Supabase's invite API, makes the new
-- profile a staff member of that hostel with the service role, and records
-- the invitation here. Owners remove staff by deactivating the profile:
-- the row and every history row naming them stay, but membership ends at
-- once because the membership helpers ignore deactivated profiles.
--
-- Rules:
-- - role is still never read from user metadata (handle_new_user unchanged).
-- - Only the service role writes invitations and profile role, hostel_id
--   and deactivated_at. Owners read the invitations of hostels they own.
-- - One open (not revoked) invitation per hostel and email.

-- ---------------------------------------------------------------------------
-- Deactivated profiles
-- ---------------------------------------------------------------------------
alter table public.profiles
  add column deactivated_at timestamptz;

comment on column public.profiles.deactivated_at is
  'Set when an owner removes a staff member. A deactivated profile is a member of no hostel.';

-- Membership ignores deactivated staff. Owners are never deactivated here.
create or replace function private.user_hostel_ids()
returns setof uuid
language sql
stable
security definer
set search_path = ''
as $$
  select h.id from public.hostels h where h.owner_id = (select auth.uid())
  union
  select p.hostel_id from public.profiles p
  where p.id = (select auth.uid()) and p.hostel_id is not null and p.deactivated_at is null;
$$;

-- ---------------------------------------------------------------------------
-- Invitations
-- ---------------------------------------------------------------------------
create table public.staff_invitations (
  id uuid primary key default gen_random_uuid(),
  hostel_id uuid not null references public.hostels (id) on delete restrict,
  email text not null,
  full_name text not null,
  -- The staff profile created for this invitation. Set null if a never-used
  -- invitation's auth user is deleted (revoke before acceptance).
  profile_id uuid references public.profiles (id) on delete set null,
  invited_by uuid not null references public.profiles (id) on delete restrict,
  invited_at timestamptz not null default now(),
  accepted_at timestamptz,
  revoked_at timestamptz,
  revoked_by uuid references public.profiles (id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint staff_invitations_email_format
    check (email = lower(btrim(email)) and email ~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$'),
  constraint staff_invitations_full_name_length
    check (char_length(btrim(full_name)) between 1 and 120),
  constraint staff_invitations_revoked_pair check ((revoked_at is null) = (revoked_by is null))
);

comment on table public.staff_invitations is
  'Who was invited to work in a hostel, by whom, and whether they accepted or were removed. Written only by the service role.';

create unique index staff_invitations_open_email_key
  on public.staff_invitations (hostel_id, email) where revoked_at is null;
create index staff_invitations_profile_idx on public.staff_invitations (profile_id);

create trigger staff_invitations_set_updated_at
  before update on public.staff_invitations
  for each row execute function private.set_updated_at();

alter table public.staff_invitations enable row level security;

revoke all on public.staff_invitations from authenticated;
grant select on public.staff_invitations to authenticated;

create policy "staff_invitations: owners read"
  on public.staff_invitations for select
  to authenticated
  using (hostel_id in (select private.user_owned_hostel_ids()));

-- ---------------------------------------------------------------------------
-- Lookup by email (service role only)
-- ---------------------------------------------------------------------------
-- The invite action must know whether an address already has an account,
-- and supabase-js has no admin lookup by email. The definer function that
-- reads auth.users lives in private; the public wrapper is what rpc() calls.
-- Only the service role may execute either; signed-in users learn nothing.
create or replace function private.account_by_email(p_email text)
returns table (user_id uuid, email_confirmed boolean, role text, hostel_id uuid, deactivated boolean)
language sql
stable
security definer
set search_path = ''
as $$
  select u.id, u.email_confirmed_at is not null, p.role, p.hostel_id, p.deactivated_at is not null
  from auth.users u
  left join public.profiles p on p.id = u.id
  where lower(u.email) = lower(btrim(p_email))
  limit 1;
$$;

create or replace function public.account_by_email(p_email text)
returns table (user_id uuid, email_confirmed boolean, role text, hostel_id uuid, deactivated boolean)
language sql
stable
security invoker
set search_path = ''
as $$
  select * from private.account_by_email(p_email);
$$;

revoke all on function private.account_by_email(text) from public, anon, authenticated;
revoke all on function public.account_by_email(text) from public, anon, authenticated;
grant execute on function private.account_by_email(text) to service_role;
grant execute on function public.account_by_email(text) to service_role;
