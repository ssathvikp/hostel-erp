-- Allocation flows: allocate, vacate and transfer (E6-T2, E6-T3, E6-T4),
-- derived occupancy (E6-T5) and the allocation audit trail (E6-T7).
--
-- Dates: start_date is the first night in the bed and end_date the last.
-- A resident who moves out (or moves beds) on day D has end_date D - 1, so
-- the bed is free on D itself. Allocations are recorded as they happen:
-- members cannot book a bed ahead or close an allocation in the future.

create extension if not exists btree_gist with schema extensions;

-- ---------------------------------------------------------------------------
-- Overlap guard (E6-T3)
-- ---------------------------------------------------------------------------
-- The database, not the UI, guarantees that a bed never has two residents
-- and a resident never has two beds on the same night. Concurrent requests
-- for one bed serialise on the constraint: exactly one row wins.
alter table public.allocations
  add constraint allocations_no_bed_overlap exclude using gist (
    bed_id extensions.gist_uuid_ops with =,
    daterange(start_date, end_date, '[]') with &&
  ),
  add constraint allocations_no_resident_overlap exclude using gist (
    resident_id extensions.gist_uuid_ops with =,
    daterange(start_date, end_date, '[]') with &&
  );

-- ---------------------------------------------------------------------------
-- Write rules
-- ---------------------------------------------------------------------------
-- Replaces allocations_guard_resident (E6-T1): the resident must be
-- allocatable, the bed must be in service, and members cannot book ahead.
drop trigger allocations_guard_resident on public.allocations;
drop function private.allocations_guard_resident();

create or replace function private.allocations_guard_insert()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  resident_status text;
  bed record;
begin
  select r.status into resident_status
    from public.residents r where r.id = new.resident_id;
  if resident_status in ('vacated', 'blocked') then
    raise exception 'A % resident cannot be allocated a bed', resident_status
      using errcode = 'P0001', hint = 'resident_not_allocatable';
  end if;

  select b.bed_label, b.status, b.archived_at, rm.status as room_status
    into bed
    from public.beds b
    join public.rooms rm on rm.id = b.room_id
   where b.id = new.bed_id;
  if bed.archived_at is not null or bed.room_status = 'archived' then
    raise exception 'Bed % is no longer in use', bed.bed_label
      using errcode = 'P0001', hint = 'bed_retired';
  end if;
  if bed.status <> 'available' then
    raise exception 'Bed % is out of service (%)', bed.bed_label, bed.status
      using errcode = 'P0001', hint = 'bed_out_of_service';
  end if;

  if current_user = 'authenticated' and new.start_date > private.today_ist() then
    raise exception 'An allocation cannot start in the future'
      using errcode = 'P0001', hint = 'allocation_future';
  end if;
  return new;
end;
$$;

create trigger allocations_guard_insert
  before insert on public.allocations
  for each row execute function private.allocations_guard_insert();

-- Closed allocations are history and never change. Open ones are closed
-- once, on a date that has already happened.
create or replace function private.allocations_guard_update()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if old.end_date is not null then
    raise exception 'This allocation is already closed'
      using errcode = 'P0001', hint = 'allocation_closed';
  end if;
  if new.end_date is not null and new.end_date < old.start_date then
    raise exception 'A move cannot happen on or before the first night in the bed'
      using errcode = 'P0001', hint = 'allocation_same_day';
  end if;
  if current_user = 'authenticated' and new.end_date >= private.today_ist() then
    raise exception 'A move-out date cannot be in the future'
      using errcode = 'P0001', hint = 'move_future';
  end if;
  return new;
end;
$$;

create trigger allocations_guard_update
  before update on public.allocations
  for each row execute function private.allocations_guard_update();

-- Turns an overlap into a message that names who holds the bed and when.
create or replace function private.raise_allocation_conflict(
  p_bed_id uuid,
  p_resident_id uuid,
  p_start_date date
)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
declare
  hit record;
