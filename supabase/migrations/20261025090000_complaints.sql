-- Complaints and maintenance (ClickUp EP-15).
--
-- T1  complaints, per-hostel categories (each mapped to a trade), a status
--     machine enforced here, and an append-only event log.
-- T6  workers: on-site staff and outside vendors, with trades and time off.
-- T7  automatic routing to the right worker.
-- T8  a job link for workers without an account: an unguessable token for
--     one job, stored hashed, dead once the job is closed or reassigned.
-- T9  repair costs, who pays (a resident charge goes on their next
--     invoice), and a log of vendor payouts.
-- T10 response and resolution targets per priority, paused while on hold.
-- T11 reports, computed here.
-- T12 recurring preventive maintenance that becomes scheduled complaints.
-- T5  photo and video attachments in a private bucket.
--
-- Every change to a complaint goes through a function, so the event log is
-- always complete. Members of the hostel (owner and staff) read and work
-- complaints; owners manage workers, categories, targets, schedules and
-- payouts. A worker's job link reaches only that job.

-- ---------------------------------------------------------------------------
-- Categories (T1)
-- ---------------------------------------------------------------------------
create table public.complaint_categories (
  id uuid primary key default gen_random_uuid(),
  hostel_id uuid not null references public.hostels (id) on delete cascade,
  name text not null,
  trade text not null,
  auto_route boolean not null default true,
  active boolean not null default true,
  position integer not null default 0,
  created_at timestamptz not null default now(),

  constraint complaint_categories_hostel_id_key unique (hostel_id, id),
  constraint complaint_categories_name_length check (char_length(btrim(name)) between 1 and 60),
  constraint complaint_categories_trade_valid check (
    trade in ('electrician', 'plumber', 'carpenter', 'cleaner', 'technician', 'pest_control', 'general')
  )
);

create unique index complaint_categories_name_idx on public.complaint_categories (hostel_id, lower(btrim(name)));

comment on table public.complaint_categories is
  'Complaint categories per hostel (EP-15 T1). The trade decides which worker a complaint is routed to.';

create or replace function private.seed_complaint_categories(p_hostel_id uuid)
returns void
language sql
volatile
security definer
set search_path = ''
as $$
  insert into public.complaint_categories (hostel_id, name, trade, position)
  values
    (p_hostel_id, 'Electrical', 'electrician', 1),
    (p_hostel_id, 'Plumbing', 'plumber', 2),
    (p_hostel_id, 'Carpentry', 'carpenter', 3),
    (p_hostel_id, 'Cleaning', 'cleaner', 4),
    (p_hostel_id, 'Internet', 'technician', 5),
    (p_hostel_id, 'Appliance', 'technician', 6),
    (p_hostel_id, 'Pest control', 'pest_control', 7),
    (p_hostel_id, 'Security', 'general', 8),
    (p_hostel_id, 'Other', 'general', 9)
  on conflict do nothing;
$$;

