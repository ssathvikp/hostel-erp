-- Allocations: which resident sleeps in which bed, over which dates (E6-T1).
--
-- There is no stored status. An allocation is live when today in India
-- (Asia/Kolkata) falls between start_date and end_date (inclusive; a null
-- end_date is open-ended). Occupancy, vacancy and "current bed" are all
-- derived from that, so they can never drift from the dates.
--
-- This migration also gives private.bed_is_occupied its real body, so every
-- EP-04 occupancy rule (capacity reduction, archiving, blocking) now uses
-- live allocations.

-- "Today" for business rules is the date in India, not the server's UTC date.
create or replace function private.today_ist()
returns date
language sql
stable
security invoker
set search_path = ''
as $$
  select (now() at time zone 'Asia/Kolkata')::date;
$$;

grant execute on function private.today_ist() to authenticated;

-- Lets allocations prove that a bed belongs to the room they name.
alter table public.beds add constraint beds_room_id_id_key unique (room_id, id);

create table public.allocations (
  id uuid primary key default gen_random_uuid(),
  hostel_id uuid not null references public.hostels (id) on delete cascade,
  resident_id uuid not null,
  bed_id uuid not null,
  room_id uuid not null,
  start_date date not null,
  -- Last night in the bed. Null while open-ended.
  end_date date,
  vacate_reason text,
  -- Negotiated monthly rent in paise; overrides the fee structure (E7-T2).
  rent_override integer,
  created_by uuid not null default auth.uid() references public.profiles (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint allocations_hostel_id_id_key unique (hostel_id, id),
  -- Composite tenant keys: an allocation can never cross hostels, and its
  -- bed must belong to its room. NO ACTION (the default) means a bed, room
  -- or resident with allocation history can never be deleted; history is
  -- never cascaded away.
  constraint allocations_resident_fkey foreign key (hostel_id, resident_id)
    references public.residents (hostel_id, id),
  constraint allocations_bed_fkey foreign key (hostel_id, bed_id)
    references public.beds (hostel_id, id),
  constraint allocations_room_fkey foreign key (hostel_id, room_id)
    references public.rooms (hostel_id, id),
  constraint allocations_bed_in_room_fkey foreign key (room_id, bed_id)
    references public.beds (room_id, id),
  constraint allocations_dates_ordered check (end_date >= start_date),
  constraint allocations_vacate_reason_valid
    check (vacate_reason in ('moved_out', 'transferred', 'evicted', 'other')),
  -- A closed allocation always says why; an open one never does.
  constraint allocations_reason_when_closed check ((end_date is null) = (vacate_reason is null)),
  constraint allocations_rent_override_positive check (rent_override > 0)
);

comment on table public.allocations is
  'Resident-to-bed history. Live when today (IST) is within start_date..end_date; no stored status.';

-- One open-ended allocation per bed and per resident.
create unique index allocations_one_open_per_bed
  on public.allocations (bed_id) where end_date is null;
create unique index allocations_one_open_per_resident
  on public.allocations (resident_id) where end_date is null;

-- Fast lookup of the live allocation for a bed or a resident.
create index allocations_bed_dates_idx on public.allocations (bed_id, start_date, end_date);
create index allocations_resident_dates_idx
  on public.allocations (resident_id, start_date desc, end_date);
create index allocations_room_idx on public.allocations (room_id);

create trigger allocations_set_updated_at
  before update on public.allocations
  for each row execute function private.set_updated_at();

-- ---------------------------------------------------------------------------
-- Live allocation helpers
-- ---------------------------------------------------------------------------
-- SECURITY INVOKER: callers only ever see allocations of their own hostels.
create or replace function private.bed_is_occupied(p_bed_id uuid)
returns boolean
language sql
stable
security invoker
set search_path = ''
as $$
  select exists (
    select 1 from public.allocations a
    where a.bed_id = p_bed_id
      and a.start_date <= private.today_ist()
      and (a.end_date is null or a.end_date >= private.today_ist())
  );
$$;

create or replace function private.resident_has_live_allocation(p_resident_id uuid)
returns boolean
language sql
stable
security invoker
set search_path = ''
as $$
  select exists (
    select 1 from public.allocations a
    where a.resident_id = p_resident_id
      and a.start_date <= private.today_ist()
      and (a.end_date is null or a.end_date >= private.today_ist())
  );
$$;

grant execute on function private.resident_has_live_allocation(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- Resident rules that depend on allocations (E5-T6)
-- ---------------------------------------------------------------------------
create or replace function private.residents_guard_status()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if new.status is not distinct from old.status then
    return new;
  end if;

  if not (
    (old.status = 'active' and new.status in ('notice', 'blocked'))
    or (old.status = 'notice' and new.status in ('active', 'vacated', 'blocked'))
    or (old.status = 'vacated' and new.status = 'active')
    or (old.status = 'blocked' and new.status = 'active')
  ) then
    raise exception 'A resident cannot move from % to %', old.status, new.status
      using errcode = 'P0001', hint = 'resident_status_transition';
  end if;

  -- The vacate flow (E6-T4) closes the allocation first.
  if new.status = 'vacated' and private.resident_has_live_allocation(old.id) then
    raise exception 'Resident % still holds a bed', old.full_name
      using errcode = 'P0001', hint = 'resident_has_allocation';
  end if;

  new.status_changed_by := (select auth.uid());
  new.status_changed_at := now();
  return new;
end;
$$;

-- Only active residents and residents on notice can be given a bed; a
-- vacated resident must be reactivated first (E5-T6, E6-T2).
create or replace function private.allocations_guard_resident()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  resident_status text;
begin
  select r.status into resident_status
    from public.residents r where r.id = new.resident_id;
  if resident_status in ('vacated', 'blocked') then
    raise exception 'A % resident cannot be allocated a bed', resident_status
      using errcode = 'P0001', hint = 'resident_not_allocatable';
  end if;
  return new;
end;
$$;

create trigger allocations_guard_resident
  before insert on public.allocations
  for each row execute function private.allocations_guard_resident();

-- ---------------------------------------------------------------------------
-- Resident directory (E5-T4)
-- ---------------------------------------------------------------------------
-- Residents with their current room and bed, for search and filters.
create view public.resident_directory with (security_invoker = true) as
select
  r.id,
  r.hostel_id,
  r.full_name,
  r.phone,
  r.status,
  r.joining_date,
  r.created_at,
  live.room_id,
  live.room_number,
  live.bed_label
from public.residents r
left join lateral (
  select a.room_id, rm.room_number, b.bed_label
  from public.allocations a
  join public.rooms rm on rm.id = a.room_id
  join public.beds b on b.id = a.bed_id
  where a.resident_id = r.id
    and a.start_date <= private.today_ist()
    and (a.end_date is null or a.end_date >= private.today_ist())
  limit 1
) live on true;

-- ---------------------------------------------------------------------------
-- Privileges and row-level security
-- ---------------------------------------------------------------------------
-- Writes arrive through the allocation flows in EP-06; members of the
-- hostel may record them. Allocations are only ever closed, never deleted.
alter table public.allocations enable row level security;

revoke all on public.allocations from authenticated;
grant select on public.allocations to authenticated;
grant insert (hostel_id, resident_id, bed_id, room_id, start_date, rent_override)
  on public.allocations to authenticated;
grant update (end_date, vacate_reason) on public.allocations to authenticated;

revoke all on public.resident_directory from authenticated;
grant select on public.resident_directory to authenticated;

create policy "allocations: members read"
  on public.allocations for select
  to authenticated
  using (hostel_id in (select private.user_hostel_ids()));

create policy "allocations: members record"
  on public.allocations for insert
  to authenticated
  with check (hostel_id in (select private.user_hostel_ids()) and created_by = (select auth.uid()));

create policy "allocations: members close"
  on public.allocations for update
  to authenticated
  using (hostel_id in (select private.user_hostel_ids()))
  with check (hostel_id in (select private.user_hostel_ids()));