begin
  select r.full_name, b.bed_label, a.start_date, a.end_date
    into hit
    from public.allocations a
    join public.residents r on r.id = a.resident_id
    join public.beds b on b.id = a.bed_id
   where a.bed_id = p_bed_id
     and daterange(a.start_date, a.end_date, '[]') && daterange(p_start_date, null, '[]')
   order by a.start_date
   limit 1;
  if found then
    raise exception 'Bed % is held by % from %', hit.bed_label, hit.full_name,
      to_char(hit.start_date, 'FMDD Mon YYYY')
      || coalesce(' to ' || to_char(hit.end_date, 'FMDD Mon YYYY'), ' with no end date')
      using errcode = 'P0001', hint = 'bed_overlap';
  end if;

  if p_resident_id is not null then
    select r.full_name, b.bed_label, a.start_date, a.end_date
      into hit
      from public.allocations a
      join public.residents r on r.id = a.resident_id
      join public.beds b on b.id = a.bed_id
     where a.resident_id = p_resident_id
       and daterange(a.start_date, a.end_date, '[]') && daterange(p_start_date, null, '[]')
     order by a.start_date
     limit 1;
    if found then
      raise exception '% already holds bed % from %', hit.full_name, hit.bed_label,
        to_char(hit.start_date, 'FMDD Mon YYYY')
        || coalesce(' to ' || to_char(hit.end_date, 'FMDD Mon YYYY'), ' with no end date')
        using errcode = 'P0001', hint = 'resident_overlap';
    end if;
  end if;

  raise exception 'This allocation overlaps another one'
    using errcode = 'P0001', hint = 'allocation_overlap';
end;
$$;

grant execute on function private.raise_allocation_conflict(uuid, uuid, date) to authenticated;

-- ---------------------------------------------------------------------------
-- Allocate (E6-T2)
-- ---------------------------------------------------------------------------
-- One atomic step. SECURITY INVOKER: RLS and the table rules above decide
-- what the caller may do; occupancy is derived, so no bed row is written.
-- The bed row is share-locked so it cannot be blocked mid-allocation.
create or replace function public.allocate_bed(
  p_resident_id uuid,
  p_bed_id uuid,
  p_start_date date,
  p_rent_override integer default null
)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  bed record;
  allocation_id uuid;
begin
  select b.hostel_id, b.room_id into bed
    from public.beds b where b.id = p_bed_id
    for share;
  if not found then
    raise exception 'Bed not found' using errcode = 'P0001', hint = 'bed_not_found';
  end if;
  if not exists (
    select 1 from public.residents r where r.id = p_resident_id and r.hostel_id = bed.hostel_id
  ) then
    raise exception 'Resident not found' using errcode = 'P0001', hint = 'resident_not_found';
  end if;
  if private.resident_has_live_allocation(p_resident_id) then
    raise exception 'The resident already holds a bed'
      using errcode = 'P0001', hint = 'resident_has_bed';
  end if;

  begin
    insert into public.allocations (hostel_id, resident_id, bed_id, room_id, start_date, rent_override)
    values (bed.hostel_id, p_resident_id, p_bed_id, bed.room_id, p_start_date, p_rent_override)
    returning id into allocation_id;
  exception when exclusion_violation or unique_violation then
    perform private.raise_allocation_conflict(p_bed_id, p_resident_id, p_start_date);
  end;
  return allocation_id;
end;
$$;

-- ---------------------------------------------------------------------------
-- Vacate (E6-T4)
-- ---------------------------------------------------------------------------
-- Closes an open allocation: the resident's last night is the day before
-- p_move_out_date. With p_mark_vacated the resident is also marked vacated
-- (through notice, the only way into vacated) in the same transaction.
create or replace function public.vacate_allocation(
  p_allocation_id uuid,
  p_move_out_date date,
  p_reason text,
  p_mark_vacated boolean default false
)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
declare
  allocation public.allocations%rowtype;
begin
  if p_reason is null or p_reason not in ('moved_out', 'evicted', 'other') then
    raise exception 'Choose why the resident is leaving'
      using errcode = 'P0001', hint = 'vacate_reason';
  end if;

  select * into allocation from public.allocations a where a.id = p_allocation_id for update;
  if not found then
    raise exception 'Allocation not found' using errcode = 'P0001', hint = 'allocation_not_found';
  end if;

  update public.allocations
     set end_date = p_move_out_date - 1, vacate_reason = p_reason
   where id = allocation.id;

  if p_mark_vacated then
    update public.residents set status = 'notice'
     where id = allocation.resident_id and status = 'active';
    update public.residents set status = 'vacated'
     where id = allocation.resident_id and status = 'notice';
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- Transfer (E6-T4)
-- ---------------------------------------------------------------------------
-- Closes the current allocation and opens one on the new bed in a single
-- call. Any failure rolls back both, so a resident never holds two beds and
-- never holds none in between.
create or replace function public.transfer_allocation(
  p_allocation_id uuid,
  p_new_bed_id uuid,
  p_move_date date,
  p_rent_override integer default null
)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  allocation public.allocations%rowtype;
  bed record;
  new_id uuid;