revoke all on function private.seed_complaint_categories(uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Targets (T10)
-- ---------------------------------------------------------------------------
create table public.complaint_targets (
  hostel_id uuid not null references public.hostels (id) on delete cascade,
  priority text not null,
  respond_minutes integer not null,
  resolve_minutes integer not null,
  primary key (hostel_id, priority),
  constraint complaint_targets_priority_valid check (priority in ('low', 'normal', 'high', 'urgent')),
  constraint complaint_targets_respond_range check (respond_minutes between 5 and 43200),
  constraint complaint_targets_resolve_range check (resolve_minutes between 5 and 129600),
  constraint complaint_targets_order check (resolve_minutes >= respond_minutes)
);

comment on table public.complaint_targets is
  'Response and resolution targets per priority (EP-15 T10). Time on hold does not count.';

create or replace function private.seed_complaint_targets(p_hostel_id uuid)
returns void
language sql
volatile
security definer
set search_path = ''
as $$
  insert into public.complaint_targets (hostel_id, priority, respond_minutes, resolve_minutes)
  values
    (p_hostel_id, 'urgent', 120, 1440),
    (p_hostel_id, 'high', 240, 2880),
    (p_hostel_id, 'normal', 1440, 4320),
    (p_hostel_id, 'low', 2880, 10080)
  on conflict do nothing;
$$;

revoke all on function private.seed_complaint_targets(uuid) from public, anon, authenticated;

create or replace function private.hostels_seed_complaints()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.seed_complaint_categories(new.id);
  perform private.seed_complaint_targets(new.id);
  return null;
end;
$$;

create trigger hostels_seed_complaints
  after insert on public.hostels
  for each row execute function private.hostels_seed_complaints();

select private.seed_complaint_categories(h.id), private.seed_complaint_targets(h.id) from public.hostels h;

alter table public.hostels
  add column complaints_share_resident_phone boolean not null default false;

grant update (complaints_share_resident_phone) on public.hostels to authenticated;

comment on column public.hostels.complaints_share_resident_phone is
  'Whether a worker''s job link shows the resident''s phone number (EP-15 T8).';

-- ---------------------------------------------------------------------------
-- Workers (T6)
-- ---------------------------------------------------------------------------
create table public.workers (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references public.profiles (id) on delete cascade,
  -- An on-site worker belongs to one hostel. A vendor with no hostel is
  -- shared across all of the owner's hostels.
  hostel_id uuid references public.hostels (id) on delete cascade,
  kind text not null,
  full_name text not null,
  business_name text,
  phone text not null,
  trades text[] not null,
  call_out_charge integer,
  notes text,
  -- A staff account the on-site worker signs in with, if any.
  profile_id uuid references public.profiles (id) on delete set null,
  preferred boolean not null default false,
  active boolean not null default true,
  created_at timestamptz not null default now(),

  constraint workers_kind_valid check (kind in ('on_site', 'vendor')),
  constraint workers_on_site_hostel check (kind <> 'on_site' or hostel_id is not null),
  constraint workers_name_length check (char_length(btrim(full_name)) between 1 and 100),
  constraint workers_business_length check (char_length(btrim(business_name)) between 1 and 100),
  constraint workers_phone_format check (phone ~ '^[6-9][0-9]{9}$'),
  constraint workers_trades_valid check (
    cardinality(trades) between 1 and 7
    and trades <@ array['electrician', 'plumber', 'carpenter', 'cleaner', 'technician', 'pest_control', 'general']
  ),
  constraint workers_call_out_range check (call_out_charge between 0 and 10000000),
  constraint workers_notes_length check (char_length(notes) <= 500)
);

create index workers_owner_idx on public.workers (owner_id);
create index workers_hostel_idx on public.workers (hostel_id);

comment on table public.workers is
  'People who fix things (EP-15 T6): on-site staff of one hostel, or outside vendors shared across the owner''s hostels.';

create table public.worker_unavailability (
  id uuid primary key default gen_random_uuid(),
  worker_id uuid not null references public.workers (id) on delete cascade,
  from_date date not null,
  to_date date not null,
  reason text,
  created_at timestamptz not null default now(),
  constraint worker_unavailability_order check (to_date >= from_date),
  constraint worker_unavailability_reason_length check (char_length(btrim(reason)) between 1 and 200)
);

create index worker_unavailability_worker_idx on public.worker_unavailability (worker_id, to_date);

-- Whether a worker can take jobs in a hostel.
create or replace function private.worker_serves(p_worker public.workers, p_hostel_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  -- coalesce: a shared vendor has no hostel, and null must not read as "maybe".
  select coalesce(p_worker.hostel_id = p_hostel_id, false)
      or (p_worker.hostel_id is null
          and exists (select 1 from public.hostels h where h.id = p_hostel_id and h.owner_id = p_worker.owner_id));
$$;

revoke all on function private.worker_serves(public.workers, uuid) from public, anon;
grant execute on function private.worker_serves(public.workers, uuid) to authenticated;

-- Owner's own workers, and the workers serving a hostel the user works in.
create or replace function private.visible_worker_ids()
returns setof uuid
language sql
stable
security definer
set search_path = ''
as $$
  select w.id from public.workers w
   where w.owner_id = (select auth.uid())
      or w.hostel_id in (select private.user_hostel_ids())
      or (w.hostel_id is null and w.owner_id in (
            select h.owner_id from public.hostels h where h.id in (select private.user_hostel_ids())));
$$;

revoke all on function private.visible_worker_ids() from public, anon;
grant execute on function private.visible_worker_ids() to authenticated;

create or replace function private.workers_guard()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if current_user = 'authenticated' then
    if not exists (select 1 from public.profiles p where p.id = (select auth.uid()) and p.role = 'owner') then
      raise exception 'Only hostel owners manage workers' using errcode = '42501', hint = 'not_owner';
    end if;
    new.owner_id := (select auth.uid());
    if new.hostel_id is not null and new.hostel_id not in (select private.user_owned_hostel_ids()) then
      raise exception 'Hostel not found' using errcode = 'P0001', hint = 'hostel_not_found';
    end if;
    if new.profile_id is not null and not exists (
      select 1 from public.profiles p
       where p.id = new.profile_id and p.role = 'staff' and p.hostel_id = new.hostel_id
    ) then
      raise exception 'That staff account is not part of this hostel'
        using errcode = 'P0001', hint = 'worker_profile_invalid';
    end if;
  end if;
  new.business_name := nullif(btrim(new.business_name), '');
  new.notes := nullif(btrim(new.notes), '');
  return new;
end;
$$;

create trigger workers_guard
  before insert or update on public.workers
  for each row execute function private.workers_guard();

-- ---------------------------------------------------------------------------
-- Complaints (T1, T2)
-- ---------------------------------------------------------------------------
create table public.complaints (
  id uuid primary key default gen_random_uuid(),
  hostel_id uuid not null references public.hostels (id) on delete cascade,
  number integer not null default 0,
  kind text not null default 'reported',
  schedule_id uuid,
  room_id uuid,
  bed_id uuid,
  -- A common area (kitchen, terrace) when the complaint is not about a room.
  area text,
  resident_id uuid,
  raised_by uuid references public.profiles (id) on delete set null,
  raised_by_kind text not null default 'staff',
  category_id uuid not null,
  priority text not null default 'normal',
  title text not null,
  description text,
  status text not null default 'open',
  worker_id uuid references public.workers (id) on delete set null,
  needs_worker boolean not null default false,
  created_at timestamptz not null default now(),
  first_response_at timestamptz,
  assigned_at timestamptz,
  started_at timestamptz,
  resolved_at timestamptz,
  closed_at timestamptz,
  hold_started_at timestamptz,
  hold_seconds integer not null default 0,
  reopened_count integer not null default 0,
  updated_at timestamptz not null default now(),

  constraint complaints_hostel_id_key unique (hostel_id, id),
  constraint complaints_room_fkey foreign key (hostel_id, room_id) references public.rooms (hostel_id, id),
  constraint complaints_bed_fkey foreign key (bed_id) references public.beds (id),
  constraint complaints_resident_fkey foreign key (hostel_id, resident_id)
    references public.residents (hostel_id, id),
  constraint complaints_category_fkey foreign key (hostel_id, category_id)
    references public.complaint_categories (hostel_id, id),
  constraint complaints_where check (room_id is not null or area is not null),
  constraint complaints_bed_needs_room check (bed_id is null or room_id is not null),
  constraint complaints_area_length check (char_length(btrim(area)) between 1 and 100),
  constraint complaints_kind_valid check (kind in ('reported', 'scheduled')),
  constraint complaints_raised_by_kind_valid check (raised_by_kind in ('owner', 'staff', 'resident', 'schedule')),
  constraint complaints_priority_valid check (priority in ('low', 'normal', 'high', 'urgent')),
  constraint complaints_title_length check (char_length(btrim(title)) between 1 and 120),
  constraint complaints_description_length check (char_length(description) <= 2000),
  constraint complaints_status_valid check (
    status in ('open', 'assigned', 'in_progress', 'on_hold', 'resolved', 'closed', 'reopened')
  )
);

create unique index complaints_number_idx on public.complaints (hostel_id, number);
create index complaints_hostel_status_idx on public.complaints (hostel_id, status, created_at desc);
create index complaints_room_idx on public.complaints (room_id) where room_id is not null;
create index complaints_resident_idx on public.complaints (resident_id) where resident_id is not null;
create index complaints_worker_idx on public.complaints (worker_id) where worker_id is not null;

comment on table public.complaints is
  'Complaints and maintenance jobs (EP-15). Changed only through the complaint functions, which log every change.';

create table public.complaint_events (
  id uuid primary key default gen_random_uuid(),
  hostel_id uuid not null references public.hostels (id) on delete cascade,
  complaint_id uuid not null,
  kind text not null,
  from_status text,
  to_status text,
  worker_id uuid references public.workers (id) on delete set null,
  body text,
  actor_id uuid references public.profiles (id) on delete set null,
  actor_name text,
  -- 'member' (owner or staff), 'worker' (through a job link) or 'system'.
  actor_kind text not null default 'member',
  created_at timestamptz not null default now(),

  constraint complaint_events_complaint_fkey foreign key (hostel_id, complaint_id)
    references public.complaints (hostel_id, id) on delete cascade,
  constraint complaint_events_kind_valid check (
    kind in ('created', 'status', 'assigned', 'unassigned', 'declined', 'comment', 'cost', 'attachment', 'job', 'needs_worker')
  ),
  constraint complaint_events_actor_kind_valid check (actor_kind in ('member', 'worker', 'system')),
  constraint complaint_events_body_length check (char_length(body) <= 2000)
);

create index complaint_events_complaint_idx on public.complaint_events (complaint_id, created_at);

comment on table public.complaint_events is
  'Append-only history of each complaint: status changes, assignments, comments, costs and job-link updates.';

create or replace function private.complaint_events_immutable()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  raise exception 'Complaint history cannot be changed' using errcode = 'P0001', hint = 'complaint_history_immutable';
end;
$$;

create trigger complaint_events_immutable
  before update or delete on public.complaint_events
  for each row when (current_user = 'authenticated')
  execute function private.complaint_events_immutable();

create or replace function private.complaint_log(
  p_complaint_id uuid,
  p_kind text,
  p_from text,
  p_to text,
  p_worker uuid,
  p_body text,
  p_actor_kind text
)
returns void
language sql
volatile
security definer
set search_path = ''
as $$
  insert into public.complaint_events
    (hostel_id, complaint_id, kind, from_status, to_status, worker_id, body, actor_id, actor_name, actor_kind)
  select c.hostel_id, c.id, p_kind, p_from, p_to, p_worker, nullif(btrim(p_body), ''),
         case when p_actor_kind = 'member' then (select auth.uid()) end,
         case
           when p_actor_kind = 'member' then (select pr.full_name from public.profiles pr where pr.id = (select auth.uid()))
           when p_actor_kind = 'worker' then (select w.full_name from public.workers w where w.id = p_worker)
         end,
         p_actor_kind
    from public.complaints c where c.id = p_complaint_id;
$$;

revoke all on function private.complaint_log(uuid, text, text, text, uuid, text, text) from public, anon, authenticated;

-- Allowed moves between statuses.
create or replace function private.complaint_transition_allowed(p_from text, p_to text)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select case p_from
    when 'open' then p_to in ('assigned', 'in_progress', 'on_hold', 'resolved', 'closed')
    when 'assigned' then p_to in ('open', 'in_progress', 'on_hold', 'resolved', 'closed')
    when 'in_progress' then p_to in ('assigned', 'on_hold', 'resolved')
    when 'on_hold' then p_to in ('open', 'assigned', 'in_progress', 'resolved', 'closed')
    when 'resolved' then p_to in ('closed', 'reopened')
    when 'closed' then p_to in ('reopened')
    when 'reopened' then p_to in ('assigned', 'in_progress', 'on_hold', 'resolved', 'closed')
    else false
  end;
$$;

-- New complaints: number, timestamps, and checks the form cannot make.
create or replace function private.complaints_guard_insert()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if new.hostel_id not in (select private.user_hostel_ids()) and current_user = 'authenticated' then
    raise exception 'Hostel not found' using errcode = 'P0001', hint = 'hostel_not_found';
  end if;
  if new.bed_id is not null and not exists (
    select 1 from public.beds b where b.id = new.bed_id and b.room_id = new.room_id
  ) then
    raise exception 'That bed is not in this room' using errcode = 'P0001', hint = 'complaint_bed_room';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('complaint-number:' || new.hostel_id::text, 0));
  select coalesce(max(c.number), 0) + 1 into new.number from public.complaints c where c.hostel_id = new.hostel_id;
  if current_user = 'authenticated' then
    new.raised_by := (select auth.uid());
    new.raised_by_kind := case
      when new.hostel_id in (select private.user_owned_hostel_ids()) then 'owner' else 'staff' end;
    new.kind := 'reported';
    new.schedule_id := null;
  end if;
  new.status := 'open';
  new.worker_id := null;
  new.needs_worker := false;
  new.created_at := now();
  new.updated_at := now();
  new.first_response_at := null;
  new.assigned_at := null;
  new.started_at := null;
  new.resolved_at := null;
  new.closed_at := null;
  new.hold_started_at := null;
  new.hold_seconds := 0;
  new.reopened_count := 0;
  new.area := nullif(btrim(new.area), '');
  new.description := nullif(btrim(new.description), '');
  return new;
end;
$$;

create trigger complaints_guard_insert
  before insert on public.complaints
  for each row execute function private.complaints_guard_insert();

-- ---------------------------------------------------------------------------
-- Routing (T7)
-- ---------------------------------------------------------------------------
-- Open jobs a worker holds anywhere.
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

revoke all on function private.worker_open_jobs(uuid) from public, anon, authenticated;

-- Picks the worker for a complaint: an available on-site worker with the
-- trade, then the hostel's preferred vendor, then any vendor with the trade;
-- fewest open jobs breaks a tie. Workers who declined it are skipped.
create or replace function private.pick_worker(p_complaint_id uuid)
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select w.id
    from public.complaints c
    join public.complaint_categories cat on cat.id = c.category_id
    join public.workers w on w.active and cat.trade = any (w.trades) and private.worker_serves(w, c.hostel_id)
   where c.id = p_complaint_id
     and not exists (
       select 1 from public.worker_unavailability u
        where u.worker_id = w.id and private.today_ist() between u.from_date and u.to_date)
     and not exists (
       select 1 from public.complaint_events e
        where e.complaint_id = c.id and e.kind = 'declined' and e.worker_id = w.id)
   order by case when w.kind = 'on_site' then 0 when w.preferred then 1 else 2 end,
            private.worker_open_jobs(w.id),
            w.full_name,
            w.id
   limit 1;
$$;

revoke all on function private.pick_worker(uuid) from public, anon, authenticated;

-- Assigns (or unassigns, with null) a worker and logs it. Ends any job
-- link for the previous worker. Callers check access.
create or replace function private.complaint_set_worker(
  p_complaint_id uuid,
  p_worker_id uuid,
  p_actor_kind text,
  p_note text
)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  c record;
  v_status text;
begin
  select * into c from public.complaints where id = p_complaint_id for update;
  if c.worker_id is not distinct from p_worker_id then
    return;
  end if;
  update public.complaint_job_tokens set revoked_at = now()
   where complaint_id = c.id and revoked_at is null;
  v_status := case
    when p_worker_id is null and c.status in ('assigned', 'in_progress') then 'open'
    when p_worker_id is not null and c.status in ('open', 'reopened') then 'assigned'
    else c.status
  end;
  update public.complaints
     set worker_id = p_worker_id,
         needs_worker = false,
         status = v_status,
         assigned_at = case when p_worker_id is not null then now() else assigned_at end,
         first_response_at = coalesce(first_response_at, case when p_worker_id is not null then now() end),
         updated_at = now()
   where id = c.id;
  if c.worker_id is not null then
    perform private.complaint_log(c.id, 'unassigned', null, null, c.worker_id, p_note, p_actor_kind);
  end if;
  if p_worker_id is not null then
    perform private.complaint_log(c.id, 'assigned', c.status, v_status, p_worker_id, null, p_actor_kind);
  end if;
end;
$$;

revoke all on function private.complaint_set_worker(uuid, uuid, text, text) from public, anon, authenticated;

-- Routes a complaint, or flags it as needing a worker. Two complaints are
-- routed one at a time per hostel, so open-job counts are never stale.
create or replace function private.route_complaint(p_complaint_id uuid)
returns uuid
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_hostel uuid;
  v_worker uuid;
begin
  select c.hostel_id into v_hostel from public.complaints c where c.id = p_complaint_id;
  perform pg_advisory_xact_lock(hashtextextended('route:' || v_hostel::text, 0));
  v_worker := private.pick_worker(p_complaint_id);
  if v_worker is null then
    update public.complaints set needs_worker = true, updated_at = now() where id = p_complaint_id;
    perform private.complaint_log(p_complaint_id, 'needs_worker', null, null, null, null, 'system');
    return null;
  end if;
  perform private.complaint_set_worker(p_complaint_id, v_worker, 'system', null);
  return v_worker;
end;
$$;

revoke all on function private.route_complaint(uuid) from public, anon, authenticated;

create or replace function private.complaints_after_insert()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.complaint_log(new.id, 'created', null, 'open', null, new.description,
    case when new.kind = 'scheduled' then 'system' else 'member' end);
  if (select cat.auto_route from public.complaint_categories cat where cat.id = new.category_id) then
    perform private.route_complaint(new.id);
  end if;
  return null;
end;
$$;

create trigger complaints_after_insert
  after insert on public.complaints
  for each row execute function private.complaints_after_insert();

-- ---------------------------------------------------------------------------
-- Working a complaint (T2): status, assignment, comments
-- ---------------------------------------------------------------------------
-- Moves a complaint to a new status, keeping the clocks. Callers check access.
create or replace function private.complaint_move(
  p_complaint_id uuid,
  p_status text,
  p_note text,
  p_actor_kind text,
  p_worker uuid
)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  c record;
begin
  select * into c from public.complaints where id = p_complaint_id for update;
  if c.status = p_status then
    return;
  end if;
  if not private.complaint_transition_allowed(c.status, p_status) then
    raise exception 'A % complaint cannot be moved to %', replace(c.status, '_', ' '), replace(p_status, '_', ' ')
      using errcode = 'P0001', hint = 'complaint_transition';
  end if;
  if p_status = 'on_hold' and nullif(btrim(p_note), '') is null then
    raise exception 'Say why the complaint is on hold' using errcode = 'P0001', hint = 'hold_reason';
  end if;
  if p_status = 'reopened' and nullif(btrim(p_note), '') is null then
    raise exception 'Say why the complaint is reopened' using errcode = 'P0001', hint = 'reopen_reason';
  end if;
  if p_status = 'assigned' and c.worker_id is null then
    raise exception 'Assign a worker first' using errcode = 'P0001', hint = 'complaint_no_worker';
  end if;
  update public.complaints
     set status = p_status,
         first_response_at = coalesce(first_response_at,
           case when p_status <> 'open' then now() end),
         started_at = case when p_status = 'in_progress' then coalesce(started_at, now()) else started_at end,
         resolved_at = case when p_status = 'resolved' then now()
                            when p_status = 'reopened' then null else resolved_at end,
         closed_at = case when p_status = 'closed' then now()
                          when p_status = 'reopened' then null else closed_at end,
         hold_started_at = case when p_status = 'on_hold' then now() else null end,
         hold_seconds = hold_seconds + case
           when c.status = 'on_hold' and c.hold_started_at is not null
             then extract(epoch from now() - c.hold_started_at)::integer else 0 end,
         reopened_count = reopened_count + case when p_status = 'reopened' then 1 else 0 end,
         updated_at = now()
   where id = c.id;
  if p_status in ('resolved', 'closed') then
    update public.complaint_job_tokens set revoked_at = now()
     where complaint_id = c.id and revoked_at is null;
  end if;
  perform private.complaint_log(c.id, 'status', c.status, p_status, p_worker, p_note, p_actor_kind);
end;
$$;

revoke all on function private.complaint_move(uuid, text, text, text, uuid) from public, anon, authenticated;

create or replace function private.complaint_member(p_complaint_id uuid)
returns uuid
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_hostel uuid;
begin
  select c.hostel_id into v_hostel from public.complaints c where c.id = p_complaint_id;
  if v_hostel is null or v_hostel not in (select private.user_hostel_ids()) then
    raise exception 'Complaint not found' using errcode = 'P0001', hint = 'complaint_not_found';
  end if;
  return v_hostel;
end;
$$;

revoke all on function private.complaint_member(uuid) from public, anon, authenticated;

create or replace function private.complaint_set_status(p_complaint_id uuid, p_status text, p_note text)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
  perform private.complaint_member(p_complaint_id);
  perform private.complaint_move(p_complaint_id, p_status, p_note, 'member', null);
end;
$$;

create or replace function private.complaint_assign(p_complaint_id uuid, p_worker_id uuid, p_note text)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_hostel uuid := private.complaint_member(p_complaint_id);
  w public.workers;
begin
  if (select c.status from public.complaints c where c.id = p_complaint_id) in ('resolved', 'closed') then
    raise exception 'Reopen the complaint first' using errcode = 'P0001', hint = 'complaint_done';
  end if;
  if p_worker_id is not null then
    select * into w from public.workers where id = p_worker_id;
    if not found or not w.active or not private.worker_serves(w, v_hostel) then
      raise exception 'That worker does not work for this hostel' using errcode = 'P0001', hint = 'worker_not_found';
    end if;
  end if;
  perform pg_advisory_xact_lock(hashtextextended('route:' || v_hostel::text, 0));
  perform private.complaint_set_worker(p_complaint_id, p_worker_id, 'member', p_note);
end;
$$;

create or replace function private.complaint_auto_route(p_complaint_id uuid)
returns uuid
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
  perform private.complaint_member(p_complaint_id);
  return private.route_complaint(p_complaint_id);
end;
$$;

create or replace function private.complaint_comment(p_complaint_id uuid, p_body text)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
  perform private.complaint_member(p_complaint_id);
  if nullif(btrim(p_body), '') is null or char_length(p_body) > 2000 then
    raise exception 'Write a comment of up to 2000 characters' using errcode = 'P0001', hint = 'comment_invalid';
  end if;
  update public.complaints
     set first_response_at = coalesce(first_response_at, now()), updated_at = now()
   where id = p_complaint_id;
  perform private.complaint_log(p_complaint_id, 'comment', null, null, null, p_body, 'member');
end;
$$;

-- ---------------------------------------------------------------------------
-- Job links (T8)
-- ---------------------------------------------------------------------------
create table public.complaint_job_tokens (
  id uuid primary key default gen_random_uuid(),
  complaint_id uuid not null references public.complaints (id) on delete cascade,
  worker_id uuid not null references public.workers (id) on delete cascade,
  token_hash bytea not null unique,
  state text not null default 'sent',
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  revoked_at timestamptz,
  constraint complaint_job_tokens_state_valid check (
    state in ('sent', 'accepted', 'on_the_way', 'started', 'done', 'declined')
  )
);

create index complaint_job_tokens_complaint_idx on public.complaint_job_tokens (complaint_id);

comment on table public.complaint_job_tokens is
  'Job links for workers without an account (EP-15 T8). Only a SHA-256 of the token is kept; a link works while its worker holds the job and it is not done.';

-- Each job link's updates, for the rate limit.
create table public.complaint_job_hits (
  token_id uuid not null references public.complaint_job_tokens (id) on delete cascade,
  at timestamptz not null default now()
);

create index complaint_job_hits_idx on public.complaint_job_hits (token_id, at);

-- Makes a job link for the assigned worker; returns the raw token once.
-- Any earlier link for the job stops working.
create or replace function private.complaint_job_link(p_complaint_id uuid)
returns text
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  c record;
  v_token text;
begin
  perform private.complaint_member(p_complaint_id);
  select * into c from public.complaints where id = p_complaint_id;
  if c.worker_id is null then
    raise exception 'Assign a worker first' using errcode = 'P0001', hint = 'complaint_no_worker';
  end if;
  if c.status in ('resolved', 'closed') then
    raise exception 'This job is finished' using errcode = 'P0001', hint = 'complaint_done';
  end if;
  update public.complaint_job_tokens set revoked_at = now()
   where complaint_id = c.id and revoked_at is null;
  -- 64 hex characters from two random UUIDs: 244 random bits.
  v_token := replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', '');
  insert into public.complaint_job_tokens (complaint_id, worker_id, token_hash, created_by)
  values (c.id, c.worker_id, sha256(convert_to(v_token, 'UTF8')), (select auth.uid()));
  perform private.complaint_log(c.id, 'job', null, null, c.worker_id, 'Job link sent', 'member');
  return v_token;
end;
$$;

-- The live token row for a raw token, or nothing.
create or replace function private.job_token(p_token text)
returns public.complaint_job_tokens
language sql
stable
security definer
set search_path = ''
as $$
  select t.* from public.complaint_job_tokens t
    join public.complaints c on c.id = t.complaint_id
   where p_token ~ '^[0-9a-f]{64}$'
     and t.token_hash = sha256(convert_to(p_token, 'UTF8'))
     and t.revoked_at is null
     and c.worker_id = t.worker_id
     and c.status not in ('resolved', 'closed');
$$;

revoke all on function private.job_token(text) from public, anon, authenticated;

-- Workers open job links without an account, so the two functions they
-- call live in a schema of their own that the anonymous role can use;
-- `private` stays closed to it.
create schema if not exists job_link;
revoke all on schema job_link from public;
grant usage on schema job_link to anon, authenticated;

-- What the worker sees: this one job and nothing else.
create or replace function job_link.job_view(p_token text)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  t public.complaint_job_tokens;
begin
  t := private.job_token(p_token);
  if t.id is null then
    return null;
  end if;
  return (
    select jsonb_build_object(
      'complaint_id', c.id,
      'hostel_id', c.hostel_id,
      'number', c.number,
      'state', t.state,
      'title', c.title,
      'description', c.description,
      'priority', c.priority,
      'status', c.status,
      'category', cat.name,
      'hostel', h.name,
      'address', concat_ws(', ', h.address, h.city, h.state, h.pincode),
      'hostel_phone', h.phone,
      'room', r.room_number,
      'floor', r.floor,
      'bed', b.bed_label,
      'area', c.area,
      'resident_name', case when re.erased_at is null then re.full_name end,
      'resident_phone', case when h.complaints_share_resident_phone and re.erased_at is null then re.phone end,
      'worker', w.full_name,
      'created_at', c.created_at,
      'attachments', coalesce((
        select jsonb_agg(jsonb_build_object('id', a.id, 'mime_type', a.mime_type, 'stage', a.stage)
                         order by a.created_at)
          from public.complaint_attachments a where a.complaint_id = c.id), '[]'::jsonb)
    )
    from public.complaints c
    join public.hostels h on h.id = c.hostel_id
    join public.complaint_categories cat on cat.id = c.category_id
    join public.workers w on w.id = t.worker_id
    left join public.rooms r on r.id = c.room_id
    left join public.beds b on b.id = c.bed_id
    left join public.residents re on re.id = c.resident_id
    where c.id = t.complaint_id
  );
end;
$$;

-- A worker's update through the link: accept, decline, on the way, started,
-- or done (with a note and their charge). At most 20 updates an hour.
create or replace function job_link.job_update(p_token text, p_action text, p_note text, p_charge integer)
returns text
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  t public.complaint_job_tokens;
  c record;
begin
  t := private.job_token(p_token);
  if t.id is null then
    raise exception 'This job link no longer works' using errcode = 'P0001', hint = 'job_link_invalid';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('job:' || t.id::text, 0));
  if (select count(*) from public.complaint_job_hits h where h.token_id = t.id and h.at > now() - interval '1 hour') >= 20 then
    raise exception 'Too many updates. Try again later.' using errcode = 'P0001', hint = 'job_rate_limited';
  end if;
  insert into public.complaint_job_hits (token_id) values (t.id);
  if p_note is not null and char_length(p_note) > 1000 then
    raise exception 'The note is too long' using errcode = 'P0001', hint = 'job_note_length';
  end if;
  if p_charge is not null and p_charge not between 0 and 10000000 then
    raise exception 'Enter a charge between ₹0 and ₹1,00,000' using errcode = 'P0001', hint = 'job_charge_range';
  end if;
  select * into c from public.complaints where id = t.complaint_id;

  case p_action
    when 'accept' then
      if t.state <> 'sent' then
        raise exception 'This job is already accepted' using errcode = 'P0001', hint = 'job_state';
      end if;
      update public.complaint_job_tokens set state = 'accepted' where id = t.id;
      perform private.complaint_log(c.id, 'job', null, null, t.worker_id, coalesce(nullif(btrim(p_note), ''), 'Accepted the job'), 'worker');
    when 'decline' then
      update public.complaint_job_tokens set state = 'declined', revoked_at = now() where id = t.id;
      perform private.complaint_log(c.id, 'declined', null, null, t.worker_id, p_note, 'worker');
      perform private.complaint_set_worker(c.id, null, 'worker', null);
      perform private.route_complaint(c.id);
    when 'on_the_way' then
      if t.state not in ('accepted') then
        raise exception 'Accept the job first' using errcode = 'P0001', hint = 'job_state';
      end if;
      update public.complaint_job_tokens set state = 'on_the_way' where id = t.id;
      perform private.complaint_log(c.id, 'job', null, null, t.worker_id, coalesce(nullif(btrim(p_note), ''), 'On the way'), 'worker');
    when 'started' then
      if t.state not in ('accepted', 'on_the_way') then
        raise exception 'Accept the job first' using errcode = 'P0001', hint = 'job_state';
      end if;
      update public.complaint_job_tokens set state = 'started' where id = t.id;
      perform private.complaint_move(c.id, 'in_progress', p_note, 'worker', t.worker_id);
    when 'done' then
      if t.state not in ('accepted', 'on_the_way', 'started') then
        raise exception 'Accept the job first' using errcode = 'P0001', hint = 'job_state';
      end if;
      update public.complaint_job_tokens set state = 'done' where id = t.id;
      if p_charge is not null and p_charge > 0 then
        insert into public.complaint_costs (hostel_id, complaint_id, kind, amount, payer, description, recorded_via_job)
        values (c.hostel_id, c.id, 'vendor_charge', p_charge, 'hostel', 'Charge from the job link', true);
      end if;
      perform private.complaint_move(c.id, 'resolved', coalesce(nullif(btrim(p_note), ''), 'Marked done by the worker'), 'worker', t.worker_id);
    else
      raise exception 'Unknown action' using errcode = 'P0001', hint = 'job_action';
  end case;
  return (select state from public.complaint_job_tokens where id = t.id);
