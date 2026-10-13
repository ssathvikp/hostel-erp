-- Complaints and maintenance (EP-15): records, categories, lifecycle,
-- workers, automatic routing and response targets (E15-T1, T6, T7, T10).
--
-- A complaint is about a room (optionally one bed) or a common area. Its
-- status moves only along the paths in private.complaint_next_statuses, and
-- every change is an immutable complaint_events row. Users never write the
-- complaint tables directly: every change goes through the functions below,
-- which check the caller works in the hostel and record the event.
--
-- Workers belong to an owner and serve one or more of the owner's hostels.
-- On-site workers are the hostel's own staff; vendors are outside trades
-- people. A new complaint is routed by its category's trade: an available
-- on-site worker first, then the hostel's preferred vendor for that trade,
-- then any vendor with it; ties go to whoever has the fewest open jobs.
-- Routing takes a per-hostel lock, so two complaints at once see each
-- other's assignments.
--
-- Each priority has a response and a resolution target. Time on hold does
-- not count. A job past its target is flagged by a scheduled job.

-- ---------------------------------------------------------------------------
-- Trades and categories
-- ---------------------------------------------------------------------------
create or replace function private.valid_trades(p_trades text[])
returns boolean
language sql
immutable
set search_path = ''
as $$
  select p_trades <@ array['electrician', 'plumber', 'carpenter', 'cleaner', 'technician',
                           'pest_control', 'general']::text[];
$$;

create table public.complaint_categories (
  id uuid primary key default gen_random_uuid(),
  hostel_id uuid not null references public.hostels (id) on delete cascade,
  name text not null,
  trade text not null,
  -- Off: complaints in it wait for someone to assign them by hand.
  auto_route boolean not null default true,
  active boolean not null default true,
  created_at timestamptz not null default now(),

  constraint complaint_categories_hostel_id_id_key unique (hostel_id, id),
  constraint complaint_categories_name_length check (char_length(btrim(name)) between 1 and 60),
  constraint complaint_categories_trade_valid check (private.valid_trades(array[trade]))
);

create unique index complaint_categories_hostel_name_key
  on public.complaint_categories (hostel_id, lower(btrim(name)));

create or replace function private.add_default_complaint_categories(p_hostel_id uuid)
returns void
language sql
security definer
set search_path = ''
as $$
  insert into public.complaint_categories (hostel_id, name, trade)
  select p_hostel_id, d.name, d.trade
    from (values ('Electrical', 'electrician'), ('Plumbing', 'plumber'),
                 ('Carpentry', 'carpenter'), ('Cleaning', 'cleaner'),
                 ('Internet', 'technician'), ('Appliance', 'technician'),
                 ('Pest control', 'pest_control'), ('Security', 'general'),
                 ('Other', 'general')) as d (name, trade)
  on conflict do nothing;
$$;

create or replace function private.hostels_add_complaint_categories()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.add_default_complaint_categories(new.id);
  return null;
end;
$$;

create trigger hostels_add_complaint_categories
  after insert on public.hostels
  for each row execute function private.hostels_add_complaint_categories();

select private.add_default_complaint_categories(h.id) from public.hostels h;

-- ---------------------------------------------------------------------------
-- Workers
-- ---------------------------------------------------------------------------
create table public.workers (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references public.profiles (id) on delete cascade,
  kind text not null,
  name text not null,
  business_name text,
  phone text not null,
  trades text[] not null,
  -- Vendors: what they charge to come out, in paise.
  call_out_charge integer,
  notes text,
  -- On-site workers can be a staff member's account.
  profile_id uuid references public.profiles (id) on delete set null,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint workers_kind_valid check (kind in ('on_site', 'vendor')),
  constraint workers_name_length check (char_length(btrim(name)) between 1 and 100),
  constraint workers_business_length check (char_length(btrim(business_name)) between 1 and 100),
  constraint workers_phone_format check (phone ~ '^[6-9][0-9]{9}$'),
  constraint workers_trades_valid check (cardinality(trades) between 1 and 7 and private.valid_trades(trades)),
  constraint workers_call_out_range check (call_out_charge between 0 and 10000000),
  constraint workers_notes_length check (char_length(btrim(notes)) between 1 and 500),
  constraint workers_vendor_fields check (kind = 'vendor' or (business_name is null and call_out_charge is null))
);

comment on table public.workers is
  'People who fix things: a hostel''s own staff (on_site) or outside vendors. Shared across an owner''s hostels.';

create trigger workers_set_updated_at
  before update on public.workers
  for each row execute function private.set_updated_at();