begin
  select * into allocation from public.allocations a where a.id = p_allocation_id for update;
  if not found then
    raise exception 'Allocation not found' using errcode = 'P0001', hint = 'allocation_not_found';
  end if;
  if allocation.bed_id = p_new_bed_id then
    raise exception 'The resident is already in this bed'
      using errcode = 'P0001', hint = 'transfer_same_bed';
  end if;

  select b.hostel_id, b.room_id into bed
    from public.beds b where b.id = p_new_bed_id
    for share;
  if not found or bed.hostel_id <> allocation.hostel_id then
    raise exception 'Bed not found' using errcode = 'P0001', hint = 'bed_not_found';
  end if;

  begin
    -- Tells the audit trigger that these two rows are one transfer.
    perform set_config('hostel_erp.transfer_from', allocation.id::text, true);
    update public.allocations
       set end_date = p_move_date - 1, vacate_reason = 'transferred'
     where id = allocation.id;
    insert into public.allocations (hostel_id, resident_id, bed_id, room_id, start_date, rent_override)
    values (allocation.hostel_id, allocation.resident_id, p_new_bed_id, bed.room_id, p_move_date,
            p_rent_override)
    returning id into new_id;
    perform set_config('hostel_erp.transfer_from', '', true);
  exception when exclusion_violation or unique_violation then
    perform private.raise_allocation_conflict(p_new_bed_id, null, p_move_date);
  end;
  return new_id;
end;
$$;

revoke execute on function public.allocate_bed(uuid, uuid, date, integer) from public, anon;
revoke execute on function public.vacate_allocation(uuid, date, text, boolean) from public, anon;
revoke execute on function public.transfer_allocation(uuid, uuid, date, integer) from public, anon;
grant execute on function public.allocate_bed(uuid, uuid, date, integer) to authenticated;
grant execute on function public.vacate_allocation(uuid, date, text, boolean) to authenticated;
grant execute on function public.transfer_allocation(uuid, uuid, date, integer) to authenticated;

-- ---------------------------------------------------------------------------
-- Audit trail (E6-T7)
-- ---------------------------------------------------------------------------
-- One immutable row per allocate, vacate and transfer leg, written by a
-- trigger so no write path can skip it. Users can read it, never write it.
create table public.allocation_events (
  id bigint generated always as identity primary key,
  hostel_id uuid not null references public.hostels (id) on delete cascade,
  allocation_id uuid not null,
  resident_id uuid not null,
  bed_id uuid not null,
  room_id uuid not null,
  action text not null,
  -- The day the move happened: first night for arrivals, move-out day for departures.
  effective_date date not null,
  previous_state jsonb,
  new_state jsonb not null,
  actor_id uuid references public.profiles (id) on delete set null,
  -- Snapshot of who recorded it, readable by every member and kept even if
  -- the profile is later renamed or removed.
  actor_name text,
  created_at timestamptz not null default now(),

  -- Allocations are never deleted except with their whole hostel, so this
  -- cascade only ever runs as part of a hostel deletion.
  constraint allocation_events_allocation_fkey foreign key (hostel_id, allocation_id)
    references public.allocations (hostel_id, id) on delete cascade,
  constraint allocation_events_resident_fkey foreign key (hostel_id, resident_id)
    references public.residents (hostel_id, id),
  constraint allocation_events_bed_fkey foreign key (hostel_id, bed_id)
    references public.beds (hostel_id, id),
  constraint allocation_events_room_fkey foreign key (hostel_id, room_id)
    references public.rooms (hostel_id, id),
  constraint allocation_events_action_valid
    check (action in ('allocated', 'vacated', 'transferred_out', 'transferred_in'))
);

comment on table public.allocation_events is
  'Immutable log of allocation changes: who moved where, when, and who recorded it.';

create index allocation_events_resident_idx on public.allocation_events (resident_id, created_at desc);
create index allocation_events_room_idx on public.allocation_events (room_id, created_at desc);
create index allocation_events_hostel_idx on public.allocation_events (hostel_id, created_at desc);
create index allocation_events_allocation_idx on public.allocation_events (allocation_id);