end;
$$;

-- ---------------------------------------------------------------------------
-- Costs and payouts (T9)
-- ---------------------------------------------------------------------------
create table public.complaint_costs (
  id uuid primary key default gen_random_uuid(),
  hostel_id uuid not null references public.hostels (id) on delete cascade,
  complaint_id uuid not null,
  kind text not null,
  amount integer not null,
  payer text not null default 'hostel',
  description text,
  -- The resident charge a resident-paid cost became.
  charge_id uuid references public.resident_charges (id),
  recorded_via_job boolean not null default false,
  recorded_by uuid references public.profiles (id) on delete set null default auth.uid(),
  voided_at timestamptz,
  void_reason text,
  created_at timestamptz not null default now(),

  constraint complaint_costs_complaint_fkey foreign key (hostel_id, complaint_id)
    references public.complaints (hostel_id, id),
  constraint complaint_costs_kind_valid check (kind in ('labour', 'material', 'vendor_charge')),
  constraint complaint_costs_amount_range check (amount between 1 and 10000000),
  constraint complaint_costs_payer_valid check (payer in ('hostel', 'resident')),
  constraint complaint_costs_description_length check (char_length(btrim(description)) between 1 and 200),
  constraint complaint_costs_void_has_reason check ((voided_at is null) = (void_reason is null))
);

