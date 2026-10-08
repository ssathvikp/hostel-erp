-- Rooms and beds: the inventory that allocation, occupancy and fees hang off
-- (E4-T1, E4-T3, E4-T4, E4-T5, E4-T7, E4-T8).
--
-- Beds are never written by users directly. A room's beds are generated and
-- kept equal to its capacity by triggers, inside the same statement as the
-- room insert or update, so a room can never exist with the wrong number of
-- beds. Users only change a bed's manual status.

-- ---------------------------------------------------------------------------
-- Rooms (E4-T1, E4-T4)
-- ---------------------------------------------------------------------------
create table public.rooms (
  id uuid primary key default gen_random_uuid(),
  hostel_id uuid not null references public.hostels (id) on delete cascade,
  -- 0 is the ground floor.
  floor integer not null,
  -- Normalised (trimmed, upper-cased) by rooms_normalise before insert.
  room_number text not null,
  sharing_type text not null,
  capacity integer not null,
  status text not null default 'active',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  -- Target of composite tenant keys from beds and, later, allocations.
  constraint rooms_hostel_id_id_key unique (hostel_id, id),
  -- Archived rooms keep their number: history must stay unambiguous.
  constraint rooms_hostel_room_number_key unique (hostel_id, room_number),
  constraint rooms_room_number_format
    check (room_number ~ '^[A-Z0-9][A-Z0-9-]*$' and char_length(room_number) <= 20),
  constraint rooms_floor_range check (floor between 0 and 100),
  constraint rooms_sharing_type_valid
    check (sharing_type in ('single', 'double', 'triple', 'four_plus')),
  constraint rooms_capacity_range check (capacity between 1 and 12),
  constraint rooms_capacity_matches_sharing check (
    (sharing_type = 'single' and capacity = 1)
    or (sharing_type = 'double' and capacity = 2)
    or (sharing_type = 'triple' and capacity = 3)
    or (sharing_type = 'four_plus' and capacity >= 4)
  ),
  constraint rooms_status_valid check (status in ('active', 'archived'))
);

comment on table public.rooms is
  'Physical rooms of a hostel. Rent is not stored here: it comes from fee structures (E7-T2).';

create index rooms_hostel_floor_idx on public.rooms (hostel_id, floor);

create trigger rooms_set_updated_at
  before update on public.rooms
  for each row execute function private.set_updated_at();

-- ---------------------------------------------------------------------------
-- Beds (E4-T1, E4-T8)
-- ---------------------------------------------------------------------------
create table public.beds (
  id uuid primary key default gen_random_uuid(),
  hostel_id uuid not null,
  room_id uuid not null,
  -- Stable label such as 101-A; never changes once generated.
  bed_label text not null,
  -- Manual state only. Occupied is derived from allocations and never stored.
  status text not null default 'available',
  status_reason text,
  status_changed_by uuid references public.profiles (id) on delete set null,
  status_changed_at timestamptz,
  -- Set when the bed is retired by a capacity reduction or a room archive.
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint beds_hostel_id_id_key unique (hostel_id, id),
  constraint beds_room_bed_label_key unique (room_id, bed_label),
  -- A bed can never belong to a room in another hostel. Deleting a room
  -- removes its beds, unless something (an allocation) still references one.
  constraint beds_room_fkey foreign key (hostel_id, room_id)
    references public.rooms (hostel_id, id) on delete cascade,
  constraint beds_status_valid check (status in ('available', 'blocked', 'maintenance')),
  constraint beds_status_reason_length check (char_length(status_reason) between 1 and 200),
  constraint beds_reason_only_out_of_service check (status <> 'available' or status_reason is null)
);

comment on table public.beds is
  'Beds of a room, generated from its capacity. status holds manual states only; see bed_states.';

create trigger beds_set_updated_at
  before update on public.beds
  for each row execute function private.set_updated_at();

-- ---------------------------------------------------------------------------
-- Occupancy hook
-- ---------------------------------------------------------------------------
-- Whether a bed has a live allocation. Allocations arrive in EP-06 (E6-T1),
-- which replaces this body; every occupancy rule in this migration already
-- goes through it, so nothing else needs to change then.
create or replace function private.bed_is_occupied(p_bed_id uuid)
returns boolean
language sql
stable
security invoker
set search_path = ''
as $$
  select false;
$$;

