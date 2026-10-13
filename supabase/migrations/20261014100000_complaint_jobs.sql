-- Complaint attachments, job links for outside workers, and repair costs
-- (E15-T5, E15-T8, E15-T9).
--
-- Attachments live in the private complaint-files bucket at
-- <hostel>/<complaint>/<file>, served only through short-lived signed URLs.
-- Members upload through storage policies; a worker's completion photos are
-- uploaded by the server after the job link has been checked.
--
-- A job link lets one worker see and update one job without an account.
-- The link carries a random token; only its SHA-256 hash is stored. It stops
-- working when the job is reassigned or closed, or a new link replaces it.
-- Every job-link function takes the token and does nothing for a token that
-- is unknown, replaced or expired. The worker's page is served by the app,
-- which calls these functions with the service role; signed-out visitors
-- cannot call them directly, so the app can rate-limit every request.
--
-- Costs: labour, materials and the vendor's charge are recorded on the
-- complaint. When the resident pays, the total becomes a pending charge
-- (E13-T2) on their next invoice. Money paid to vendors is a payout log.

-- ---------------------------------------------------------------------------
-- Attachments
-- ---------------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('complaint-files', 'complaint-files', false, 20971520,
        array['image/jpeg', 'image/png', 'image/webp', 'video/mp4', 'video/quicktime'])
on conflict (id) do update
  set public = excluded.public,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

create table public.complaint_attachments (
  id uuid primary key default gen_random_uuid(),
  hostel_id uuid not null,
  complaint_id uuid not null,
  path text not null unique,
  kind text not null,
  -- member: an owner or staff member; worker: through the job link.
  source text not null,
  uploaded_by uuid default auth.uid() references public.profiles (id) on delete set null,
  uploaded_by_name text not null,
  created_at timestamptz not null default now(),

  constraint complaint_attachments_complaint_fkey foreign key (hostel_id, complaint_id)
    references public.complaints (hostel_id, id) on delete cascade,
  constraint complaint_attachments_kind_valid check (kind in ('photo', 'video')),
  constraint complaint_attachments_source_valid check (source in ('member', 'worker')),
  constraint complaint_attachments_path_format check (
    path like hostel_id::text || '/' || complaint_id::text || '/%'
  )
);

create index complaint_attachments_complaint_idx on public.complaint_attachments (complaint_id, created_at);

-- Up to 5 photos and 1 video from members; up to 5 completion photos from
-- the worker.
create or replace function private.complaint_attachments_limit()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  same integer;
begin
  perform pg_advisory_xact_lock(hashtextextended('complaint_files:' || new.complaint_id::text, 0));
  select count(*) into same from public.complaint_attachments a
   where a.complaint_id = new.complaint_id and a.source = new.source and a.kind = new.kind;
  if (new.kind = 'photo' and same >= 5) or (new.kind = 'video' and (same >= 1 or new.source = 'worker')) then
    raise exception 'This complaint already has as many % as it can take',
      case new.kind when 'photo' then 'photos' else 'videos' end
      using errcode = 'P0001', hint = 'attachment_limit';
  end if;
  return new;
end;
$$;

create trigger complaint_attachments_limit
  before insert on public.complaint_attachments
  for each row execute function private.complaint_attachments_limit();

-- The first folder must be a hostel the user belongs to, the second one of
-- its complaints.
create or replace function private.complaint_file_allowed(p_name text)
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

grant execute on function private.complaint_file_allowed(text) to authenticated;

create policy "complaint-files: members read"
  on storage.objects for select to authenticated
  using (bucket_id = 'complaint-files' and private.complaint_file_allowed(name));
create policy "complaint-files: members upload"
  on storage.objects for insert to authenticated
  with check (bucket_id = 'complaint-files' and private.complaint_file_allowed(name));
create policy "complaint-files: members delete"
  on storage.objects for delete to authenticated
  using (bucket_id = 'complaint-files' and private.complaint_file_allowed(name));