create index complaint_costs_complaint_idx on public.complaint_costs (complaint_id);
create index complaint_costs_hostel_idx on public.complaint_costs (hostel_id, created_at);

create table public.complaint_payouts (
  id uuid primary key default gen_random_uuid(),
  hostel_id uuid not null references public.hostels (id) on delete cascade,
  complaint_id uuid not null,
  worker_id uuid not null references public.workers (id),
  amount integer not null,
  paid_at date not null,
  mode text not null,
  reference text,
  recorded_by uuid references public.profiles (id) on delete set null default auth.uid(),
  created_at timestamptz not null default now(),

  constraint complaint_payouts_complaint_fkey foreign key (hostel_id, complaint_id)
    references public.complaints (hostel_id, id),
  constraint complaint_payouts_amount_range check (amount between 1 and 10000000),
  constraint complaint_payouts_mode_valid check (mode in ('cash', 'upi', 'bank_transfer', 'card', 'cheque')),
  constraint complaint_payouts_reference_length check (char_length(btrim(reference)) between 1 and 100)
);

create index complaint_payouts_complaint_idx on public.complaint_payouts (complaint_id);

comment on table public.complaint_payouts is
  'What was paid to vendors for jobs (EP-15 T9). A log only; no money moves through the app.';

alter table public.resident_charges drop constraint resident_charges_category_valid;
alter table public.resident_charges
  add constraint resident_charges_category_valid
    check (category in ('ad_hoc', 'admission', 'electricity', 'cheque_bounce', 'repair'));