-- Which of the owner's hostels a worker serves, and the trades they are the
-- hostel's first choice for.
create table public.worker_hostels (
  worker_id uuid not null references public.workers (id) on delete cascade,
  hostel_id uuid not null references public.hostels (id) on delete cascade,
  preferred_trades text[] not null default '{}',
  primary key (worker_id, hostel_id),
  constraint worker_hostels_preferred_valid check (private.valid_trades(preferred_trades))
);

create index worker_hostels_hostel_idx on public.worker_hostels (hostel_id);

-- A worker can only serve hostels of the owner who added them.
create or replace function private.worker_hostels_same_owner()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not exists (
    select 1 from public.workers w join public.hostels h on h.owner_id = w.owner_id
     where w.id = new.worker_id and h.id = new.hostel_id
  ) then
    raise exception 'A worker can only serve your own hostels'
      using errcode = 'P0001', hint = 'worker_hostel_owner';
  end if;
  return new;
end;
$$;

create trigger worker_hostels_same_owner
  before insert or update on public.worker_hostels
  for each row execute function private.worker_hostels_same_owner();

create table public.worker_unavailability (
  id uuid primary key default gen_random_uuid(),
  worker_id uuid not null references public.workers (id) on delete cascade,
  from_date date not null,
  to_date date not null,
  reason text,
  created_at timestamptz not null default now(),
  constraint worker_unavailability_dates check (to_date >= from_date),
  constraint worker_unavailability_reason_length check (char_length(btrim(reason)) between 1 and 200)
);

create index worker_unavailability_worker_idx on public.worker_unavailability (worker_id, to_date);

-- ---------------------------------------------------------------------------
-- Complaints
-- ---------------------------------------------------------------------------
create table public.complaints (
  id uuid primary key default gen_random_uuid(),
  hostel_id uuid not null references public.hostels (id) on delete cascade,
  -- Per hostel: #1, #2, ...
  number integer not null,
  kind text not null default 'complaint',
  room_id uuid,
  bed_id uuid,
  -- A common area, when it is not about a room.
  area text,
  -- The resident it is raised for, if any.
  resident_id uuid,
  category_id uuid not null,
  priority text not null default 'normal',
  title text not null,
  description text,
  status text not null default 'open',
  worker_id uuid references public.workers (id) on delete set null,
  -- Routing found nobody for the trade: the owner needs to find someone.
  needs_worker boolean not null default false,
  -- Whether an outside worker's job link shows the resident's phone.
  share_resident_phone boolean not null default false,
  raised_by uuid default auth.uid() references public.profiles (id) on delete set null,
  raised_by_name text,
  assigned_at timestamptz,
  responded_at timestamptz,
  resolved_at timestamptz,
  closed_at timestamptz,
  hold_reason text,
  held_since timestamptz,
  -- Time spent on hold so far, which targets do not count.
  held_seconds integer not null default 0,
  escalated_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint complaints_hostel_id_id_key unique (hostel_id, id),
  constraint complaints_hostel_number_key unique (hostel_id, number),
  constraint complaints_room_fkey foreign key (hostel_id, room_id)
    references public.rooms (hostel_id, id),
  constraint complaints_bed_fkey foreign key (hostel_id, bed_id)
    references public.beds (hostel_id, id),
  constraint complaints_resident_fkey foreign key (hostel_id, resident_id)
    references public.residents (hostel_id, id),
  constraint complaints_category_fkey foreign key (hostel_id, category_id)
    references public.complaint_categories (hostel_id, id),
  constraint complaints_kind_valid check (kind in ('complaint', 'scheduled')),
  constraint complaints_priority_valid check (priority in ('low', 'normal', 'high', 'urgent')),
  constraint complaints_status_valid check (
    status in ('open', 'assigned', 'in_progress', 'on_hold', 'resolved', 'closed', 'reopened')
  ),
  constraint complaints_where check (room_id is not null or area is not null),
  constraint complaints_bed_has_room check (bed_id is null or room_id is not null),
  constraint complaints_area_length check (char_length(btrim(area)) between 1 and 100),
  constraint complaints_title_length check (char_length(btrim(title)) between 1 and 120),
  constraint complaints_description_length check (char_length(btrim(description)) between 1 and 2000),
  constraint complaints_hold_reason check ((status = 'on_hold') = (hold_reason is not null)),
  constraint complaints_assigned_has_worker check (status <> 'assigned' or worker_id is not null)
);

comment on table public.complaints is
  'Problems to fix, from report to close. Changed only through the complaint functions; history in complaint_events.';

create index complaints_hostel_status_idx on public.complaints (hostel_id, status, created_at desc);
create index complaints_room_idx on public.complaints (room_id) where room_id is not null;
create index complaints_resident_idx on public.complaints (resident_id) where resident_id is not null;
create index complaints_worker_idx on public.complaints (worker_id) where worker_id is not null;

