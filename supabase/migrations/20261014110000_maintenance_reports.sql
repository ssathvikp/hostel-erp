-- Recurring preventive maintenance and complaint reports (E15-T12, E15-T11).
--
-- A maintenance schedule (water tank cleaning every 3 months, pest control
-- every month) turns into a complaint of kind 'scheduled' when it falls due,
-- and goes through the same routing as any other complaint. A daily job
-- creates them; owners can also run it for their hostel at once.
--
-- complaints_report and complaints_csv return one value each, like the fee
-- reports, so nothing is cut at the API's 1000-row limit.

-- ---------------------------------------------------------------------------
-- Schedules
-- ---------------------------------------------------------------------------
create table public.maintenance_schedules (
  id uuid primary key default gen_random_uuid(),
  hostel_id uuid not null references public.hostels (id) on delete cascade,
  title text not null,
  description text,
  category_id uuid not null,
  room_id uuid,
  area text,
  every integer not null,
  unit text not null,
  next_due date not null,
  priority text not null default 'normal',
  active boolean not null default true,
  created_by uuid default auth.uid() references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint maintenance_schedules_hostel_id_id_key unique (hostel_id, id),
  constraint maintenance_schedules_category_fkey foreign key (hostel_id, category_id)
    references public.complaint_categories (hostel_id, id),
  constraint maintenance_schedules_room_fkey foreign key (hostel_id, room_id)
    references public.rooms (hostel_id, id),
  constraint maintenance_schedules_where check (room_id is not null or area is not null),
  constraint maintenance_schedules_title_length check (char_length(btrim(title)) between 1 and 120),
  constraint maintenance_schedules_description_length check (char_length(btrim(description)) between 1 and 2000),
  constraint maintenance_schedules_area_length check (char_length(btrim(area)) between 1 and 100),
  constraint maintenance_schedules_every_range check (every between 1 and 365),
  constraint maintenance_schedules_unit_valid check (unit in ('day', 'week', 'month')),
  constraint maintenance_schedules_priority_valid check (priority in ('low', 'normal', 'high', 'urgent'))
);

comment on table public.maintenance_schedules is
  'Predictable work that becomes a scheduled complaint each time it falls due.';

create trigger maintenance_schedules_set_updated_at
  before update on public.maintenance_schedules
  for each row execute function private.set_updated_at();

alter table public.complaints add column schedule_id uuid;
alter table public.complaints add constraint complaints_schedule_fkey
  foreign key (hostel_id, schedule_id) references public.maintenance_schedules (hostel_id, id);

-- Creates a complaint for every schedule that has fallen due, and moves the
-- schedule to its next date after today. For one hostel, or every hostel.
create or replace function private.create_due_maintenance(p_hostel_id uuid default null)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  s record;
  complaint uuid;
  next_date date;
  created integer := 0;
  step interval;
begin
  for s in
    select * from public.maintenance_schedules m
     where m.active and m.next_due <= private.today_ist()
       and (p_hostel_id is null or m.hostel_id = p_hostel_id)
     order by m.next_due
     for update skip locked
  loop
    complaint := private.raise_complaint(s.hostel_id, s.category_id, s.title, s.description,
                                         s.priority, s.room_id, null, s.area, null, false, 'scheduled');
    update public.complaints set schedule_id = s.id where id = complaint;
    step := make_interval(
      days => case s.unit when 'day' then s.every when 'week' then s.every * 7 else 0 end,
      months => case s.unit when 'month' then s.every else 0 end
    );
    next_date := s.next_due;
    while next_date <= private.today_ist() loop
      next_date := (next_date + step)::date;
    end loop;
    update public.maintenance_schedules set next_due = next_date where id = s.id;
    created := created + 1;
  end loop;
  return created;
end;
$$;

-- Owners run it for their hostel now.
create or replace function public.create_due_maintenance(p_hostel_id uuid)
returns integer
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if p_hostel_id is null or p_hostel_id not in (select private.user_owned_hostel_ids()) then
    raise exception 'You do not have permission to do that' using errcode = '42501';
  end if;
  return private.create_due_maintenance(p_hostel_id);
end;
$$;

select cron.schedule('create-due-maintenance', '30 0 * * *', $$select private.create_due_maintenance()$$);