-- Records a cost. One the resident pays becomes a charge on their next
-- invoice. Members only.
create or replace function private.complaint_add_cost(
  p_complaint_id uuid,
  p_kind text,
  p_amount integer,
  p_payer text,
  p_description text
)
returns uuid
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  c record;
  v_charge uuid;
  v_id uuid;
begin
  perform private.complaint_member(p_complaint_id);
  select * into c from public.complaints where id = p_complaint_id;
  if p_payer = 'resident' then
    if c.resident_id is null then
      raise exception 'Link the complaint to a resident to charge them'
        using errcode = 'P0001', hint = 'cost_no_resident';
    end if;
    insert into public.resident_charges (hostel_id, resident_id, category, description, amount, charge_date, created_by)
    values (c.hostel_id, c.resident_id, 'repair',
            left('Repair: ' || coalesce(nullif(btrim(p_description), ''), c.title), 200),
            p_amount, private.today_ist(), (select auth.uid()))
    returning id into v_charge;
  end if;
  insert into public.complaint_costs (hostel_id, complaint_id, kind, amount, payer, description, charge_id)
  values (c.hostel_id, c.id, p_kind, p_amount, coalesce(p_payer, 'hostel'), nullif(btrim(p_description), ''), v_charge)
  returning id into v_id;
  perform private.complaint_log(c.id, 'cost', null, null, null,
    replace(p_kind, '_', ' ') || ' ₹' || to_char(p_amount / 100.0, 'FM99999990.00')
      || case when p_payer = 'resident' then ', charged to the resident' else '' end,
    'member');
  return v_id;
end;
$$;