create trigger complaints_set_updated_at
  before update on public.complaints
  for each row execute function private.set_updated_at();

create table public.complaint_events (
  id bigint generated always as identity primary key,
  hostel_id uuid not null references public.hostels (id) on delete cascade,
  complaint_id uuid not null,
  -- created, status, assigned, unassigned, comment, routing, escalated,
  -- accepted, declined, cost, attachment, job_link
  kind text not null,
  from_status text,
  to_status text,
  worker_id uuid references public.workers (id) on delete set null,
  note text,
  actor_id uuid references public.profiles (id) on delete set null,
  -- Who did it, as shown: a member's name, a worker using their job link,
  -- or "Automatic".
  actor_name text not null,
  created_at timestamptz not null default now(),

  constraint complaint_events_complaint_fkey foreign key (hostel_id, complaint_id)
    references public.complaints (hostel_id, id) on delete cascade,
  constraint complaint_events_kind_valid check (kind in (
    'created', 'status', 'assigned', 'unassigned', 'comment', 'routing', 'escalated',
    'accepted', 'declined', 'cost', 'attachment', 'job_link'
  )),
  constraint complaint_events_note_length check (char_length(note) between 1 and 2000)
);

create index complaint_events_complaint_idx on public.complaint_events (complaint_id, id);

create or replace function private.complaint_events_immutable()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  -- Deleting a complaint's hostel cascades; nothing else may change history.
  if tg_op = 'UPDATE' or pg_trigger_depth() <= 1 then
    raise exception 'Complaint history cannot be changed'
      using errcode = 'P0001', hint = 'history_immutable';
  end if;
  return old;
end;
$$;

create trigger complaint_events_immutable
  before update or delete on public.complaint_events
  for each row execute function private.complaint_events_immutable();

-- ---------------------------------------------------------------------------
-- Lifecycle
-- ---------------------------------------------------------------------------
create or replace function private.complaint_next_statuses(p_status text)
returns text[]
language sql
immutable
set search_path = ''
as $$
  select case p_status
    when 'open' then array['assigned', 'in_progress', 'on_hold', 'resolved', 'closed']
    when 'assigned' then array['open', 'in_progress', 'on_hold', 'resolved', 'closed']
    when 'in_progress' then array['assigned', 'on_hold', 'resolved', 'closed']
    when 'on_hold' then array['open', 'assigned', 'in_progress', 'closed']
    when 'resolved' then array['closed', 'reopened']
    when 'closed' then array['reopened']
    when 'reopened' then array['assigned', 'in_progress', 'on_hold', 'resolved', 'closed']
  end::text[];
$$;

-- Status changes follow the allowed paths and keep the timestamps the
-- targets are measured by.
create or replace function private.complaints_guard_status()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if new.status is not distinct from old.status then
    return new;
  end if;
  if not (new.status = any (private.complaint_next_statuses(old.status))) then
    raise exception 'A complaint cannot go from % to %', replace(old.status, '_', ' '),
      replace(new.status, '_', ' ')
      using errcode = 'P0001', hint = 'complaint_transition';
  end if;

  if old.status = 'on_hold' then
    new.held_seconds := old.held_seconds + extract(epoch from now() - old.held_since)::integer;
    new.held_since := null;
  end if;
  if new.status = 'on_hold' then
    new.held_since := now();
  else
    new.hold_reason := null;
  end if;
  if new.status in ('in_progress', 'resolved', 'closed') then
    new.responded_at := coalesce(old.responded_at, now());
  end if;
  if new.status = 'resolved' then
    new.resolved_at := now();
  end if;
  if new.status = 'closed' then
    new.closed_at := now();
    new.resolved_at := coalesce(new.resolved_at, now());
  end if;
  if new.status = 'reopened' then
    new.resolved_at := null;
    new.closed_at := null;
    new.escalated_at := null;
  end if;
  return new;
end;
$$;

create trigger complaints_guard_status
  before update of status on public.complaints
  for each row execute function private.complaints_guard_status();

-- ---------------------------------------------------------------------------
-- Targets
-- ---------------------------------------------------------------------------
create table public.complaint_targets (
  hostel_id uuid not null references public.hostels (id) on delete cascade,
  priority text not null,
  respond_minutes integer not null,
  resolve_minutes integer not null,
  primary key (hostel_id, priority),
  constraint complaint_targets_priority_valid check (priority in ('low', 'normal', 'high', 'urgent')),
  constraint complaint_targets_respond_range check (respond_minutes between 5 and 43200),
  constraint complaint_targets_resolve_range check (resolve_minutes between respond_minutes and 129600)
);

