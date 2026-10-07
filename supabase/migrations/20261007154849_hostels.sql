-- Hostels: the tenant. Ownership, identity, onboarding state and the
-- membership helper every later RLS policy is built on (E3-T1, E3-T2, E3-T6).

create table public.hostels (
  id uuid primary key default gen_random_uuid(),
  -- Filled from the session on insert; RLS rejects any other value.
  owner_id uuid not null default auth.uid()
    references public.profiles (id) on delete restrict,
  name text not null,
  -- Always overwritten by the hostels_assign_slug trigger.
  slug text not null default '',
  type text not null,
  phone text not null,
  alt_phone text,
  email text,
  address text,
  city text,
  state text,
  pincode text,
  gstin text,
  floors integer,
  status text not null default 'draft',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint hostels_slug_key unique (slug),
  constraint hostels_name_length check (char_length(btrim(name)) between 1 and 120),
  constraint hostels_slug_format check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$' and char_length(slug) <= 80),
  constraint hostels_type_valid check (type in ('boys', 'girls', 'co_ed')),
  constraint hostels_phone_format check (phone ~ '^[6-9][0-9]{9}$'),
  constraint hostels_alt_phone_format check (alt_phone ~ '^[6-9][0-9]{9}$'),
  constraint hostels_email_format check (email ~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$'),
  constraint hostels_pincode_format check (pincode ~ '^[1-9][0-9]{5}$'),
  constraint hostels_gstin_format
    check (gstin ~ '^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$'),
  constraint hostels_floors_range check (floors between 1 and 100),
  constraint hostels_status_valid check (status in ('draft', 'active', 'suspended')),
  -- A hostel can only leave draft once its address and capacity are known.
  constraint hostels_active_is_complete check (
    status = 'draft'
    or (address is not null and city is not null and state is not null
        and pincode is not null and floors is not null)
  )
);

comment on table public.hostels is
  'The tenant. Every business row carries hostel_id and is scoped to hostels the user owns or staffs.';

create index hostels_owner_id_idx on public.hostels (owner_id);

-- One unfinished onboarding per owner: a double-submitted step 1 cannot
-- create a second draft (E3-T6).
create unique index hostels_one_draft_per_owner
  on public.hostels (owner_id) where status = 'draft';

-- An owner cannot have two hostels with the same name (case and surrounding
-- spaces ignored); different owners can.
create unique index hostels_owner_name_key
  on public.hostels (owner_id, lower(btrim(name)));

create trigger hostels_set_updated_at
  before update on public.hostels
  for each row execute function private.set_updated_at();

-- Staff belong to a hostel; a hostel with staff can never be deleted.
alter table public.profiles
  add constraint profiles_hostel_id_fkey
  foreign key (hostel_id) references public.hostels (id) on delete restrict;

-- ---------------------------------------------------------------------------
-- Slug: generated from the name, unique platform-wide, never changed
-- ---------------------------------------------------------------------------
create or replace function private.hostels_assign_slug()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  base text;
  candidate text;
  attempt integer := 1;
begin
  base := trim(both '-' from regexp_replace(lower(new.name), '[^a-z0-9]+', '-', 'g'));
  base := left(coalesce(nullif(base, ''), 'hostel'), 60);
  base := trim(both '-' from base);
  -- Serialise concurrent inserts that share a base slug: without this, two
  -- owners naming a hostel identically at the same moment would both pick
  -- the same candidate and one insert would fail on the unique constraint.
  -- The lock is held until the transaction ends, by which time the first
  -- row is committed and visible to the next statement here.
  perform pg_advisory_xact_lock(hashtextextended('hostels.slug:' || base, 0));
  candidate := base;
  -- Runs as definer so it sees every hostel's slug, not just the caller's.
  while exists (select 1 from public.hostels h where h.slug = candidate) loop
    attempt := attempt + 1;
    candidate := base || '-' || attempt;
  end loop;
  new.slug := candidate;
  return new;
end;
$$;

create trigger hostels_assign_slug
  before insert on public.hostels
  for each row execute function private.hostels_assign_slug();

-- ---------------------------------------------------------------------------
-- Status transitions
-- ---------------------------------------------------------------------------
-- Signed-in users may only finish onboarding (draft -> active, once).
-- Suspension and any other change is reserved for the service role.
create or replace function private.hostels_guard_status()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if new.status is distinct from old.status
     and current_user = 'authenticated'
     and not (old.status = 'draft' and new.status = 'active') then
    raise exception 'A hostel cannot move from % to %', old.status, new.status
      using errcode = 'P0001', hint = 'hostel_status_transition';
  end if;
  return new;
end;
$$;

create trigger hostels_guard_status
  before update of status on public.hostels
  for each row execute function private.hostels_guard_status();

-- ---------------------------------------------------------------------------
-- Membership: the hostels a user may act in
-- ---------------------------------------------------------------------------
-- Owners: every hostel they own. Staff: the hostel on their profile.
-- SECURITY DEFINER so policies can call it without recursing into the RLS
-- of hostels and profiles. Every tenant-scoped policy uses this function.
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
  where p.id = (select auth.uid()) and p.hostel_id is not null;
$$;

-- Only the hostels the user owns (owner-only actions such as settings).
create or replace function private.user_owned_hostel_ids()
returns setof uuid
language sql
stable
security definer
set search_path = ''
as $$
  select h.id from public.hostels h where h.owner_id = (select auth.uid());
$$;

create or replace function private.current_user_role()
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select p.role from public.profiles p where p.id = (select auth.uid());
$$;

grant execute on function private.user_hostel_ids() to authenticated;
grant execute on function private.user_owned_hostel_ids() to authenticated;
grant execute on function private.current_user_role() to authenticated;

-- ---------------------------------------------------------------------------
-- Privileges and row-level security
-- ---------------------------------------------------------------------------
alter table public.hostels enable row level security;

-- owner_id and slug are identity: never written by users. status is
-- writable only within the transition rule above. No deletes: hostels are
-- suspended, never removed.
revoke all on public.hostels from authenticated;
grant select on public.hostels to authenticated;
grant insert (name, type, phone, alt_phone, email, address, city, state, pincode, gstin, floors)
  on public.hostels to authenticated;
grant update (name, type, phone, alt_phone, email, address, city, state, pincode, gstin, floors, status)
  on public.hostels to authenticated;

-- The direct owner_id test matters on INSERT ... RETURNING: the membership
-- function's snapshot cannot see the row being inserted.
create policy "hostels: members read"
  on public.hostels for select
  to authenticated
  using (owner_id = (select auth.uid()) or id in (select private.user_hostel_ids()));

create policy "hostels: owners create drafts"
  on public.hostels for insert
  to authenticated
  with check (
    owner_id = (select auth.uid())
    and status = 'draft'
    and (select private.current_user_role()) = 'owner'
  );

create policy "hostels: owners update"
  on public.hostels for update
  to authenticated
  using (owner_id = (select auth.uid()))
  with check (owner_id = (select auth.uid()));

-- ---------------------------------------------------------------------------
-- Profiles: owners can now see their staff
-- ---------------------------------------------------------------------------
-- Replaces the staff-only peer policy: anyone who is a member of a hostel
-- can read the staff profiles of that hostel.
drop policy "profiles: staff read peers in their hostel" on public.profiles;
drop function private.current_staff_hostel_id();

create policy "profiles: members read staff of their hostels"
  on public.profiles for select
  to authenticated
  using (hostel_id is not null and hostel_id in (select private.user_hostel_ids()));