create or replace function private.complaint_void_cost(p_cost_id uuid, p_reason text)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  k record;
begin
  select * into k from public.complaint_costs where id = p_cost_id;
  if not found or k.hostel_id not in (select private.user_owned_hostel_ids()) then
    raise exception 'Cost not found' using errcode = 'P0001', hint = 'cost_not_found';
  end if;
  if k.voided_at is not null then
    raise exception 'This cost is already void' using errcode = 'P0001', hint = 'cost_void';
  end if;
  if nullif(btrim(p_reason), '') is null then
    raise exception 'Say why' using errcode = 'P0001', hint = 'void_reason';
  end if;
  if k.charge_id is not null then
    if exists (select 1 from public.resident_charges rc where rc.id = k.charge_id and rc.invoice_id is not null) then
      raise exception 'The resident was already billed for this; void that invoice first'
        using errcode = 'P0001', hint = 'cost_billed';
    end if;
    update public.resident_charges set void_reason = btrim(p_reason) where id = k.charge_id and voided_at is null;
  end if;
  update public.complaint_costs set voided_at = now(), void_reason = btrim(p_reason) where id = k.id;
  perform private.complaint_log(k.complaint_id, 'cost', null, null, null, 'Cost voided: ' || btrim(p_reason), 'member');
end;
$$;

-- ---------------------------------------------------------------------------
-- Preventive maintenance (T12)
-- ---------------------------------------------------------------------------
create table public.maintenance_schedules (
  id uuid primary key default gen_random_uuid(),
  hostel_id uuid not null references public.hostels (id) on delete cascade,
  title text not null,
  description text,
  category_id uuid not null,
  room_id uuid,
  area text,
  priority text not null default 'normal',
  every_n integer not null,
  unit text not null,
  next_due date not null,
  active boolean not null default true,
  created_at timestamptz not null default now(),

  constraint maintenance_schedules_category_fkey foreign key (hostel_id, category_id)
    references public.complaint_categories (hostel_id, id),
  constraint maintenance_schedules_room_fkey foreign key (hostel_id, room_id)
    references public.rooms (hostel_id, id),
  constraint maintenance_schedules_where check (room_id is not null or area is not null),
  constraint maintenance_schedules_title_length check (char_length(btrim(title)) between 1 and 120),
  constraint maintenance_schedules_description_length check (char_length(description) <= 2000),
  constraint maintenance_schedules_area_length check (char_length(btrim(area)) between 1 and 100),
  constraint maintenance_schedules_priority_valid check (priority in ('low', 'normal', 'high', 'urgent')),
  constraint maintenance_schedules_every_range check (every_n between 1 and 365),
  constraint maintenance_schedules_unit_valid check (unit in ('day', 'week', 'month'))
);

create index maintenance_schedules_due_idx on public.maintenance_schedules (hostel_id, next_due) where active;

alter table public.complaints
  add constraint complaints_schedule_fkey foreign key (schedule_id)
    references public.maintenance_schedules (id) on delete set null;

-- Turns every schedule that is due into a scheduled complaint, once per due
-- date, and moves it to its next date. Returns how many were created.
create or replace function private.create_due_maintenance(p_hostel_id uuid)
returns integer
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  s record;
  created integer := 0;
  v_next date;
begin
  if p_hostel_id is null or p_hostel_id not in (select private.user_hostel_ids()) then
    raise exception 'Hostel not found' using errcode = 'P0001', hint = 'hostel_not_found';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('maintenance:' || p_hostel_id::text, 0));
  for s in
    select * from public.maintenance_schedules m
     where m.hostel_id = p_hostel_id and m.active and m.next_due <= private.today_ist()
  loop
    insert into public.complaints
      (hostel_id, kind, schedule_id, room_id, area, raised_by, raised_by_kind, category_id, priority, title, description)
    values (s.hostel_id, 'scheduled', s.id, s.room_id, s.area, (select auth.uid()), 'schedule',
            s.category_id, s.priority, s.title, s.description);
    v_next := s.next_due;
    while v_next <= private.today_ist() loop
      v_next := (v_next + (s.every_n || ' ' || s.unit)::interval)::date;
    end loop;
    update public.maintenance_schedules set next_due = v_next where id = s.id;
    created := created + 1;
  end loop;
  return created;
end;
$$;

-- complaints_guard_insert forces 'reported' for authenticated callers; a
-- scheduled complaint is created here, as the definer.

-- ---------------------------------------------------------------------------
-- Attachments (T5)
-- ---------------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('complaint-media', 'complaint-media', false, 20971520,
        array['image/jpeg', 'image/png', 'image/webp', 'video/mp4', 'video/webm', 'video/quicktime'])
on conflict (id) do update
  set public = excluded.public,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

create table public.complaint_attachments (
  id uuid primary key default gen_random_uuid(),
  hostel_id uuid not null references public.hostels (id) on delete cascade,
  complaint_id uuid not null,
  path text not null unique,
  mime_type text not null,
  size_bytes integer not null,
  -- 'report' (what is wrong) or 'completion' (the fix).
  stage text not null default 'report',
  uploaded_by uuid references public.profiles (id) on delete set null,
  via_job boolean not null default false,
  created_at timestamptz not null default now(),

  constraint complaint_attachments_complaint_fkey foreign key (hostel_id, complaint_id)
    references public.complaints (hostel_id, id) on delete cascade,
  constraint complaint_attachments_mime_valid check (
    mime_type in ('image/jpeg', 'image/png', 'image/webp', 'video/mp4', 'video/webm', 'video/quicktime')
  ),
  constraint complaint_attachments_size_range check (size_bytes between 1 and 20971520),
  constraint complaint_attachments_stage_valid check (stage in ('report', 'completion')),
  constraint complaint_attachments_path_prefix check (path like hostel_id::text || '/' || complaint_id::text || '/%')
);

create index complaint_attachments_complaint_idx on public.complaint_attachments (complaint_id);

-- Up to 5 photos and 1 video per complaint and stage.
create or replace function private.complaint_attachments_limit()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  perform pg_advisory_xact_lock(hashtextextended('attachments:' || new.complaint_id::text, 0));
  if new.mime_type like 'video/%' then
    if exists (select 1 from public.complaint_attachments a
                where a.complaint_id = new.complaint_id and a.stage = new.stage and a.mime_type like 'video/%') then
      raise exception 'Only one video per complaint' using errcode = 'P0001', hint = 'attachment_limit';
    end if;
  elsif (select count(*) from public.complaint_attachments a
          where a.complaint_id = new.complaint_id and a.stage = new.stage and a.mime_type like 'image/%') >= 5 then
    raise exception 'Up to 5 photos per complaint' using errcode = 'P0001', hint = 'attachment_limit';
  end if;
  if current_user = 'authenticated' then
    new.uploaded_by := (select auth.uid());
    new.via_job := false;
  end if;
  return new;
end;
$$;

create trigger complaint_attachments_limit
  before insert on public.complaint_attachments
  for each row execute function private.complaint_attachments_limit();

create or replace function private.complaint_attachments_log()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.complaint_log(
    new.complaint_id, 'attachment', null, null,
    case when new.via_job then (select c.worker_id from public.complaints c where c.id = new.complaint_id) end,
    case when new.mime_type like 'video/%' then 'Video added' else 'Photo added' end
      || case when new.stage = 'completion' then ' (the fix)' else '' end,
    case when new.via_job then 'worker' else 'member' end);
  return null;
end;
$$;

create trigger complaint_attachments_log
  after insert on public.complaint_attachments
  for each row execute function private.complaint_attachments_log();

create or replace function private.complaint_media_path_allowed(p_name text)
returns boolean
language sql
stable
security invoker
set search_path = ''
as $$
  select exists (
    select 1 from public.complaints c
    where c.hostel_id::text = (storage.foldername(p_name))[1]
      and c.id::text = (storage.foldername(p_name))[2]
      and c.hostel_id in (select private.user_hostel_ids())
  );
$$;