comment on table public.complaint_targets is
  'Per hostel and priority, how soon a complaint should be answered and fixed. Defaults apply when absent.';

-- The hostel's target, or the default: urgent 2 h / 24 h, high 4 h / 2 days,
-- normal 1 day / 3 days, low 2 days / 7 days.
create or replace function private.complaint_target(p_hostel_id uuid, p_priority text)
returns table (respond_minutes integer, resolve_minutes integer)
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(t.respond_minutes, d.respond), coalesce(t.resolve_minutes, d.resolve)
    from (values ('urgent', 120, 1440), ('high', 240, 2880),
                 ('normal', 1440, 4320), ('low', 2880, 10080)) as d (priority, respond, resolve)
    left join public.complaint_targets t on t.hostel_id = p_hostel_id and t.priority = d.priority
   where d.priority = p_priority;
$$;

-- ---------------------------------------------------------------------------
-- Read model
-- ---------------------------------------------------------------------------
-- Every complaint with what the list shows and filters on, and where it
-- stands against its targets: on_track, due_soon (a quarter of the time
-- left), overdue, paused (on hold) or done.
create view public.complaint_list with (security_invoker = true) as
select
  c.id,
  c.hostel_id,
  c.number,
  c.kind,
  c.title,
  c.description,
  c.priority,
  c.status,
  c.needs_worker,
  c.area,
  c.room_id,
  rm.room_number,
  rm.floor,
  c.bed_id,
  b.bed_label,
  c.resident_id,
  r.full_name as resident_name,
  c.category_id,
  cat.name as category_name,
  cat.trade,
  c.worker_id,
  w.name as worker_name,
  w.kind as worker_kind,
  c.raised_by_name,
  c.created_at,
  c.assigned_at,
  c.responded_at,
  c.resolved_at,
  c.closed_at,
  c.hold_reason,
  c.escalated_at,
  due.respond_due,
  due.resolve_due,
  case
    when c.status in ('resolved', 'closed') then 'done'
    when c.status = 'on_hold' then 'paused'
    when (c.responded_at is null and now() > due.respond_due) or now() > due.resolve_due then 'overdue'
    when (c.responded_at is null
          and now() > due.respond_due - make_interval(mins => tg.respond_minutes / 4))
      or now() > due.resolve_due - make_interval(mins => tg.resolve_minutes / 4) then 'due_soon'
    else 'on_track'
  end as target_state
from public.complaints c
join public.complaint_categories cat on cat.id = c.category_id
left join public.rooms rm on rm.id = c.room_id
left join public.beds b on b.id = c.bed_id
left join public.residents r on r.id = c.resident_id
left join public.workers w on w.id = c.worker_id
cross join lateral private.complaint_target(c.hostel_id, c.priority) tg
cross join lateral (
  select
    c.created_at + make_interval(mins => tg.respond_minutes)
      + make_interval(secs => c.held_seconds
                              + coalesce(extract(epoch from now() - c.held_since), 0)) as respond_due,
    c.created_at + make_interval(mins => tg.resolve_minutes)
      + make_interval(secs => c.held_seconds
                              + coalesce(extract(epoch from now() - c.held_since), 0)) as resolve_due
) due;

-- ---------------------------------------------------------------------------
-- Helpers for the functions below
-- ---------------------------------------------------------------------------
create or replace function private.actor_name()
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((select p.full_name from public.profiles p where p.id = auth.uid()), 'Automatic');
$$;

create or replace function private.log_complaint(
  p_complaint_id uuid,
  p_kind text,
  p_note text default null,
  p_from text default null,
  p_to text default null,
  p_worker_id uuid default null,
  p_actor_name text default null
)
returns void
language sql
security definer
set search_path = ''
as $$
  insert into public.complaint_events
    (hostel_id, complaint_id, kind, from_status, to_status, worker_id, note, actor_id, actor_name)
  select c.hostel_id, c.id, p_kind, p_from, p_to, p_worker_id, nullif(btrim(p_note), ''),
         auth.uid(), coalesce(p_actor_name, private.actor_name())
    from public.complaints c where c.id = p_complaint_id;
$$;

-- The complaint's hostel, if the caller works there (or owns it); else 42501.
create or replace function private.require_complaint_access(p_complaint_id uuid, p_owner_only boolean)
returns uuid
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  hostel uuid;
begin
  select c.hostel_id into hostel from public.complaints c where c.id = p_complaint_id;
  if hostel is null
     or (p_owner_only and hostel not in (select private.user_owned_hostel_ids()))
     or (not p_owner_only and hostel not in (select private.user_hostel_ids())) then
    raise exception 'You do not have permission to do that' using errcode = '42501';
  end if;
  return hostel;