grant execute on function private.bed_is_occupied(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- Bed generation (E4-T3, E4-T7)
-- ---------------------------------------------------------------------------
-- Makes a room's active beds match its capacity. Idempotent: running it
-- again changes nothing. Labels are the room number plus A, B, C...
--   * Growing restores retired beds first (lowest label first), then adds
--     the next unused labels, so labels stay contiguous and stable.
--   * Shrinking retires the highest-labelled vacant beds and refuses when
--     there are not enough vacant beds to retire.
--   * An archived room has no active beds.
-- SECURITY DEFINER because users hold no insert privilege on beds; it only
-- ever acts on a room the caller has just been allowed to write.
create or replace function private.sync_room_beds(p_room_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  room public.rooms%rowtype;
  target integer;
  active_count integer;
  label_count integer;
  changed integer;
begin
  select * into room from public.rooms where id = p_room_id for update;
  if not found then
    return;
  end if;

  target := case when room.status = 'archived' then 0 else room.capacity end;
  select count(*) filter (where archived_at is null), count(*)
    into active_count, label_count
    from public.beds where room_id = room.id;

  if active_count < target then
    with restored as (
      select id from public.beds
      where room_id = room.id and archived_at is not null
      order by bed_label
      limit target - active_count
      for update
    )
    update public.beds b
       set archived_at = null, status = 'available', status_reason = null
      from restored
     where b.id = restored.id;
    get diagnostics changed = row_count;
    active_count := active_count + changed;

    if active_count < target then
      insert into public.beds (hostel_id, room_id, bed_label)
      select room.hostel_id, room.id, room.room_number || '-' || chr(ascii('A') + label_count + n)
        from generate_series(0, target - active_count - 1) as n
      on conflict (room_id, bed_label) do nothing;
    end if;

  elsif active_count > target then
    with retiring as (
      select id from public.beds
      where room_id = room.id and archived_at is null
        and not private.bed_is_occupied(id)
      order by bed_label desc
      limit active_count - target
      for update
    )
    update public.beds b
       set archived_at = now()
      from retiring
     where b.id = retiring.id;
    get diagnostics changed = row_count;

    if changed < active_count - target then
      raise exception 'Room % has occupied beds that would be removed', room.room_number
        using errcode = 'P0001', hint = 'room_beds_occupied';
    end if;
  end if;

  -- The invariant every occupancy figure depends on.
  select count(*) into active_count
    from public.beds where room_id = room.id and archived_at is null;
  if active_count <> target then
    raise exception 'Room % has % active beds but needs %', room.room_number, active_count, target
      using errcode = 'P0001', hint = 'room_beds_mismatch';
  end if;
end;
$$;

create or replace function private.rooms_sync_beds()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.sync_room_beds(new.id);
  return null;
end;
$$;

create trigger rooms_sync_beds
  after insert or update of capacity, status on public.rooms
  for each row execute function private.rooms_sync_beds();

-- ---------------------------------------------------------------------------
-- Room rules (E4-T4, E4-T7)
-- ---------------------------------------------------------------------------
-- " 101a" and "101A" are the same room: normalise before the unique key sees it.
create or replace function private.rooms_normalise()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  new.room_number := upper(btrim(new.room_number));
  return new;
end;
$$;

create trigger rooms_normalise
  before insert on public.rooms
  for each row execute function private.rooms_normalise();

-- Archived rooms are read-only history, archiving is one-way, and a room
-- with an occupied bed cannot be archived.
create or replace function private.rooms_guard_update()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if old.status = 'archived' then
    raise exception 'Room % is archived', old.room_number
      using errcode = 'P0001', hint = 'room_archived';
  end if;
  if new.status = 'archived' and old.status = 'active' and exists (
    select 1 from public.beds b
    where b.room_id = old.id and b.archived_at is null and private.bed_is_occupied(b.id)
  ) then
    raise exception 'Room % has occupied beds', old.room_number
      using errcode = 'P0001', hint = 'room_occupied';
  end if;
  return new;
end;
$$;

create trigger rooms_guard_update
  before update on public.rooms
  for each row execute function private.rooms_guard_update();

-- ---------------------------------------------------------------------------
-- Bed status rules (E4-T8)
-- ---------------------------------------------------------------------------
-- Records who changed a bed's status and when, clears the reason when a bed
-- becomes available, and refuses to take an occupied or retired bed out of
-- service.
create or replace function private.beds_track_status()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if new.status is not distinct from old.status
     and new.status_reason is not distinct from old.status_reason then
    return new;
  end if;

  -- Retired beds only change through sync_room_beds, which runs as its owner.
  if old.archived_at is not null and current_user = 'authenticated' then
    raise exception 'Bed % is no longer in use', old.bed_label
      using errcode = 'P0001', hint = 'bed_retired';
  end if;
  if new.status <> 'available' and private.bed_is_occupied(new.id) then
    raise exception 'Bed % is occupied', old.bed_label
      using errcode = 'P0001', hint = 'bed_occupied';
  end if;

  if new.status = 'available' then
    new.status_reason := null;
  end if;
  new.status_changed_by := (select auth.uid());
  new.status_changed_at := now();
  return new;
end;
$$;

create trigger beds_track_status
  before update on public.beds
  for each row execute function private.beds_track_status();

-- ---------------------------------------------------------------------------
-- Bulk generation (E4-T5)
-- ---------------------------------------------------------------------------
-- Creates rooms p_from..p_to with their beds in one statement: any conflict
-- (an existing room number) rolls back every room. SECURITY INVOKER, so the
-- rooms insert policy decides whether the caller may write to p_hostel_id.
create or replace function public.create_rooms_bulk(
  p_hostel_id uuid,
  p_from integer,
  p_to integer,
  p_floor integer,
  p_sharing_type text,
  p_capacity integer
)
returns table (rooms_created integer, beds_created integer)
language plpgsql
security invoker
set search_path = ''
as $$
declare
  created integer;
begin
  if p_from < 1 or p_to < p_from or p_to - p_from + 1 > 100 then
    raise exception 'A bulk range must hold between 1 and 100 rooms'
      using errcode = 'P0001', hint = 'bulk_range';
  end if;

  insert into public.rooms (hostel_id, floor, room_number, sharing_type, capacity)
  select p_hostel_id, p_floor, n::text, p_sharing_type, p_capacity
    from generate_series(p_from, p_to) as n;
  get diagnostics created = row_count;

  return query select created, created * p_capacity;
end;
$$;

revoke execute on function public.create_rooms_bulk(uuid, integer, integer, integer, text, integer)
  from public, anon;
grant execute on function public.create_rooms_bulk(uuid, integer, integer, integer, text, integer)
  to authenticated;

-- ---------------------------------------------------------------------------
-- Read models
-- ---------------------------------------------------------------------------
-- Active beds with their displayed status: occupied when a live allocation
-- exists, otherwise the stored manual state.
create view public.bed_states with (security_invoker = true) as
select
  b.id,
  b.hostel_id,
  b.room_id,
  b.bed_label,
  case when private.bed_is_occupied(b.id) then 'occupied' else b.status end as status,
  b.status as manual_status,
  b.status_reason,
  b.status_changed_by,
  b.status_changed_at
from public.beds b
where b.archived_at is null;

-- One row per room with bed counts. Blocked and maintenance beds are not
-- vacancies. room_sort orders numbers naturally (9 before 10).
create view public.room_inventory with (security_invoker = true) as
select
  r.id,
  r.hostel_id,
  r.floor,
  r.room_number,
  lpad(r.room_number, 20, '0') as room_sort,
  r.sharing_type,
  r.capacity,
  r.status,
  r.created_at,
  count(s.id)::integer as total_beds,
  (count(s.id) filter (where s.status = 'available'))::integer as available_beds,
  (count(s.id) filter (where s.status in ('blocked', 'maintenance')))::integer as out_of_service_beds
from public.rooms r
left join public.bed_states s on s.room_id = r.id
group by r.id;

-- ---------------------------------------------------------------------------
-- Privileges and row-level security
-- ---------------------------------------------------------------------------
alter table public.rooms enable row level security;
alter table public.beds enable row level security;

-- Owners shape the inventory. Staff read it and manage bed status.
-- room_number and hostel_id are identity: set once, never updated.
revoke all on public.rooms from authenticated;
grant select, delete on public.rooms to authenticated;
grant insert (hostel_id, floor, room_number, sharing_type, capacity) on public.rooms to authenticated;
grant update (floor, sharing_type, capacity, status) on public.rooms to authenticated;

revoke all on public.beds from authenticated;
grant select on public.beds to authenticated;
grant update (status, status_reason) on public.beds to authenticated;

revoke all on public.bed_states, public.room_inventory from authenticated;
grant select on public.bed_states, public.room_inventory to authenticated;

create policy "rooms: members read"
  on public.rooms for select
  to authenticated
  using (hostel_id in (select private.user_hostel_ids()));

create policy "rooms: owners create"
  on public.rooms for insert
  to authenticated
  with check (hostel_id in (select private.user_owned_hostel_ids()) and status = 'active');

create policy "rooms: owners update"
  on public.rooms for update
  to authenticated
  using (hostel_id in (select private.user_owned_hostel_ids()))
  with check (hostel_id in (select private.user_owned_hostel_ids()));

-- A hard delete only succeeds for a room nothing references; rooms with
-- history are archived instead (allocations reference beds ON DELETE RESTRICT).
create policy "rooms: owners delete"
  on public.rooms for delete
  to authenticated
  using (hostel_id in (select private.user_owned_hostel_ids()));

create policy "beds: members read"
  on public.beds for select
  to authenticated
  using (hostel_id in (select private.user_hostel_ids()));

create policy "beds: members change status"
  on public.beds for update
  to authenticated
  using (hostel_id in (select private.user_hostel_ids()))
  with check (hostel_id in (select private.user_hostel_ids()));
