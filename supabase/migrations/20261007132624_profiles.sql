-- Profiles: the identity root. One row per auth user (E2-T1, E2-T5).

create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  full_name text not null,
  phone text,
  role text not null default 'owner',
  -- The hostel a staff member belongs to. Null for owners and platform
  -- admins; owners reach their hostels through hostels.owner_id (EP-03).
  -- The foreign key to hostels is added when that table exists (E3-T1).
  hostel_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint profiles_full_name_length check (char_length(full_name) between 1 and 120),
  constraint profiles_phone_format check (phone ~ '^[6-9][0-9]{9}$'),
  constraint profiles_role_valid check (role in ('owner', 'staff', 'platform_admin')),
  constraint profiles_staff_hostel check ((role = 'staff') = (hostel_id is not null))
);

comment on table public.profiles is
  'One row per auth user, created by trigger on signup. role and hostel_id are never user-editable.';

create index profiles_hostel_id_idx on public.profiles (hostel_id) where hostel_id is not null;

create trigger profiles_set_updated_at
  before update on public.profiles
  for each row execute function private.set_updated_at();

-- ---------------------------------------------------------------------------
-- Profile creation on signup
-- ---------------------------------------------------------------------------
-- Every signup is an owner. role is never read from raw_user_meta_data, which
-- the client controls; only the display name is taken from it, bounded.
create or replace function private.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, full_name, role)
  values (
    new.id,
    coalesce(
      nullif(left(btrim(new.raw_user_meta_data ->> 'full_name'), 120), ''),
      split_part(new.email, '@', 1)
    ),
    'owner'
  );
  return new;
end;
$$;

comment on function private.handle_new_user() is
  'AFTER INSERT trigger on auth.users: creates the owner profile. Ignores any role in user metadata.';

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function private.handle_new_user();

-- ---------------------------------------------------------------------------
-- Membership helper
-- ---------------------------------------------------------------------------
-- Reads the caller's own staff hostel without going through profiles RLS,
-- so the peer policy below cannot recurse into itself.
create or replace function private.current_staff_hostel_id()
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select p.hostel_id from public.profiles p where p.id = (select auth.uid());
$$;

grant execute on function private.current_staff_hostel_id() to authenticated;

-- ---------------------------------------------------------------------------
-- Privileges and row-level security
-- ---------------------------------------------------------------------------
alter table public.profiles enable row level security;

-- Column-level grants: users may read profiles RLS lets them see, and change
-- only their own name and phone. role and hostel_id cannot be updated by any
-- signed-in user, whatever the policies say. No insert or delete: profiles
-- are created by the trigger and removed by cascade from auth.users.
revoke all on public.profiles from authenticated;
grant select on public.profiles to authenticated;
grant update (full_name, phone) on public.profiles to authenticated;

create policy "profiles: read own"
  on public.profiles for select
  to authenticated
  using (id = (select auth.uid()));

create policy "profiles: staff read peers in their hostel"
  on public.profiles for select
  to authenticated
  using (hostel_id is not null and hostel_id = (select private.current_staff_hostel_id()));

create policy "profiles: update own"
  on public.profiles for update
  to authenticated
  using (id = (select auth.uid()))
  with check (id = (select auth.uid()));