end;
$$;

-- ---------------------------------------------------------------------------
-- Routing
-- ---------------------------------------------------------------------------
-- Open jobs a worker has across every hostel.
create or replace function private.worker_open_jobs(p_worker_id uuid)
returns integer
language sql
stable
security definer
set search_path = ''
as $$
  select count(*)::integer from public.complaints c
   where c.worker_id = p_worker_id and c.status in ('assigned', 'in_progress', 'on_hold', 'reopened');
$$;

-- Finds a worker for an unassigned complaint whose category routes
-- automatically. Returns the worker, or null when nobody fits (the
-- complaint is then flagged as needing a worker).
create or replace function private.route_complaint(p_complaint_id uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  c record;
  chosen record;
begin
  select cm.id, cm.hostel_id, cm.status, cm.worker_id, cat.trade, cat.auto_route
    into c
    from public.complaints cm join public.complaint_categories cat on cat.id = cm.category_id
   where cm.id = p_complaint_id;
  if not found or c.worker_id is not null or c.status not in ('open', 'reopened') then
    return null;
  end if;
  if not c.auto_route then
    return null;
  end if;

  perform pg_advisory_xact_lock(hashtextextended('complaint_routing:' || c.hostel_id::text, 0));

  select w.id, w.name into chosen
    from public.workers w
    join public.worker_hostels wh on wh.worker_id = w.id and wh.hostel_id = c.hostel_id
   where w.active
     and c.trade = any (w.trades)
     and not exists (
       select 1 from public.worker_unavailability u
        where u.worker_id = w.id and private.today_ist() between u.from_date and u.to_date
     )
     -- Someone who turned this job down is not asked again.
     and not exists (
       select 1 from public.complaint_events e
        where e.complaint_id = c.id and e.kind = 'declined' and e.worker_id = w.id
     )
   order by (w.kind = 'on_site') desc,
            (c.trade = any (wh.preferred_trades)) desc,
            private.worker_open_jobs(w.id),
            w.name, w.id
   limit 1;

  if chosen.id is null then
    update public.complaints set needs_worker = true where id = c.id;
    perform private.log_complaint(c.id, 'routing',
      'Nobody available for ' || replace(c.trade, '_', ' ') || ' work. Assign someone by hand.',
      p_actor_name => 'Automatic');
    return null;
  end if;

  update public.complaints
     set worker_id = chosen.id, status = 'assigned', assigned_at = now(), needs_worker = false
   where id = c.id;
  perform private.log_complaint(c.id, 'assigned', 'Routed automatically', c.status, 'assigned',
                                chosen.id, 'Automatic');
  return chosen.id;
end;
$$;

-- ---------------------------------------------------------------------------
-- What members do
-- ---------------------------------------------------------------------------
-- Raises a complaint and routes it. Owners and staff. Optionally takes the
-- bed out of service for maintenance in the same step.
create or replace function public.raise_complaint(
  p_hostel_id uuid,
  p_category_id uuid,
  p_title text,
  p_description text default null,
  p_priority text default 'normal',
  p_room_id uuid default null,
  p_bed_id uuid default null,
  p_area text default null,
  p_resident_id uuid default null,
  p_bed_maintenance boolean default false
)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if p_hostel_id is null or p_hostel_id not in (select private.user_hostel_ids()) then
    raise exception 'You do not have permission to do that' using errcode = '42501';
  end if;
  return private.raise_complaint(p_hostel_id, p_category_id, p_title, p_description, p_priority,
                                 p_room_id, p_bed_id, p_area, p_resident_id, p_bed_maintenance,
                                 'complaint');
end;
$$;

create or replace function private.raise_complaint(
  p_hostel_id uuid,
  p_category_id uuid,
  p_title text,
  p_description text,
  p_priority text,
  p_room_id uuid,
  p_bed_id uuid,
  p_area text,
  p_resident_id uuid,
  p_bed_maintenance boolean,
  p_kind text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  next_number integer;
  complaint uuid;
begin
  if not exists (
    select 1 from public.complaint_categories cat
     where cat.id = p_category_id and cat.hostel_id = p_hostel_id and cat.active
  ) then
    raise exception 'Choose a category' using errcode = 'P0001', hint = 'complaint_category';
  end if;
  if p_bed_id is not null and not exists (
    select 1 from public.beds b where b.id = p_bed_id and b.room_id = p_room_id
  ) then
    raise exception 'That bed is not in the room' using errcode = 'P0001', hint = 'complaint_bed';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('complaint_number:' || p_hostel_id::text, 0));
  select coalesce(max(c.number), 0) + 1 into next_number
    from public.complaints c where c.hostel_id = p_hostel_id;

  insert into public.complaints
    (hostel_id, number, kind, room_id, bed_id, area, resident_id, category_id, priority,
     title, description, raised_by, raised_by_name)
  values
    (p_hostel_id, next_number, p_kind, p_room_id, p_bed_id, nullif(btrim(p_area), ''), p_resident_id,
     p_category_id, coalesce(p_priority, 'normal'), btrim(p_title), nullif(btrim(p_description), ''),
     auth.uid(), private.actor_name())
  returning id into complaint;
  perform private.log_complaint(complaint, 'created', null, null, 'open');

  if p_bed_maintenance and p_bed_id is not null then
    update public.beds
       set status = 'maintenance', status_reason = 'Complaint #' || next_number
     where id = p_bed_id;
  end if;

  perform private.route_complaint(complaint);
  return complaint;
end;
$$;

-- Assigns a worker serving the hostel, or with null unassigns. Owners and staff.
create or replace function public.assign_complaint(p_complaint_id uuid, p_worker_id uuid)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
begin
  perform private.require_complaint_access(p_complaint_id, false);
  perform private.assign_complaint(p_complaint_id, p_worker_id, null);
end;
$$;

create or replace function private.assign_complaint(p_complaint_id uuid, p_worker_id uuid, p_actor text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  c record;
  next_status text;
begin
  select cm.hostel_id, cm.status, cm.worker_id into c
    from public.complaints cm where cm.id = p_complaint_id for update;
  if c.status in ('resolved', 'closed') then
    raise exception 'Reopen the complaint to assign it again'
      using errcode = 'P0001', hint = 'complaint_finished';
  end if;
  if p_worker_id is not distinct from c.worker_id then
    return;
  end if;
  if p_worker_id is not null and not exists (
    select 1 from public.worker_hostels wh join public.workers w on w.id = wh.worker_id
     where wh.worker_id = p_worker_id and wh.hostel_id = c.hostel_id and w.active
  ) then
    raise exception 'Choose someone who works for this hostel'
      using errcode = 'P0001', hint = 'complaint_worker';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('complaint_routing:' || c.hostel_id::text, 0));
  next_status := case
    when p_worker_id is null and c.status = 'assigned' then 'open'
    when p_worker_id is not null and c.status in ('open', 'reopened', 'in_progress') then 'assigned'
    else c.status
  end;
  update public.complaints
     set worker_id = p_worker_id,
         status = next_status,
         assigned_at = case when p_worker_id is null then null else now() end,
         needs_worker = false
   where id = p_complaint_id;
  perform private.log_complaint(
    p_complaint_id,
    case when p_worker_id is null then 'unassigned' else 'assigned' end,
    null,
    case when next_status <> c.status then c.status end,
    case when next_status <> c.status then next_status end,
    coalesce(p_worker_id, c.worker_id),
    p_actor
  );
end;
$$;

-- Moves a complaint along its lifecycle with an optional note. A hold or a
-- reopen needs a reason. Owners and staff.
create or replace function public.set_complaint_status(
  p_complaint_id uuid,
  p_status text,
  p_note text default null
)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
begin
  perform private.require_complaint_access(p_complaint_id, false);
  perform private.set_complaint_status(p_complaint_id, p_status, p_note, null);
end;
$$;

create or replace function private.set_complaint_status(
  p_complaint_id uuid,
  p_status text,
  p_note text,
  p_actor text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_status text;
  bed uuid;
begin
  select c.status, c.bed_id into current_status, bed
    from public.complaints c where c.id = p_complaint_id for update;
  if p_status in ('on_hold', 'reopened') and nullif(btrim(p_note), '') is null then
    raise exception 'Give a reason' using errcode = 'P0001', hint = 'reason_required';
  end if;
  if p_status = 'assigned' then
    raise exception 'Assign a worker instead' using errcode = 'P0001', hint = 'complaint_transition';
  end if;

  update public.complaints
     set status = p_status,
         hold_reason = case when p_status = 'on_hold' then btrim(p_note) end
   where id = p_complaint_id;
  perform private.log_complaint(p_complaint_id, 'status', p_note, current_status, p_status,
                                null, p_actor);

  -- A fixed bed taken out of service for this complaint goes back into use.
  if p_status in ('resolved', 'closed') and bed is not null then
    update public.beds b
       set status = 'available'
     where b.id = bed and b.status = 'maintenance'
       and b.status_reason = 'Complaint #' || (select c.number from public.complaints c where c.id = p_complaint_id);
  end if;

  if p_status = 'reopened' then
    perform private.route_complaint(p_complaint_id);
  end if;
end;
$$;

-- A note on the complaint's history. Owners and staff.
create or replace function public.comment_complaint(p_complaint_id uuid, p_note text)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
begin
  perform private.require_complaint_access(p_complaint_id, false);
  if nullif(btrim(p_note), '') is null then
    raise exception 'Write a comment' using errcode = 'P0001', hint = 'comment_required';
  end if;
  perform private.log_complaint(p_complaint_id, 'comment', p_note);
end;
$$;

-- Routes again, e.g. after adding a worker. Owners and staff.
create or replace function public.route_complaint(p_complaint_id uuid)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
begin
  perform private.require_complaint_access(p_complaint_id, false);
  return private.route_complaint(p_complaint_id);
end;
$$;

-- Priority and whether a vendor sees the resident's phone. Owners and staff.
create or replace function public.update_complaint(
  p_complaint_id uuid,
  p_priority text,
  p_share_resident_phone boolean
)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
begin
  perform private.require_complaint_access(p_complaint_id, false);
  perform private.update_complaint(p_complaint_id, p_priority, p_share_resident_phone);
end;
$$;

create or replace function private.update_complaint(
  p_complaint_id uuid,
  p_priority text,
  p_share_resident_phone boolean
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  old_priority text;
begin
  select c.priority into old_priority from public.complaints c where c.id = p_complaint_id for update;
  update public.complaints
     set priority = coalesce(p_priority, priority),
         share_resident_phone = coalesce(p_share_resident_phone, share_resident_phone)
   where id = p_complaint_id;
  if p_priority is not null and p_priority <> old_priority then
    perform private.log_complaint(p_complaint_id, 'comment',
      'Priority changed from ' || old_priority || ' to ' || p_priority);
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- Escalation
-- ---------------------------------------------------------------------------
-- Flags complaints past a target, once each. Runs every 15 minutes.
create or replace function private.escalate_complaints()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  item record;
  total integer := 0;
begin
  for item in
    select l.id, l.responded_at, l.respond_due
      from public.complaint_list l
      join public.complaints c on c.id = l.id
     where l.target_state = 'overdue' and c.escalated_at is null
  loop
    update public.complaints set escalated_at = now() where id = item.id;
    perform private.log_complaint(
      item.id, 'escalated',
      case when item.responded_at is null and now() > item.respond_due
           then 'Missed the response target'
           else 'Missed the resolution target' end,
      p_actor_name => 'Automatic');
    total := total + 1;
  end loop;
  return total;
end;
$$;

select cron.schedule('escalate-complaints', '*/15 * * * *', $$select private.escalate_complaints()$$);

-- ---------------------------------------------------------------------------
-- Privileges and row-level security
-- ---------------------------------------------------------------------------
alter table public.complaint_categories enable row level security;
alter table public.workers enable row level security;
alter table public.worker_hostels enable row level security;
alter table public.worker_unavailability enable row level security;
alter table public.complaints enable row level security;
alter table public.complaint_events enable row level security;
alter table public.complaint_targets enable row level security;

revoke all on public.complaint_categories, public.workers, public.worker_hostels,
  public.worker_unavailability, public.complaints, public.complaint_events,
  public.complaint_targets, public.complaint_list from authenticated, anon;

grant select on public.complaints, public.complaint_events, public.complaint_list to authenticated;

grant select on public.complaint_categories to authenticated;
grant insert (hostel_id, name, trade, auto_route) on public.complaint_categories to authenticated;
grant update (name, trade, auto_route, active) on public.complaint_categories to authenticated;

grant select on public.complaint_targets to authenticated;
grant insert (hostel_id, priority, respond_minutes, resolve_minutes) on public.complaint_targets to authenticated;
grant update (respond_minutes, resolve_minutes) on public.complaint_targets to authenticated;
grant delete on public.complaint_targets to authenticated;

grant select on public.workers, public.worker_hostels, public.worker_unavailability to authenticated;
grant insert (owner_id, kind, name, business_name, phone, trades, call_out_charge, notes, profile_id)
  on public.workers to authenticated;
grant update (name, business_name, phone, trades, call_out_charge, notes, profile_id, active)
  on public.workers to authenticated;
grant insert (worker_id, hostel_id, preferred_trades) on public.worker_hostels to authenticated;
grant update (preferred_trades) on public.worker_hostels to authenticated;
grant delete on public.worker_hostels to authenticated;
grant insert (worker_id, from_date, to_date, reason) on public.worker_unavailability to authenticated;
grant delete on public.worker_unavailability to authenticated;

create policy "complaints: members read"
  on public.complaints for select to authenticated
  using (hostel_id in (select private.user_hostel_ids()));
create policy "complaint events: members read"
  on public.complaint_events for select to authenticated
  using (hostel_id in (select private.user_hostel_ids()));

create policy "complaint categories: members read"
  on public.complaint_categories for select to authenticated
  using (hostel_id in (select private.user_hostel_ids()));
create policy "complaint categories: owners write"
  on public.complaint_categories for all to authenticated
  using (hostel_id in (select private.user_owned_hostel_ids()))
  with check (hostel_id in (select private.user_owned_hostel_ids()));

create policy "complaint targets: members read"
  on public.complaint_targets for select to authenticated
  using (hostel_id in (select private.user_hostel_ids()));
create policy "complaint targets: owners write"
  on public.complaint_targets for all to authenticated
  using (hostel_id in (select private.user_owned_hostel_ids()))
  with check (hostel_id in (select private.user_owned_hostel_ids()));

-- Members see the workers who serve their hostel; owners see all of theirs.
create or replace function private.visible_worker_ids()
returns setof uuid
language sql
stable
security definer
set search_path = ''
as $$
  select w.id from public.workers w where w.owner_id = auth.uid()
  union
  select wh.worker_id from public.worker_hostels wh
   where wh.hostel_id in (select private.user_hostel_ids());
$$;

create policy "workers: members read"
  on public.workers for select to authenticated
  using (id in (select private.visible_worker_ids()));
create policy "workers: owners write"
  on public.workers for all to authenticated
  using (owner_id = (select auth.uid()))
  with check (
    owner_id = (select auth.uid())
    and exists (select 1 from private.user_owned_hostel_ids())
  );

create policy "worker hostels: members read"
  on public.worker_hostels for select to authenticated
  using (hostel_id in (select private.user_hostel_ids()));
create policy "worker hostels: owners write"
  on public.worker_hostels for all to authenticated
  using (hostel_id in (select private.user_owned_hostel_ids()))
  with check (hostel_id in (select private.user_owned_hostel_ids()));

create policy "worker unavailability: members read"
  on public.worker_unavailability for select to authenticated
  using (worker_id in (select private.visible_worker_ids()));
create policy "worker unavailability: owners write"
  on public.worker_unavailability for all to authenticated
  using (worker_id in (select w.id from public.workers w where w.owner_id = (select auth.uid())))
  with check (worker_id in (select w.id from public.workers w where w.owner_id = (select auth.uid())));

revoke all on function private.valid_trades(text[]),
  private.add_default_complaint_categories(uuid),
  private.complaint_next_statuses(text),
  private.complaint_target(uuid, text),
  private.actor_name(),
  private.log_complaint(uuid, text, text, text, text, uuid, text),
  private.require_complaint_access(uuid, boolean),
  private.worker_open_jobs(uuid),
  private.route_complaint(uuid),
  private.raise_complaint(uuid, uuid, text, text, text, uuid, uuid, text, uuid, boolean, text),
  private.assign_complaint(uuid, uuid, text),
  private.set_complaint_status(uuid, text, text, text),
  private.update_complaint(uuid, text, boolean),
  private.escalate_complaints(),
  private.visible_worker_ids() from public;
grant execute on function private.valid_trades(text[]),
  private.complaint_next_statuses(text),
  private.complaint_target(uuid, text),
  private.actor_name(),
  private.log_complaint(uuid, text, text, text, text, uuid, text),
  private.require_complaint_access(uuid, boolean),
  private.worker_open_jobs(uuid),
  private.route_complaint(uuid),
  private.raise_complaint(uuid, uuid, text, text, text, uuid, uuid, text, uuid, boolean, text),
  private.assign_complaint(uuid, uuid, text),
  private.set_complaint_status(uuid, text, text, text),
  private.update_complaint(uuid, text, boolean),
  private.visible_worker_ids() to authenticated, service_role;
grant execute on function private.escalate_complaints(), private.add_default_complaint_categories(uuid)
  to service_role;

revoke execute on function public.raise_complaint(uuid, uuid, text, text, text, uuid, uuid, text, uuid, boolean),
  public.assign_complaint(uuid, uuid),
  public.set_complaint_status(uuid, text, text),
  public.comment_complaint(uuid, text),
  public.route_complaint(uuid),
  public.update_complaint(uuid, text, boolean) from public, anon;
grant execute on function public.raise_complaint(uuid, uuid, text, text, text, uuid, uuid, text, uuid, boolean),
  public.assign_complaint(uuid, uuid),
  public.set_complaint_status(uuid, text, text),
  public.comment_complaint(uuid, text),
  public.route_complaint(uuid),
  public.update_complaint(uuid, text, boolean) to authenticated;