-- ---------------------------------------------------------------------------
-- Reports
-- ---------------------------------------------------------------------------
-- Complaints raised in a range: by category, room and floor with average
-- times, rooms with the same problem again, how each worker did, what the
-- repairs cost, and scheduled work kept apart from complaints.
create or replace function public.complaints_report(p_hostel_id uuid, p_from date, p_to date)
returns jsonb
language plpgsql
stable
security invoker
set search_path = ''
as $$
begin
  perform private.require_hostel_member(p_hostel_id);
  if p_from is null or p_to is null or p_from > p_to then
    raise exception 'The start date must be on or before the end date'
      using errcode = 'P0001', hint = 'range_reversed';
  end if;
  if p_to - p_from > 731 then
    raise exception 'Choose a range of two years or less' using errcode = 'P0001', hint = 'range_too_long';
  end if;
  return private.complaints_report(p_hostel_id, p_from, p_to);
end;
$$;

create or replace function private.complaints_report(p_hostel_id uuid, p_from date, p_to date)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  with c as (
    select l.*,
           extract(epoch from l.responded_at - l.created_at) / 3600.0 as response_hours,
           extract(epoch from l.resolved_at - l.created_at) / 3600.0 as resolution_hours
      from public.complaint_list l
     where l.hostel_id = p_hostel_id
       and (l.created_at at time zone 'Asia/Kolkata')::date between p_from and p_to
  ),
  complaints_only as (select * from c where kind = 'complaint')
  select jsonb_build_object(
    'total', (select count(*) from complaints_only),
    'open', (select count(*) from complaints_only where status not in ('resolved', 'closed')),
    'overdue', (select count(*) from complaints_only where target_state = 'overdue'),
    'avg_response_hours', (select round(avg(response_hours)::numeric, 1) from complaints_only),
    'avg_resolution_hours', (select round(avg(resolution_hours)::numeric, 1) from complaints_only),
    'by_category', coalesce((
      select jsonb_agg(row_to_json(x) order by x.count desc, x.category)
        from (select category_name as category, count(*) as count,
                     count(*) filter (where status not in ('resolved', 'closed')) as open,
                     round(avg(response_hours)::numeric, 1) as avg_response_hours,
                     round(avg(resolution_hours)::numeric, 1) as avg_resolution_hours
                from complaints_only group by category_name) x
    ), '[]'::jsonb),
    'by_floor', coalesce((
      select jsonb_agg(row_to_json(x) order by x.floor)
        from (select floor, count(*) as count from complaints_only
               where floor is not null group by floor) x
    ), '[]'::jsonb),
    'by_room', coalesce((
      select jsonb_agg(row_to_json(x) order by x.count desc, x.room_number)
        from (select room_id, room_number, count(*) as count from complaints_only
               where room_id is not null group by room_id, room_number
               order by count(*) desc, room_number limit 20) x
    ), '[]'::jsonb),
    -- The same kind of problem in the same room more than once.
    'repeat_rooms', coalesce((
      select jsonb_agg(row_to_json(x) order by x.count desc, x.room_number)
        from (select room_id, room_number, category_name as category, count(*) as count
                from complaints_only where room_id is not null
               group by room_id, room_number, category_name having count(*) > 1) x
    ), '[]'::jsonb),
    'workers', coalesce((
      select jsonb_agg(row_to_json(x) order by x.jobs_done desc, x.name)
        from (select w.name, w.kind,
                     (select count(*) from c where c.worker_id = w.id
                        and c.status in ('resolved', 'closed')) as jobs_done,
                     (select count(*) from c where c.worker_id = w.id
                        and c.status not in ('resolved', 'closed')) as open,
                     (select round(avg(c.resolution_hours)::numeric, 1) from c
                       where c.worker_id = w.id) as avg_resolution_hours,
                     (select count(*) from public.complaint_events e
                        join c on c.id = e.complaint_id
                       where e.kind = 'declined' and e.worker_id = w.id) as declines
                from public.workers w
                join public.worker_hostels wh on wh.worker_id = w.id and wh.hostel_id = p_hostel_id) x
    ), '[]'::jsonb),
    'spend', jsonb_build_object(
      'total', (select coalesce(sum(total_cost), 0) from c),
      'charged_to_residents', (select coalesce(sum(total_cost), 0) from c where payer = 'resident'),
      'paid_to_workers', (
        select coalesce(sum(p.amount), 0) from public.vendor_payouts p
         where p.hostel_id = p_hostel_id and p.paid_at between p_from and p_to
      ),
      'by_category', coalesce((
        select jsonb_agg(row_to_json(x) order by x.amount desc)
          from (select category_name as category, sum(total_cost) as amount from c
                 where total_cost > 0 group by category_name) x
      ), '[]'::jsonb),
      'by_month', coalesce((
        select jsonb_agg(row_to_json(x) order by x.month)
          from (select to_char(created_at at time zone 'Asia/Kolkata', 'YYYY-MM') as month,
                       sum(total_cost) as amount
                  from c where total_cost > 0 group by 1) x
      ), '[]'::jsonb)
    ),
    'scheduled', jsonb_build_object(
      'total', (select count(*) from c where kind = 'scheduled'),
      'done', (select count(*) from c where kind = 'scheduled' and status in ('resolved', 'closed')),
      'overdue', (select count(*) from c where kind = 'scheduled' and target_state = 'overdue')
    )
  );