grant execute on function private.complaint_media_path_allowed(text) to authenticated;

create policy "complaint-media: members read"
  on storage.objects for select to authenticated
  using (bucket_id = 'complaint-media' and private.complaint_media_path_allowed(name));

create policy "complaint-media: members upload"
  on storage.objects for insert to authenticated
  with check (bucket_id = 'complaint-media' and private.complaint_media_path_allowed(name));

-- ---------------------------------------------------------------------------
-- Targets and the list (T10, T2)
-- ---------------------------------------------------------------------------
-- Each complaint with its target times. "Late" compares now (or when it
-- happened) with the target, leaving out time on hold.
create view public.complaint_overview with (security_invoker = true) as
select
  c.*,
  cat.name as category_name,
  cat.trade,
  r.room_number,
  r.floor,
  b.bed_label,
  re.full_name as resident_name,
  w.full_name as worker_name,
  w.kind as worker_kind,
  c.hold_seconds + case when c.status = 'on_hold' and c.hold_started_at is not null
    then extract(epoch from now() - c.hold_started_at)::integer else 0 end as held_seconds,
  t.respond_minutes,
  t.resolve_minutes,
  c.created_at + make_interval(mins => t.respond_minutes) as respond_by,
  c.created_at + make_interval(mins => t.resolve_minutes)
    + make_interval(secs => c.hold_seconds + case when c.status = 'on_hold' and c.hold_started_at is not null
        then extract(epoch from now() - c.hold_started_at)::integer else 0 end) as resolve_by,
  c.status not in ('resolved', 'closed') as is_open
from public.complaints c
join public.complaint_categories cat on cat.id = c.category_id
left join public.complaint_targets t on t.hostel_id = c.hostel_id and t.priority = c.priority
left join public.rooms r on r.id = c.room_id
left join public.beds b on b.id = c.bed_id
left join public.residents re on re.id = c.resident_id
left join public.workers w on w.id = c.worker_id;

comment on view public.complaint_overview is
  'Complaints with names and target times (EP-15 T2, T10), for lists and the dashboard.';

-- ---------------------------------------------------------------------------
-- Reports (T11)
-- ---------------------------------------------------------------------------
create or replace function public.complaint_report(p_hostel_id uuid, p_from date, p_to date)
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
  with period as (
    select c.*,
           extract(epoch from c.first_response_at - c.created_at) / 60 as response_minutes,
           extract(epoch from c.resolved_at - c.created_at) / 60 - c.hold_seconds / 60.0 as resolve_minutes
      from public.complaints c
     where c.hostel_id = p_hostel_id
       and (c.created_at at time zone 'Asia/Kolkata')::date between p_from and p_to
  )
  select jsonb_build_object(
    'total', (select count(*) from period),
    'reported', (select count(*) from period where kind = 'reported'),
    'scheduled', (select count(*) from period where kind = 'scheduled'),
    'scheduled_overdue', (select count(*) from period
                           where kind = 'scheduled' and status not in ('resolved', 'closed')
                             and created_at < now() - interval '7 days'),
    'open', (select count(*) from period where status not in ('resolved', 'closed')),
    'avg_response_minutes', (select round(avg(response_minutes)) from period),
    'avg_resolve_minutes', (select round(avg(resolve_minutes)) from period),
    'by_category', coalesce((
      select jsonb_agg(row_to_json(x) order by x.count desc, x.name)
        from (select cat.name, count(*) as count,
                     round(avg(p.response_minutes)) as avg_response_minutes,
                     round(avg(p.resolve_minutes)) as avg_resolve_minutes
                from period p join public.complaint_categories cat on cat.id = p.category_id
               group by cat.name) x), '[]'::jsonb),
    'by_room', coalesce((
      select jsonb_agg(row_to_json(x) order by x.count desc, x.room_number)
        from (select r.room_number, r.floor, count(*) as count
                from period p join public.rooms r on r.id = p.room_id
               group by r.room_number, r.floor) x), '[]'::jsonb),
    'by_floor', coalesce((
      select jsonb_agg(row_to_json(x) order by x.floor)
        from (select r.floor, count(*) as count
                from period p join public.rooms r on r.id = p.room_id
               group by r.floor) x), '[]'::jsonb),
    'repeats', coalesce((
      select jsonb_agg(row_to_json(x) order by x.count desc, x.room_number)
        from (select r.room_number, cat.name as category, count(*) as count
                from period p
                join public.rooms r on r.id = p.room_id
                join public.complaint_categories cat on cat.id = p.category_id
               group by r.room_number, cat.name
              having count(*) >= 2) x), '[]'::jsonb),
    'workers', coalesce((
      select jsonb_agg(row_to_json(x) order by x.jobs desc, x.name)
        from (select w.full_name as name, w.kind,
                     count(*) filter (where p.worker_id = w.id) as jobs,
                     count(*) filter (where p.worker_id = w.id and p.status in ('resolved', 'closed')) as done,
                     round(avg(p.resolve_minutes) filter (where p.worker_id = w.id)) as avg_resolve_minutes,
                     (select count(*) from public.complaint_events e
                       join period q on q.id = e.complaint_id
                      where e.kind = 'declined' and e.worker_id = w.id) as declines
                from public.workers w
                join period p on p.worker_id = w.id
               group by w.id, w.full_name, w.kind) x), '[]'::jsonb),
    'costs', jsonb_build_object(
      'hostel', coalesce((select sum(k.amount) from public.complaint_costs k join period p on p.id = k.complaint_id
                           where k.voided_at is null and k.payer = 'hostel'), 0),
      'resident', coalesce((select sum(k.amount) from public.complaint_costs k join period p on p.id = k.complaint_id
                             where k.voided_at is null and k.payer = 'resident'), 0),
      'by_category', coalesce((
        select jsonb_agg(row_to_json(x) order by x.amount desc)
          from (select cat.name, sum(k.amount) as amount
                  from public.complaint_costs k
                  join period p on p.id = k.complaint_id
                  join public.complaint_categories cat on cat.id = p.category_id
                 where k.voided_at is null
                 group by cat.name) x), '[]'::jsonb)
    )
  )
  where p_hostel_id in (select private.user_hostel_ids());
$$;

revoke all on function public.complaint_report(uuid, date, date) from public, anon;
grant execute on function public.complaint_report(uuid, date, date) to authenticated;

-- ---------------------------------------------------------------------------
-- Public wrappers
-- ---------------------------------------------------------------------------
create or replace function public.complaint_set_status(p_complaint_id uuid, p_status text, p_note text default null)
returns void language sql volatile security invoker set search_path = ''
as $$ select private.complaint_set_status(p_complaint_id, p_status, p_note); $$;

create or replace function public.complaint_assign(p_complaint_id uuid, p_worker_id uuid, p_note text default null)
returns void language sql volatile security invoker set search_path = ''
as $$ select private.complaint_assign(p_complaint_id, p_worker_id, p_note); $$;

create or replace function public.complaint_auto_route(p_complaint_id uuid)
returns uuid language sql volatile security invoker set search_path = ''
as $$ select private.complaint_auto_route(p_complaint_id); $$;

create or replace function public.complaint_comment(p_complaint_id uuid, p_body text)
returns void language sql volatile security invoker set search_path = ''
as $$ select private.complaint_comment(p_complaint_id, p_body); $$;

create or replace function public.complaint_job_link(p_complaint_id uuid)
returns text language sql volatile security invoker set search_path = ''
as $$ select private.complaint_job_link(p_complaint_id); $$;

create or replace function public.complaint_add_cost(
  p_complaint_id uuid, p_kind text, p_amount integer, p_payer text default 'hostel', p_description text default null)
returns uuid language sql volatile security invoker set search_path = ''
as $$ select private.complaint_add_cost(p_complaint_id, p_kind, p_amount, p_payer, p_description); $$;

create or replace function public.complaint_void_cost(p_cost_id uuid, p_reason text)
returns void language sql volatile security invoker set search_path = ''
as $$ select private.complaint_void_cost(p_cost_id, p_reason); $$;