-- Records a file a member uploaded. Owners and staff.
create or replace function public.add_complaint_attachment(
  p_complaint_id uuid,
  p_path text,
  p_kind text
)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
begin
  perform private.require_complaint_access(p_complaint_id, false);
  return private.add_complaint_attachment(p_complaint_id, p_path, p_kind, 'member', null);
end;
$$;

create or replace function private.add_complaint_attachment(
  p_complaint_id uuid,
  p_path text,
  p_kind text,
  p_source text,
  p_actor text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  hostel uuid;
  attachment uuid;
begin
  select c.hostel_id into hostel from public.complaints c where c.id = p_complaint_id;
  insert into public.complaint_attachments
    (hostel_id, complaint_id, path, kind, source, uploaded_by, uploaded_by_name)
  values (hostel, p_complaint_id, p_path, p_kind, p_source, auth.uid(),
          coalesce(p_actor, private.actor_name()))
  returning id into attachment;
  perform private.log_complaint(p_complaint_id, 'attachment',
    case p_kind when 'photo' then 'Added a photo' else 'Added a video' end,
    p_actor_name => p_actor);
  return attachment;
end;
$$;

-- ---------------------------------------------------------------------------
-- Job links
-- ---------------------------------------------------------------------------
create table public.complaint_job_links (
  id uuid primary key default gen_random_uuid(),
  hostel_id uuid not null,
  complaint_id uuid not null,
  worker_id uuid not null references public.workers (id) on delete cascade,
  token_hash text not null unique,
  created_by uuid default auth.uid() references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  revoked_at timestamptz,
  accepted_at timestamptz,
  last_seen_at timestamptz,

  constraint complaint_job_links_complaint_fkey foreign key (hostel_id, complaint_id)
    references public.complaints (hostel_id, id) on delete cascade
);

create unique index complaint_job_links_one_live
  on public.complaint_job_links (complaint_id) where revoked_at is null;

create or replace function private.hash_token(p_token text)
returns text
language sql
immutable
set search_path = ''
as $$
  select encode(extensions.digest(convert_to(p_token, 'UTF8'), 'sha256'), 'hex');
$$;

-- A new link for the complaint's worker, replacing any earlier one. Returns
-- the token, which is never stored and cannot be shown again. Owners and staff.
create or replace function public.create_job_link(p_complaint_id uuid)
returns text
language plpgsql
security invoker
set search_path = ''
as $$
begin
  perform private.require_complaint_access(p_complaint_id, false);
  return private.create_job_link(p_complaint_id);
end;
$$;

create or replace function private.create_job_link(p_complaint_id uuid)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  c record;
  token text := encode(extensions.gen_random_bytes(24), 'hex');
begin
  select cm.hostel_id, cm.worker_id, cm.status into c
    from public.complaints cm where cm.id = p_complaint_id for update;
  if c.worker_id is null then
    raise exception 'Assign a worker first' using errcode = 'P0001', hint = 'job_link_no_worker';
  end if;
  if c.status in ('resolved', 'closed') then
    raise exception 'This job is finished' using errcode = 'P0001', hint = 'complaint_finished';
  end if;
  update public.complaint_job_links set revoked_at = now()
   where complaint_id = p_complaint_id and revoked_at is null;
  insert into public.complaint_job_links (hostel_id, complaint_id, worker_id, token_hash)
  values (c.hostel_id, p_complaint_id, c.worker_id, private.hash_token(token));
  perform private.log_complaint(p_complaint_id, 'job_link', 'Shared a job link', p_worker_id => c.worker_id);
  return token;
end;
$$;

-- A reassigned or closed job ends its link.
create or replace function private.complaints_revoke_job_links()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.worker_id is distinct from old.worker_id or new.status = 'closed' then
    update public.complaint_job_links set revoked_at = now()
     where complaint_id = new.id and revoked_at is null;
  end if;
  return null;
end;
$$;

create trigger complaints_revoke_job_links
  after update of worker_id, status on public.complaints
  for each row execute function private.complaints_revoke_job_links();

-- The live link for a token, or null.
create or replace function private.job_link(p_token text)
returns public.complaint_job_links
language sql
stable
security definer
set search_path = ''
as $$
  select l.* from public.complaint_job_links l
   where l.token_hash = private.hash_token(coalesce(p_token, '')) and l.revoked_at is null;
$$;

-- Everything a worker needs about their job, or null for a dead token.
create or replace function private.job_view(p_token text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  link public.complaint_job_links;
  result jsonb;
begin
  link := private.job_link(p_token);
  if link.id is null then
    return null;
  end if;
  update public.complaint_job_links set last_seen_at = now() where id = link.id;

  select jsonb_build_object(
    'complaint_id', c.id,
    'hostel_id', c.hostel_id,
    'number', c.number,
    'title', c.title,
    'description', c.description,
    'priority', c.priority,
    'status', c.status,
    'category', cat.name,
    'area', c.area,
    'room_number', rm.room_number,
    'floor', rm.floor,
    'bed_label', b.bed_label,
    'hostel_name', h.name,
    'hostel_address', concat_ws(', ', h.address, h.city, h.state, h.pincode),
    'hostel_phone', h.phone,
    'resident_name', case when c.share_resident_phone then r.full_name end,
    'resident_phone', case when c.share_resident_phone then r.phone end,
    'worker_name', w.name,
    'accepted', link.accepted_at is not null,
    'vendor_charge', c.vendor_charge,
    'attachments', coalesce((
      select jsonb_agg(jsonb_build_object('id', a.id, 'path', a.path, 'kind', a.kind,
                                          'source', a.source) order by a.created_at)
        from public.complaint_attachments a where a.complaint_id = c.id
    ), '[]'::jsonb)
  ) into result
  from public.complaints c
  join public.complaint_categories cat on cat.id = c.category_id
  join public.hostels h on h.id = c.hostel_id
  join public.workers w on w.id = link.worker_id
  left join public.rooms rm on rm.id = c.room_id
  left join public.beds b on b.id = c.bed_id
  left join public.residents r on r.id = c.resident_id
  where c.id = link.complaint_id;
  return result;
end;
$$;

-- What a worker does from their link: accept, decline (with a reason),
-- on_the_way, start, or done (with a note and their charge).
create or replace function private.job_act(
  p_token text,
  p_action text,
  p_note text default null,
  p_charge integer default null
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  link public.complaint_job_links;
  c record;
  actor text;
begin
  link := private.job_link(p_token);
  if link.id is null then
    raise exception 'This job link no longer works' using errcode = 'P0001', hint = 'job_link_dead';
  end if;
  select cm.id, cm.status, cm.vendor_charge into c
    from public.complaints cm where cm.id = link.complaint_id for update;
  actor := (select w.name from public.workers w where w.id = link.worker_id) || ' (job link)';

  if p_action = 'accept' then
    update public.complaint_job_links set accepted_at = coalesce(accepted_at, now()) where id = link.id;
    update public.complaints set responded_at = coalesce(responded_at, now()) where id = c.id;
    perform private.log_complaint(c.id, 'accepted', p_note, p_worker_id => link.worker_id,
                                  p_actor_name => actor);
  elsif p_action = 'decline' then
    if nullif(btrim(p_note), '') is null then
      raise exception 'Give a reason' using errcode = 'P0001', hint = 'reason_required';
    end if;
    perform private.log_complaint(c.id, 'declined', p_note, p_worker_id => link.worker_id,
                                  p_actor_name => actor);
    perform private.assign_complaint(c.id, null, actor);
    perform private.route_complaint(c.id);
  elsif p_action = 'on_the_way' then
    perform private.log_complaint(c.id, 'comment', coalesce(nullif(btrim(p_note), ''), 'On the way'),
                                  p_worker_id => link.worker_id, p_actor_name => actor);
  elsif p_action = 'start' then
    update public.complaint_job_links set accepted_at = coalesce(accepted_at, now()) where id = link.id;
    if c.status <> 'in_progress' then
      perform private.set_complaint_status(c.id, 'in_progress', p_note, actor);
    end if;
  elsif p_action = 'done' then
    if p_charge is not null then
      if p_charge < 0 or p_charge > 10000000 then
        raise exception 'Enter your charge in rupees' using errcode = 'P0001', hint = 'payment_amount';
      end if;
      update public.complaints set vendor_charge = p_charge where id = c.id;
      perform private.log_complaint(c.id, 'cost', 'Charge entered: ₹' || to_char(p_charge / 100.0, 'FM99999990.00'),
                                    p_worker_id => link.worker_id, p_actor_name => actor);
    end if;
    perform private.set_complaint_status(c.id, 'resolved', p_note, actor);
  else
    raise exception 'Unknown action' using errcode = 'P0001', hint = 'job_action';
  end if;
  return p_action;
end;
$$;

-- Records a completion photo the server uploaded for a worker. The path
-- must sit in the job's own folder.
create or replace function private.job_add_attachment(p_token text, p_path text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  link public.complaint_job_links;
begin
  link := private.job_link(p_token);
  if link.id is null then
    raise exception 'This job link no longer works' using errcode = 'P0001', hint = 'job_link_dead';
  end if;
  if p_path not like link.hostel_id::text || '/' || link.complaint_id::text || '/%' then
    raise exception 'Not this job''s file' using errcode = '42501';
  end if;
  return private.add_complaint_attachment(
    link.complaint_id, p_path, 'photo', 'worker',
    (select w.name from public.workers w where w.id = link.worker_id) || ' (job link)'
  );
end;
$$;

-- The app's entry points for the job page. Service role only.
create or replace function public.job_view(p_token text)
returns jsonb
language sql
security invoker
set search_path = ''
as $$
  select private.job_view(p_token);
$$;

create or replace function public.job_act(
  p_token text,
  p_action text,
  p_note text default null,
  p_charge integer default null
)
returns text
language sql
security invoker
set search_path = ''
as $$
  select private.job_act(p_token, p_action, p_note, p_charge);
$$;

create or replace function public.job_add_attachment(p_token text, p_path text)
returns uuid
language sql
security invoker
set search_path = ''
as $$
  select private.job_add_attachment(p_token, p_path);
$$;

-- ---------------------------------------------------------------------------
-- Costs
-- ---------------------------------------------------------------------------
alter table public.complaints
  add column labour_cost integer not null default 0,
  add column material_cost integer not null default 0,
  add column vendor_charge integer not null default 0,
  add column payer text not null default 'hostel',
  add column charge_resident_id uuid,
  add column resident_charge_id uuid,
  add constraint complaints_costs_range check (
    labour_cost between 0 and 10000000 and material_cost between 0 and 10000000
    and vendor_charge between 0 and 10000000
  ),
  add constraint complaints_payer_valid check (payer in ('hostel', 'resident')),
  add constraint complaints_resident_pays_names_resident check ((payer = 'resident') = (charge_resident_id is not null)),
  add constraint complaints_charge_resident_fkey foreign key (hostel_id, charge_resident_id)
    references public.residents (hostel_id, id),
  add constraint complaints_resident_charge_fkey foreign key (hostel_id, resident_charge_id)
    references public.resident_charges (hostel_id, id);

-- Records the repair's costs and who pays. When the resident pays, the
-- total is a pending charge on their next invoice; changing it replaces
-- the charge, until it has been billed. Owners only.
create or replace function public.set_complaint_costs(
  p_complaint_id uuid,
  p_labour integer,
  p_material integer,
  p_vendor_charge integer,
  p_payer text,
  p_resident_id uuid default null
)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
begin
  perform private.require_complaint_access(p_complaint_id, true);
  perform private.set_complaint_costs(p_complaint_id, p_labour, p_material, p_vendor_charge,
                                      p_payer, p_resident_id);
end;
$$;

create or replace function private.set_complaint_costs(
  p_complaint_id uuid,
  p_labour integer,
  p_material integer,
  p_vendor_charge integer,
  p_payer text,
  p_resident_id uuid
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  c record;
  charge record;
  total integer := coalesce(p_labour, 0) + coalesce(p_material, 0) + coalesce(p_vendor_charge, 0);
  resident uuid;
  new_charge uuid;
begin
  select cm.* into c from public.complaints cm where cm.id = p_complaint_id for update;
  resident := case when p_payer = 'resident' then coalesce(p_resident_id, c.resident_id) end;
  if p_payer = 'resident' and resident is null then
    raise exception 'Choose the resident who pays' using errcode = 'P0001', hint = 'complaint_payer';
  end if;
  if p_payer = 'resident' and total = 0 then
    raise exception 'Enter what the repair cost before charging the resident'
      using errcode = 'P0001', hint = 'complaint_cost_zero';
  end if;

  select rc.id, rc.status, rc.amount, rc.resident_id into charge
    from public.resident_charges rc where rc.id = c.resident_charge_id;
  if charge.id is not null and charge.status = 'invoiced'
     and (p_payer <> 'resident' or resident <> charge.resident_id or total <> charge.amount) then
    raise exception 'The resident has already been billed for this repair'
      using errcode = 'P0001', hint = 'complaint_cost_billed';
  end if;

  new_charge := case when charge.status = 'invoiced' then charge.id end;
  if charge.id is not null and charge.status = 'pending'
     and (p_payer <> 'resident' or resident <> charge.resident_id or total <> charge.amount) then
    update public.resident_charges set status = 'void', void_reason = 'Repair cost changed'
     where id = charge.id;
  elsif charge.id is not null and charge.status = 'pending' then
    new_charge := charge.id;
  end if;
  if p_payer = 'resident' and new_charge is null then
    insert into public.resident_charges (hostel_id, resident_id, description, amount, charge_date)
    values (c.hostel_id, resident, left('Repair: ' || c.title || ' (complaint #' || c.number || ')', 200),
            total, private.today_ist())
    returning id into new_charge;
  end if;

  update public.complaints
     set labour_cost = coalesce(p_labour, 0),
         material_cost = coalesce(p_material, 0),
         vendor_charge = coalesce(p_vendor_charge, 0),
         payer = p_payer,
         charge_resident_id = resident,
         resident_charge_id = new_charge
   where id = p_complaint_id;
  perform private.log_complaint(p_complaint_id, 'cost',
    'Costs: ₹' || to_char(total / 100.0, 'FM99999990.00')
      || case when p_payer = 'resident' then ', charged to the resident' else ', paid by the hostel' end);
end;
$$;

create table public.vendor_payouts (
  id uuid primary key default gen_random_uuid(),
  hostel_id uuid not null,
  complaint_id uuid not null,
  worker_id uuid not null references public.workers (id),
  amount integer not null,
  paid_at date not null,
  mode text not null,
  reference text,
  recorded_by uuid default auth.uid() references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),

  constraint vendor_payouts_complaint_fkey foreign key (hostel_id, complaint_id)
    references public.complaints (hostel_id, id) on delete cascade,
  constraint vendor_payouts_amount_range check (amount between 1 and 10000000),
  constraint vendor_payouts_mode_valid check (mode in ('cash', 'upi', 'bank_transfer', 'cheque')),
  constraint vendor_payouts_reference_length check (char_length(btrim(reference)) between 1 and 100)
);

comment on table public.vendor_payouts is
  'Money paid to a worker for a job. A log only; no money moves through the app.';

create index vendor_payouts_complaint_idx on public.vendor_payouts (complaint_id);
create index vendor_payouts_hostel_paid_idx on public.vendor_payouts (hostel_id, paid_at);

-- Money paid to the job's worker. Owners only.
create or replace function public.record_vendor_payout(
  p_complaint_id uuid,
  p_amount integer,
  p_paid_at date,
  p_mode text,
  p_reference text default null
)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
begin
  perform private.require_complaint_access(p_complaint_id, true);
  return private.record_vendor_payout(p_complaint_id, p_amount, p_paid_at, p_mode, p_reference);
end;
$$;

create or replace function private.record_vendor_payout(
  p_complaint_id uuid,
  p_amount integer,
  p_paid_at date,
  p_mode text,
  p_reference text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  c record;
  payout uuid;
begin
  select cm.hostel_id, cm.worker_id into c from public.complaints cm where cm.id = p_complaint_id;
  if c.worker_id is null then
    raise exception 'Assign a worker first' using errcode = 'P0001', hint = 'job_link_no_worker';
  end if;
  if p_paid_at is null or p_paid_at > private.today_ist() then
    raise exception 'A payment date cannot be in the future'
      using errcode = 'P0001', hint = 'payment_future';
  end if;
  insert into public.vendor_payouts (hostel_id, complaint_id, worker_id, amount, paid_at, mode, reference)
  values (c.hostel_id, p_complaint_id, c.worker_id, p_amount, p_paid_at, p_mode,
          nullif(btrim(p_reference), ''))
  returning id into payout;
  perform private.log_complaint(p_complaint_id, 'cost',
    'Paid ₹' || to_char(p_amount / 100.0, 'FM99999990.00') || ' to the worker by ' || replace(p_mode, '_', ' '),
    p_worker_id => c.worker_id);
  return payout;
end;
$$;

-- complaint_list gains the cost total, after the existing columns.
create or replace view public.complaint_list with (security_invoker = true) as
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
  end as target_state,
  (c.labour_cost + c.material_cost + c.vendor_charge) as total_cost,
  c.payer
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
-- Privileges and row-level security
-- ---------------------------------------------------------------------------
alter table public.complaint_attachments enable row level security;
alter table public.complaint_job_links enable row level security;
alter table public.vendor_payouts enable row level security;

revoke all on public.complaint_attachments, public.complaint_job_links, public.vendor_payouts
  from authenticated, anon;
grant select on public.complaint_attachments, public.vendor_payouts to authenticated;
-- Members see when a link was shared and used, never its hash.
grant select (id, hostel_id, complaint_id, worker_id, created_at, revoked_at, accepted_at, last_seen_at)
  on public.complaint_job_links to authenticated;

create policy "complaint attachments: members read"
  on public.complaint_attachments for select to authenticated
  using (hostel_id in (select private.user_hostel_ids()));
create policy "complaint job links: members read"
  on public.complaint_job_links for select to authenticated
  using (hostel_id in (select private.user_hostel_ids()));
create policy "vendor payouts: members read"
  on public.vendor_payouts for select to authenticated
  using (hostel_id in (select private.user_hostel_ids()));

revoke all on function private.complaint_attachments_limit(),
  private.add_complaint_attachment(uuid, text, text, text, text),
  private.hash_token(text),
  private.create_job_link(uuid),
  private.job_link(text),
  private.job_view(text),
  private.job_act(text, text, text, integer),
  private.job_add_attachment(text, text),
  private.set_complaint_costs(uuid, integer, integer, integer, text, uuid),
  private.record_vendor_payout(uuid, integer, date, text, text) from public;
grant execute on function private.add_complaint_attachment(uuid, text, text, text, text),
  private.hash_token(text),
  private.create_job_link(uuid),
  private.set_complaint_costs(uuid, integer, integer, integer, text, uuid),
  private.record_vendor_payout(uuid, integer, date, text, text) to authenticated, service_role;

revoke execute on function public.add_complaint_attachment(uuid, text, text),
  public.create_job_link(uuid),
  public.set_complaint_costs(uuid, integer, integer, integer, text, uuid),
  public.record_vendor_payout(uuid, integer, date, text, text),
  public.job_view(text),
  public.job_act(text, text, text, integer),
  public.job_add_attachment(text, text) from public;
grant execute on function public.add_complaint_attachment(uuid, text, text),
  public.create_job_link(uuid),
  public.set_complaint_costs(uuid, integer, integer, integer, text, uuid),
  public.record_vendor_payout(uuid, integer, date, text, text) to authenticated;
-- The job page is served by the app with the service role.
revoke execute on function public.job_view(text),
  public.job_act(text, text, text, integer),
  public.job_add_attachment(text, text) from anon, authenticated;
grant execute on function private.job_view(text),
  private.job_act(text, text, text, integer),
  private.job_add_attachment(text, text) to service_role;
grant execute on function public.job_view(text),
  public.job_act(text, text, text, integer),
  public.job_add_attachment(text, text) to service_role;