$$;

-- Every complaint raised in the range, one row each.
create or replace function public.complaints_csv(p_hostel_id uuid, p_from date, p_to date)
returns text
language plpgsql
stable
security invoker
set search_path = ''
as $$
begin
  perform private.require_hostel_member(p_hostel_id);
  if p_from is null or p_to is null or p_from > p_to then
    raise exception 'The start date must be on or before the end date'
      using errcode = 'P0001', hint = 'range_reversed';
  end if;
  return private.complaints_csv(p_hostel_id, p_from, p_to);
end;
$$;

create or replace function private.complaints_csv(p_hostel_id uuid, p_from date, p_to date)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select 'Number,Raised,Kind,Category,Priority,Status,Room,Area,Title,Worker,Responded,Resolved,Target,Cost (INR),Paid by' || E'\n'
    || coalesce(string_agg(
         concat_ws(',',
           l.number::text,
           to_char(l.created_at at time zone 'Asia/Kolkata', 'YYYY-MM-DD HH24:MI'),
           private.csv_field(l.kind),
           private.csv_field(l.category_name),
           private.csv_field(l.priority),
           private.csv_field(l.status),
           private.csv_field(l.room_number),
           private.csv_field(l.area),
           private.csv_field(l.title),
           private.csv_field(l.worker_name),
           coalesce(to_char(l.responded_at at time zone 'Asia/Kolkata', 'YYYY-MM-DD HH24:MI'), ''),
           coalesce(to_char(l.resolved_at at time zone 'Asia/Kolkata', 'YYYY-MM-DD HH24:MI'), ''),
           private.csv_field(l.target_state),
           private.csv_rupees(l.total_cost),
           private.csv_field(l.payer)
         ),
         E'\n' order by l.number
       ) || E'\n', '')
    from public.complaint_list l
   where l.hostel_id = p_hostel_id
     and (l.created_at at time zone 'Asia/Kolkata')::date between p_from and p_to;
$$;

-- ---------------------------------------------------------------------------
-- Privileges and row-level security
-- ---------------------------------------------------------------------------
alter table public.maintenance_schedules enable row level security;
revoke all on public.maintenance_schedules from authenticated, anon;
grant select on public.maintenance_schedules to authenticated;
grant insert (hostel_id, title, description, category_id, room_id, area, every, unit, next_due, priority)
  on public.maintenance_schedules to authenticated;
grant update (title, description, category_id, room_id, area, every, unit, next_due, priority, active)
  on public.maintenance_schedules to authenticated;
grant delete on public.maintenance_schedules to authenticated;

create policy "maintenance schedules: members read"
  on public.maintenance_schedules for select to authenticated
  using (hostel_id in (select private.user_hostel_ids()));
create policy "maintenance schedules: owners write"
  on public.maintenance_schedules for all to authenticated
  using (hostel_id in (select private.user_owned_hostel_ids()))
  with check (hostel_id in (select private.user_owned_hostel_ids()));

revoke all on function private.create_due_maintenance(uuid),
  private.complaints_report(uuid, date, date),
  private.complaints_csv(uuid, date, date) from public;
grant execute on function private.create_due_maintenance(uuid),
  private.complaints_report(uuid, date, date),
  private.complaints_csv(uuid, date, date) to authenticated, service_role;

revoke execute on function public.create_due_maintenance(uuid),
  public.complaints_report(uuid, date, date),
  public.complaints_csv(uuid, date, date) from public, anon;
grant execute on function public.create_due_maintenance(uuid),
  public.complaints_report(uuid, date, date),
  public.complaints_csv(uuid, date, date) to authenticated;