create or replace function private.allocation_state(a public.allocations)
returns jsonb
language sql
immutable
set search_path = ''
as $$
  select jsonb_build_object(
    'bed_id', a.bed_id,
    'room_id', a.room_id,
    'start_date', a.start_date,
    'end_date', a.end_date,
    'vacate_reason', a.vacate_reason,
    'rent_override', a.rent_override
  );
$$;

-- SECURITY DEFINER: users hold no privileges on allocation_events.
create or replace function private.allocations_log_event()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  transfer_from text := nullif(current_setting('hostel_erp.transfer_from', true), '');
  actor_name text := (select p.full_name from public.profiles p where p.id = auth.uid());
begin
  if tg_op = 'INSERT' then
    insert into public.allocation_events
      (hostel_id, allocation_id, resident_id, bed_id, room_id, action, effective_date,
       previous_state, new_state, actor_id, actor_name)
    values
      (new.hostel_id, new.id, new.resident_id, new.bed_id, new.room_id,
       case when transfer_from is null then 'allocated' else 'transferred_in' end,
       new.start_date, null,
       private.allocation_state(new)
         || case when transfer_from is null then '{}'::jsonb
                 else jsonb_build_object('transferred_from', transfer_from) end,
       auth.uid(), actor_name);
  elsif old.end_date is null and new.end_date is not null then
    insert into public.allocation_events
      (hostel_id, allocation_id, resident_id, bed_id, room_id, action, effective_date,
       previous_state, new_state, actor_id, actor_name)
    values
      (new.hostel_id, new.id, new.resident_id, new.bed_id, new.room_id,
       case when new.vacate_reason = 'transferred' then 'transferred_out' else 'vacated' end,
       new.end_date + 1, private.allocation_state(old), private.allocation_state(new),
       auth.uid(), actor_name);
  end if;
  return null;
end;
$$;

create trigger allocations_log_event
  after insert or update on public.allocations
  for each row execute function private.allocations_log_event();

-- Log rows never change. They are only removed when their hostel is
-- deleted (a cascade, which runs one trigger level deeper).
create or replace function private.allocation_events_immutable()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if tg_op = 'UPDATE' or pg_trigger_depth() <= 1 then
    raise exception 'Allocation history cannot be changed'
      using errcode = 'P0001', hint = 'history_immutable';
  end if;
  return old;
end;
$$;

create trigger allocation_events_immutable
  before update or delete on public.allocation_events
  for each row execute function private.allocation_events_immutable();

alter table public.allocation_events enable row level security;
revoke all on public.allocation_events from authenticated, anon;
grant select on public.allocation_events to authenticated;

create policy "allocation events: members read"
  on public.allocation_events for select
  to authenticated
  using (hostel_id in (select private.user_hostel_ids()));

-- ---------------------------------------------------------------------------
-- Derived occupancy (E6-T5)
-- ---------------------------------------------------------------------------
-- Every figure comes from bed_states, which derives "occupied" from live
-- allocations (today in Asia/Kolkata). Nothing is stored, so room, floor
-- and hostel totals always agree. Vacant means available and unoccupied;
-- blocked and maintenance beds are neither occupied nor vacant.
create or replace view public.room_inventory with (security_invoker = true) as
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
  (count(s.id) filter (where s.status in ('blocked', 'maintenance')))::integer as out_of_service_beds,
  (count(s.id) filter (where s.status = 'occupied'))::integer as occupied_beds
from public.rooms r
left join public.bed_states s on s.room_id = r.id
group by r.id;

create view public.floor_occupancy with (security_invoker = true) as
select
  i.hostel_id,
  i.floor,
  count(*)::integer as rooms,
  sum(i.total_beds)::integer as total_beds,
  sum(i.occupied_beds)::integer as occupied_beds,
  sum(i.available_beds)::integer as vacant_beds,
  sum(i.out_of_service_beds)::integer as out_of_service_beds
from public.room_inventory i
where i.status = 'active'
group by i.hostel_id, i.floor;

create view public.hostel_occupancy with (security_invoker = true) as
select
  f.hostel_id,
  sum(f.rooms)::integer as rooms,
  sum(f.total_beds)::integer as total_beds,
  sum(f.occupied_beds)::integer as occupied_beds,
  sum(f.vacant_beds)::integer as vacant_beds,
  sum(f.out_of_service_beds)::integer as out_of_service_beds
from public.floor_occupancy f
group by f.hostel_id;

revoke all on public.floor_occupancy, public.hostel_occupancy from authenticated, anon;
grant select on public.room_inventory, public.floor_occupancy, public.hostel_occupancy
  to authenticated;