create or replace function public.create_due_maintenance(p_hostel_id uuid)
returns integer language sql volatile security invoker set search_path = ''
as $$ select private.create_due_maintenance(p_hostel_id); $$;

create or replace function public.job_view(p_token text)
returns jsonb language sql stable security invoker set search_path = ''
as $$ select job_link.job_view(p_token); $$;

create or replace function public.job_update(p_token text, p_action text, p_note text default null, p_charge integer default null)
returns text language sql volatile security invoker set search_path = ''
as $$ select job_link.job_update(p_token, p_action, p_note, p_charge); $$;

do $$
declare
  f text;
begin
  foreach f in array array[
    'complaint_set_status(uuid, text, text)',
    'complaint_assign(uuid, uuid, text)',
    'complaint_auto_route(uuid)',
    'complaint_comment(uuid, text)',
    'complaint_job_link(uuid)',
    'complaint_add_cost(uuid, text, integer, text, text)',
    'complaint_void_cost(uuid, text)',
    'create_due_maintenance(uuid)'
  ] loop
    execute format('revoke all on function private.%s from public, anon', f);
    execute format('revoke all on function public.%s from public, anon', f);
    execute format('grant execute on function private.%s to authenticated', f);
    execute format('grant execute on function public.%s to authenticated', f);
  end loop;
  -- Job links are opened by workers with no account.
  foreach f in array array['job_view(text)', 'job_update(text, text, text, integer)'] loop
    execute format('revoke all on function job_link.%s from public', f);
    execute format('revoke all on function public.%s from public', f);
    execute format('grant execute on function job_link.%s to anon, authenticated', f);
    execute format('grant execute on function public.%s to anon, authenticated', f);
  end loop;
end;
$$;

-- ---------------------------------------------------------------------------
-- Privileges and row-level security
-- ---------------------------------------------------------------------------
alter table public.complaint_categories enable row level security;
alter table public.complaint_targets enable row level security;
alter table public.workers enable row level security;
alter table public.worker_unavailability enable row level security;
alter table public.complaints enable row level security;
alter table public.complaint_events enable row level security;
alter table public.complaint_job_tokens enable row level security;
alter table public.complaint_job_hits enable row level security;
alter table public.complaint_costs enable row level security;
alter table public.complaint_payouts enable row level security;
alter table public.maintenance_schedules enable row level security;
alter table public.complaint_attachments enable row level security;

revoke all on public.complaint_categories, public.complaint_targets, public.workers,
  public.worker_unavailability, public.complaints, public.complaint_events,
  public.complaint_job_tokens, public.complaint_job_hits, public.complaint_costs,
  public.complaint_payouts, public.maintenance_schedules, public.complaint_attachments,
  public.complaint_overview
  from authenticated, anon;

grant select on public.complaint_categories, public.complaint_targets, public.workers,
  public.worker_unavailability, public.complaints, public.complaint_events,
  public.complaint_costs, public.complaint_payouts, public.maintenance_schedules,
  public.complaint_attachments, public.complaint_overview
  to authenticated;

-- Members raise complaints; every later change goes through a function.
grant insert (hostel_id, room_id, bed_id, area, resident_id, category_id, priority, title, description)
  on public.complaints to authenticated;
grant insert (hostel_id, complaint_id, path, mime_type, size_bytes, stage) on public.complaint_attachments to authenticated;
-- Owners shape the setup.
grant insert (hostel_id, name, trade, auto_route, position), update (name, trade, auto_route, active, position)
  on public.complaint_categories to authenticated;
grant update (respond_minutes, resolve_minutes) on public.complaint_targets to authenticated;
grant insert (hostel_id, kind, full_name, business_name, phone, trades, call_out_charge, notes, profile_id, preferred),
  update (full_name, business_name, phone, trades, call_out_charge, notes, profile_id, preferred, active)
  on public.workers to authenticated;
grant insert (worker_id, from_date, to_date, reason), delete on public.worker_unavailability to authenticated;
grant insert (hostel_id, complaint_id, worker_id, amount, paid_at, mode, reference) on public.complaint_payouts to authenticated;
grant insert (hostel_id, title, description, category_id, room_id, area, priority, every_n, unit, next_due),
  update (title, description, category_id, room_id, area, priority, every_n, unit, next_due, active)
  on public.maintenance_schedules to authenticated;

create policy "complaint categories: members read" on public.complaint_categories for select to authenticated
  using (hostel_id in (select private.user_hostel_ids()));
create policy "complaint categories: owners add" on public.complaint_categories for insert to authenticated
  with check (hostel_id in (select private.user_owned_hostel_ids()));
create policy "complaint categories: owners change" on public.complaint_categories for update to authenticated
  using (hostel_id in (select private.user_owned_hostel_ids()))
  with check (hostel_id in (select private.user_owned_hostel_ids()));

create policy "complaint targets: members read" on public.complaint_targets for select to authenticated
  using (hostel_id in (select private.user_hostel_ids()));
create policy "complaint targets: owners change" on public.complaint_targets for update to authenticated
  using (hostel_id in (select private.user_owned_hostel_ids()))
  with check (hostel_id in (select private.user_owned_hostel_ids()));

-- Written against the row itself, so an insert can return what it wrote.
create policy "workers: visible" on public.workers for select to authenticated
  using (
    owner_id = (select auth.uid())
    or hostel_id in (select private.user_hostel_ids())
    or (hostel_id is null and owner_id in (
          select h.owner_id from public.hostels h where h.id in (select private.user_hostel_ids())))
  );
create policy "workers: owners add" on public.workers for insert to authenticated
  with check (owner_id = (select auth.uid()));
create policy "workers: owners change" on public.workers for update to authenticated
  using (owner_id = (select auth.uid())) with check (owner_id = (select auth.uid()));

create policy "worker time off: visible" on public.worker_unavailability for select to authenticated
  using (worker_id in (select private.visible_worker_ids()));
create policy "worker time off: owners add" on public.worker_unavailability for insert to authenticated
  with check (worker_id in (select w.id from public.workers w where w.owner_id = (select auth.uid())));
create policy "worker time off: owners remove" on public.worker_unavailability for delete to authenticated
  using (worker_id in (select w.id from public.workers w where w.owner_id = (select auth.uid())));

create policy "complaints: members read" on public.complaints for select to authenticated
  using (hostel_id in (select private.user_hostel_ids()));
create policy "complaints: members raise" on public.complaints for insert to authenticated
  with check (hostel_id in (select private.user_hostel_ids()));

create policy "complaint events: members read" on public.complaint_events for select to authenticated
  using (hostel_id in (select private.user_hostel_ids()));

create policy "complaint costs: members read" on public.complaint_costs for select to authenticated
  using (hostel_id in (select private.user_hostel_ids()));

create policy "complaint payouts: members read" on public.complaint_payouts for select to authenticated
  using (hostel_id in (select private.user_hostel_ids()));
create policy "complaint payouts: owners record" on public.complaint_payouts for insert to authenticated
  with check (hostel_id in (select private.user_owned_hostel_ids()) and recorded_by = (select auth.uid()));

create policy "maintenance schedules: members read" on public.maintenance_schedules for select to authenticated
  using (hostel_id in (select private.user_hostel_ids()));
create policy "maintenance schedules: owners add" on public.maintenance_schedules for insert to authenticated
  with check (hostel_id in (select private.user_owned_hostel_ids()));
create policy "maintenance schedules: owners change" on public.maintenance_schedules for update to authenticated
  using (hostel_id in (select private.user_owned_hostel_ids()))
  with check (hostel_id in (select private.user_owned_hostel_ids()));

create policy "complaint attachments: members read" on public.complaint_attachments for select to authenticated
  using (hostel_id in (select private.user_hostel_ids()));
create policy "complaint attachments: members add" on public.complaint_attachments for insert to authenticated
  with check (hostel_id in (select private.user_hostel_ids()));
