-- Residents raise complaints from their room and follow them (E15-T3, T4).
--
-- Residents have no accounts. Each room has a printed QR code holding an
-- unguessable room token. The resident enters the mobile number on their
-- record and confirms a one-time code sent by SMS; only a resident with a
-- live stay in that room is accepted, and every refusal looks exactly like
-- success. A verified resident gets a short session (2 hours) to raise
-- complaints, and a status link (by SMS) that shows their own complaints
-- only and lets them confirm a fix (with a rating) or reopen it.
--
-- All of it runs through the functions below with the service role, from
-- the server: a resident's browser never talks to the database. Codes and
-- session tokens are stored only as SHA-256 hashes; room tokens and status
-- tokens are kept so the QR code can be reprinted and later SMS can carry
-- the link, and they are readable only by the service role (status) or by
-- members of the hostel (room).
--
-- SMS messages are queued in sms_outbox and sent by the app's delivery job
-- through the provider configured in SMS_PROVIDER (docs/resident-complaints.md).

set check_function_bodies = off;

-- ---------------------------------------------------------------------------
-- Settings per hostel
-- ---------------------------------------------------------------------------
alter table public.hostels
  add column resident_complaints_enabled boolean not null default true,
  add column resident_confirm_days integer not null default 3,
  add constraint hostels_resident_confirm_days_range check (resident_confirm_days between 1 and 14);

grant update (resident_complaints_enabled, resident_confirm_days) on public.hostels to authenticated;

-- ---------------------------------------------------------------------------
-- Complaints remember who raised them and what the resident thought
-- ---------------------------------------------------------------------------
alter table public.complaints
  add column source text not null default 'staff',
  add column resident_confirmed_at timestamptz,
  add column resident_rating integer,
  add column resident_feedback text,
  add constraint complaints_source_valid check (source in ('staff', 'resident', 'schedule')),
  add constraint complaints_rating_range check (resident_rating between 1 and 5),
  add constraint complaints_feedback_length check (char_length(btrim(resident_feedback)) between 1 and 500);

update public.complaints set source = 'schedule' where kind = 'scheduled';

alter table public.complaint_attachments drop constraint complaint_attachments_source_valid;
alter table public.complaint_attachments add constraint complaint_attachments_source_valid
  check (source in ('member', 'worker', 'resident'));

alter table public.complaint_events drop constraint complaint_events_kind_valid;
alter table public.complaint_events add constraint complaint_events_kind_valid check (kind in (
  'created', 'status', 'assigned', 'unassigned', 'comment', 'routing', 'escalated', 'accepted',
  'declined', 'cost', 'attachment', 'job_link', 'confirmed', 'rated'
));

-- History names whoever acted. A resident has no profile, so the resident
-- functions name them for the transaction (complaints.actor).
create or replace function private.actor_name()
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(nullif(current_setting('complaints.actor', true), ''),
                  (select p.full_name from public.profiles p where p.id = auth.uid()),
                  'Automatic');
$$;

-- ---------------------------------------------------------------------------
-- Room tokens
-- ---------------------------------------------------------------------------
create table public.room_report_tokens (
  id uuid primary key default gen_random_uuid(),
  hostel_id uuid not null references public.hostels (id) on delete cascade,
  room_id uuid not null,
  token text not null unique,
  created_by uuid default auth.uid() references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  revoked_at timestamptz,
  constraint room_report_tokens_room_fkey foreign key (hostel_id, room_id)
    references public.rooms (hostel_id, id) on delete cascade,
  constraint room_report_tokens_format check (token ~ '^[0-9a-f]{32}$')
);

create unique index room_report_tokens_one_live
  on public.room_report_tokens (room_id) where revoked_at is null;

-- The room's live token, made on first use. Members of the hostel; a new
-- token (p_regenerate) is owners only and makes printed codes stop working.
create or replace function public.room_report_token(p_room_id uuid, p_regenerate boolean default false)
returns text
language plpgsql
security invoker
set search_path = ''
as $$
declare
  room record;
begin
  select r.id, r.hostel_id into room from public.rooms r where r.id = p_room_id;
  if room.id is null or room.hostel_id not in (select private.user_hostel_ids()) then
    raise exception 'You do not have permission to do that' using errcode = '42501';
  end if;
  if p_regenerate and room.hostel_id not in (select private.user_owned_hostel_ids()) then
    raise exception 'Only the owner can make a new code' using errcode = '42501';
  end if;
  return private.room_report_token(room.id, room.hostel_id, p_regenerate);
end;
$$;

create or replace function private.room_report_token(p_room_id uuid, p_hostel_id uuid, p_regenerate boolean)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_token text;
begin
  perform pg_advisory_xact_lock(hashtextextended('room_token:' || p_room_id::text, 0));
  if p_regenerate then
    update public.room_report_tokens set revoked_at = now()
     where room_id = p_room_id and revoked_at is null;
  end if;
  select t.token into current_token from public.room_report_tokens t
   where t.room_id = p_room_id and t.revoked_at is null;
  if current_token is null then
    current_token := encode(extensions.gen_random_bytes(16), 'hex');
    insert into public.room_report_tokens (hostel_id, room_id, token)
    values (p_hostel_id, p_room_id, current_token);
  end if;
  return current_token;
end;
$$;

-- ---------------------------------------------------------------------------
-- SMS outbox
-- ---------------------------------------------------------------------------
create table public.sms_outbox (
  id uuid primary key default gen_random_uuid(),
  hostel_id uuid references public.hostels (id) on delete cascade,
  to_phone text not null,
  kind text not null,
  -- The provider template's variables, in order (DLT templates are fixed
  -- text with variables).
  variables text[] not null,
  -- What the message says, for the log. A code is never stored here.
  preview text not null,
  dedupe_key text,
  created_at timestamptz not null default now(),
  attempts integer not null default 0,
  last_error text,
  sent_at timestamptz,
  provider_id text,
  constraint sms_outbox_phone_format check (to_phone ~ '^[6-9][0-9]{9}$'),
  constraint sms_outbox_kind_valid check (kind in ('resident_code', 'complaint_update')),
  constraint sms_outbox_attempts_range check (attempts between 0 and 10)
);

create unique index sms_outbox_dedupe_key on public.sms_outbox (dedupe_key) where dedupe_key is not null;
create index sms_outbox_unsent_idx on public.sms_outbox (created_at) where sent_at is null;

-- The platform's emails (billing, suspension) are sent by the same delivery
-- job, which needs to count failures.
alter table public.email_outbox
  add column attempts integer not null default 0,
  add column last_error text;

comment on table public.sms_outbox is
  'Text messages to residents, sent by the app''s delivery job. One-time codes are sent at once and never stored in full.';

-- ---------------------------------------------------------------------------
-- One-time codes and sessions
-- ---------------------------------------------------------------------------
create table public.resident_codes (
  id uuid primary key default gen_random_uuid(),
  hostel_id uuid not null references public.hostels (id) on delete cascade,
  room_id uuid not null,
  phone text not null,
  -- Null when the number did not match a resident: the request is still
  -- counted for rate limits, and verifying always fails.
  resident_id uuid,
  code_hash text,
  attempts integer not null default 0,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  used_at timestamptz,
  constraint resident_codes_phone_format check (phone ~ '^[6-9][0-9]{9}$')
);

create index resident_codes_phone_idx on public.resident_codes (phone, created_at desc);
create index resident_codes_room_idx on public.resident_codes (room_id, created_at desc);

create table public.resident_sessions (
  token_hash text primary key,
  hostel_id uuid not null references public.hostels (id) on delete cascade,
  room_id uuid not null,
  resident_id uuid not null,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null
);

create table public.resident_status_tokens (
  token text primary key,
  hostel_id uuid not null references public.hostels (id) on delete cascade,
  resident_id uuid not null,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  constraint resident_status_tokens_format check (token ~ '^[0-9a-f]{48}$')
);

create index resident_status_tokens_resident_idx on public.resident_status_tokens (resident_id, expires_at desc);

-- A resident with a live stay in the room and this mobile number.
create or replace function private.resident_in_room(p_room_id uuid, p_phone text)
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select r.id
    from public.residents r
    join public.allocations a on a.resident_id = r.id and a.room_id = p_room_id
   where r.phone = p_phone
     and r.status in ('active', 'notice')
     and r.erased_at is null
     and a.start_date <= private.today_ist()
     and (a.end_date is null or a.end_date >= private.today_ist())
   limit 1;
$$;

create or replace function private.live_room_token(p_token text)
returns record
language sql
stable
security definer
set search_path = ''
as $$
  select t.room_id, t.hostel_id, h.name::text, h.resident_complaints_enabled, rm.room_number::text
    from public.room_report_tokens t
    join public.hostels h on h.id = t.hostel_id
    join public.rooms rm on rm.id = t.room_id
   where t.token = p_token and t.revoked_at is null and h.status = 'active'
     and rm.status = 'active';
$$;

-- What the room page shows before anything is verified: the hostel and
-- room the code belongs to, or null for a dead or unknown code.
create or replace function private.resident_room(p_token text)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  room record;
begin
  select * into room from private.live_room_token(p_token)
    as x(room_id uuid, hostel_id uuid, hostel_name text, enabled boolean, room_number text);
  if room.room_id is null then
    return null;
  end if;
  return jsonb_build_object('hostel_name', room.hostel_name, 'room_number', room.room_number,
                            'enabled', room.enabled);
end;
$$;

-- Asks for a code. Rate limits: 3 codes per number per 15 minutes and 10 a
-- day; 30 per room an hour. Returns the code to send, or null (unknown
-- number, limits, complaints off): the caller says the same thing either
-- way, so nobody can learn who lives where.
create or replace function private.resident_request_code(p_token text, p_phone text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  room record;
  resident uuid;
  code text;
begin
  if p_phone !~ '^[6-9][0-9]{9}$' then
    return null;
  end if;
  select * into room from private.live_room_token(p_token)
    as x(room_id uuid, hostel_id uuid, hostel_name text, enabled boolean, room_number text);
  if room.room_id is null or not room.enabled then
    return null;
  end if;

  perform pg_advisory_xact_lock(hashtextextended('resident_code:' || p_phone, 0));
  if (select count(*) from public.resident_codes c
       where c.phone = p_phone and c.created_at > now() - interval '15 minutes') >= 3
     or (select count(*) from public.resident_codes c
          where c.phone = p_phone and c.created_at > now() - interval '1 day') >= 10
     or (select count(*) from public.resident_codes c
          where c.room_id = room.room_id and c.created_at > now() - interval '1 hour') >= 30 then
    return null;
  end if;

  resident := private.resident_in_room(room.room_id, p_phone);
  -- Six digits, uniformly: 4 random bytes reduced modulo 10^6.
  code := lpad(((('x' || encode(extensions.gen_random_bytes(4), 'hex'))::bit(32)::bigint
                 % 1000000))::text, 6, '0');
  insert into public.resident_codes (hostel_id, room_id, phone, resident_id, code_hash, expires_at)
  values (room.hostel_id, room.room_id, p_phone, resident,
          case when resident is null then null
               else encode(extensions.digest(code || ':' || p_phone, 'sha256'), 'hex') end,
          now() + interval '10 minutes');

  if resident is null then
    return null;
  end if;
  return jsonb_build_object('code', code, 'phone', p_phone, 'hostel_id', room.hostel_id,
                            'hostel_name', room.hostel_name);
end;
$$;

-- Checks a code: at most 5 tries per code, within 10 minutes, once. A
-- correct code returns a new session token (only its hash is stored).
create or replace function private.resident_verify_code(p_token text, p_phone text, p_code text)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  room record;
  attempt public.resident_codes;
  session_token text;
begin
  select * into room from private.live_room_token(p_token)
    as x(room_id uuid, hostel_id uuid, hostel_name text, enabled boolean, room_number text);
  if room.room_id is null or not room.enabled or p_code !~ '^[0-9]{6}$' then
    return null;
  end if;

  select * into attempt from public.resident_codes c
   where c.room_id = room.room_id and c.phone = p_phone and c.used_at is null
     and c.expires_at > now()
   order by c.created_at desc
   limit 1
   for update;
  if attempt.id is null or attempt.attempts >= 5 then
    return null;
  end if;
  update public.resident_codes set attempts = attempts + 1 where id = attempt.id;
  if attempt.code_hash is null
     or attempt.code_hash <> encode(extensions.digest(p_code || ':' || p_phone, 'sha256'), 'hex')
     -- The stay may have ended since the code was sent.
     or private.resident_in_room(room.room_id, p_phone) is distinct from attempt.resident_id then
    return null;
  end if;

  update public.resident_codes set used_at = now() where id = attempt.id;
  session_token := encode(extensions.gen_random_bytes(24), 'hex');
  insert into public.resident_sessions (token_hash, hostel_id, room_id, resident_id, expires_at)
  values (private.hash_token(session_token), room.hostel_id, room.room_id, attempt.resident_id,
          now() + interval '2 hours');
  return session_token;
end;
$$;

create or replace function private.resident_session(p_session text)
returns public.resident_sessions
language sql
stable
security definer
set search_path = ''
as $$
  select s.* from public.resident_sessions s
   where s.token_hash = private.hash_token(p_session) and s.expires_at > now()
     and private.resident_in_room(s.room_id,
           (select r.phone from public.residents r where r.id = s.resident_id)) = s.resident_id
     and (select h.resident_complaints_enabled and h.status = 'active'
            from public.hostels h where h.id = s.hostel_id);
$$;

-- What the complaint form needs: who is reporting, where, and the
-- categories they can choose.
create or replace function private.resident_form(p_session text)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  s public.resident_sessions := private.resident_session(p_session);
begin
  if s.token_hash is null then
    return null;
  end if;
  return jsonb_build_object(
    'resident_name', (select split_part(r.full_name, ' ', 1) from public.residents r where r.id = s.resident_id),
    'hostel_name', (select h.name from public.hostels h where h.id = s.hostel_id),
    'room_number', (select rm.room_number from public.rooms rm where rm.id = s.room_id),
    'categories', coalesce((
      select jsonb_agg(jsonb_build_object('id', c.id, 'name', c.name) order by c.name)
        from public.complaint_categories c where c.hostel_id = s.hostel_id and c.active
    ), '[]'::jsonb)
  );
end;
$$;

-- The resident's status link, made or extended (60 days).
create or replace function private.resident_status_token(p_hostel_id uuid, p_resident_id uuid)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_token text;
begin
  select t.token into current_token from public.resident_status_tokens t
   where t.resident_id = p_resident_id and t.expires_at > now() + interval '7 days'
   order by t.expires_at desc limit 1;
  if current_token is null then
    current_token := encode(extensions.gen_random_bytes(24), 'hex');
    insert into public.resident_status_tokens (token, hostel_id, resident_id, expires_at)
    values (current_token, p_hostel_id, p_resident_id, now() + interval '60 days');
  else
    update public.resident_status_tokens set expires_at = now() + interval '60 days'
     where token = current_token;
  end if;
  return current_token;
end;
$$;

-- Raises the complaint for the verified resident's room and routes it.
-- Returns its id, number and the status link token.
create or replace function private.resident_raise_complaint(
  p_session text,
  p_category_id uuid,
  p_description text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  s public.resident_sessions := private.resident_session(p_session);
  resident record;
  category text;
  complaint uuid;
  complaint_number integer;
  status_token text;
begin
  if s.token_hash is null then
    raise exception 'Your session has ended. Scan the code again.'
      using errcode = 'P0001', hint = 'resident_session';
  end if;
  if char_length(btrim(coalesce(p_description, ''))) not between 5 and 1000 then
    raise exception 'Describe the problem in a few words'
      using errcode = 'P0001', hint = 'complaint_description';
  end if;
  -- At most 5 complaints a resident a day, so a session cannot flood the hostel.
  if (select count(*) from public.complaints c
       where c.resident_id = s.resident_id and c.source = 'resident'
         and c.created_at > now() - interval '1 day') >= 5 then
    raise exception 'You have reported several problems today. Ask the hostel about anything else.'
      using errcode = 'P0001', hint = 'resident_complaint_limit';
  end if;
  select c.name into category from public.complaint_categories c
   where c.id = p_category_id and c.hostel_id = s.hostel_id and c.active;
  if category is null then
    raise exception 'Choose what the problem is about' using errcode = 'P0001', hint = 'complaint_category';
  end if;
  select r.full_name, r.phone into resident from public.residents r where r.id = s.resident_id;
  perform set_config('complaints.actor', resident.full_name || ' (resident)', true);

  complaint := private.raise_complaint(
    s.hostel_id, p_category_id,
    left(category || ': ' || regexp_replace(btrim(p_description), '\s+', ' ', 'g'), 120),
    btrim(p_description), 'normal', s.room_id, null, null, s.resident_id, false, 'complaint'
  );
  update public.complaints set source = 'resident', raised_by_name = resident.full_name || ' (resident)'
   where id = complaint;
  select c.number into complaint_number from public.complaints c where c.id = complaint;

  status_token := private.resident_status_token(s.hostel_id, s.resident_id);
  insert into public.sms_outbox (hostel_id, to_phone, kind, variables, preview, dedupe_key)
  values (s.hostel_id, resident.phone, 'complaint_update',
          array[complaint_number::text,
                left((select h.name from public.hostels h where h.id = s.hostel_id), 30),
                'received', status_token],
          'Complaint #' || complaint_number || ': received',
          'complaint_update:' || complaint || ':received');
  return jsonb_build_object('id', complaint, 'number', complaint_number, 'status_token', status_token,
                            'phone', resident.phone);
end;
$$;

-- A photo the resident attached while their session lasts.
create or replace function private.resident_add_attachment(p_session text, p_complaint_id uuid, p_path text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  s public.resident_sessions := private.resident_session(p_session);
begin
  if s.token_hash is null or not exists (
    select 1 from public.complaints c
     where c.id = p_complaint_id and c.resident_id = s.resident_id and c.source = 'resident'
  ) then
    raise exception 'Not found' using errcode = 'P0001', hint = 'resident_session';
  end if;
  perform set_config('complaints.actor',
    (select r.full_name || ' (resident)' from public.residents r where r.id = s.resident_id), true);
  return private.add_complaint_attachment(p_complaint_id, p_path, 'photo', 'resident', null);
end;
$$;

-- ---------------------------------------------------------------------------
-- Following a complaint (E15-T4)
-- ---------------------------------------------------------------------------
create or replace function private.resident_by_status_token(p_token text)
returns public.resident_status_tokens
language sql
stable
security definer
set search_path = ''
as $$
  select t.* from public.resident_status_tokens t
   where t.token = p_token and t.expires_at > now();
$$;

-- The resident's own complaints from the last 90 days, newest first, with
-- the steps they care about. Workers appear by trade, not by name.
create or replace function private.resident_status(p_token text)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  t public.resident_status_tokens := private.resident_by_status_token(p_token);
begin
  if t.token is null then
    return null;
  end if;
  return jsonb_build_object(
    'resident_name', (select split_part(r.full_name, ' ', 1) from public.residents r where r.id = t.resident_id),
    'hostel_name', (select h.name from public.hostels h where h.id = t.hostel_id),
    'complaints', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', c.id, 'number', c.number, 'category', cat.name, 'description', c.description,
        'status', c.status, 'created_at', c.created_at, 'resolved_at', c.resolved_at,
        'closed_at', c.closed_at, 'confirmed_at', c.resident_confirmed_at,
        'rating', c.resident_rating,
        'worker', case when c.worker_id is null then null
                       else (select initcap(replace(cat.trade, '_', ' '))) end,
        'steps', coalesce((
          select jsonb_agg(jsonb_build_object('at', e.created_at, 'kind', e.kind, 'to', e.to_status)
                           order by e.id)
            from public.complaint_events e
           where e.complaint_id = c.id
             and (e.kind in ('created', 'assigned', 'confirmed')
                  or (e.kind = 'status' and e.to_status in ('in_progress', 'on_hold', 'resolved',
                                                            'closed', 'reopened')))
        ), '[]'::jsonb)
      ) order by c.created_at desc)
        from public.complaints c
        join public.complaint_categories cat on cat.id = c.category_id
       where c.resident_id = t.resident_id and c.hostel_id = t.hostel_id
         and c.source = 'resident' and c.created_at > now() - interval '90 days'
    ), '[]'::jsonb)
  );
end;
$$;

-- The resident confirms the fix (closing it, with an optional rating) or
-- says it is still a problem (reopening it, with a reason).
create or replace function private.resident_respond(
  p_token text,
  p_complaint_id uuid,
  p_fixed boolean,
  p_rating integer,
  p_comment text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  t public.resident_status_tokens := private.resident_by_status_token(p_token);
  c record;
  actor text;
begin
  select cm.id, cm.status into c from public.complaints cm
   where cm.id = p_complaint_id and cm.resident_id = t.resident_id and cm.hostel_id = t.hostel_id
     and cm.source = 'resident'
   for update;
  if t.token is null or c.id is null then
    raise exception 'Not found' using errcode = 'P0001', hint = 'resident_status';
  end if;
  if c.status <> 'resolved' then
    raise exception 'This complaint is not waiting for your answer'
      using errcode = 'P0001', hint = 'complaint_not_resolved';
  end if;
  if p_rating is not null and p_rating not between 1 and 5 then
    raise exception 'Rate from 1 to 5' using errcode = 'P0001', hint = 'rating_range';
  end if;
  actor := (select r.full_name || ' (resident)' from public.residents r where r.id = t.resident_id);
  perform set_config('complaints.actor', actor, true);

  if p_fixed then
    update public.complaints
       set resident_confirmed_at = now(), resident_rating = p_rating,
           resident_feedback = nullif(left(btrim(coalesce(p_comment, '')), 500), '')
     where id = c.id;
    perform private.log_complaint(c.id, 'confirmed',
      concat_ws(' · ', case when p_rating is not null then p_rating || ' out of 5' end,
                nullif(left(btrim(coalesce(p_comment, '')), 500), '')),
      p_actor_name => actor);
    perform private.set_complaint_status(c.id, 'closed', 'Confirmed fixed by the resident', actor);
  else
    if char_length(btrim(coalesce(p_comment, ''))) < 3 then
      raise exception 'Tell us what is still wrong' using errcode = 'P0001', hint = 'reason_required';
    end if;
    perform private.set_complaint_status(c.id, 'reopened', left(btrim(p_comment), 500), actor);
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- Telling the resident (E15-T4)
-- ---------------------------------------------------------------------------
-- When a resident's complaint is assigned, started or resolved, an SMS with
-- their status link is queued, once per step.
create or replace function private.complaint_events_notify_resident()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  c record;
  step text;
  token text;
begin
  step := case
    when new.kind = 'assigned' then 'assigned'
    when new.kind = 'status' and new.to_status in ('in_progress', 'resolved') then new.to_status
  end;
  if step is null then
    return null;
  end if;
  select cm.id, cm.number, cm.hostel_id, cm.resident_id, cm.source, r.phone, h.name as hostel_name
    into c
    from public.complaints cm
    join public.residents r on r.id = cm.resident_id
    join public.hostels h on h.id = cm.hostel_id
   where cm.id = new.complaint_id;
  if c.id is null or c.source <> 'resident' or c.phone is null then
    return null;
  end if;
  token := private.resident_status_token(c.hostel_id, c.resident_id);
  insert into public.sms_outbox (hostel_id, to_phone, kind, variables, preview, dedupe_key)
  values (
    c.hostel_id, c.phone, 'complaint_update',
    array[c.number::text, left(c.hostel_name, 30),
          case step when 'assigned' then 'someone is assigned'
                    when 'in_progress' then 'work has started'
                    else 'marked fixed, please confirm' end,
          token],
    'Complaint #' || c.number || ': ' || step,
    'complaint_update:' || c.id || ':' || step || ':' || new.id
  )
  on conflict (dedupe_key) where dedupe_key is not null do nothing;
  return null;
end;
$$;

create trigger complaint_events_notify_resident
  after insert on public.complaint_events
  for each row execute function private.complaint_events_notify_resident();

-- Resolved resident complaints the resident did not answer close on their
-- own after the hostel's confirmation window.
create or replace function private.close_unconfirmed_complaints()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  c record;
  closed integer := 0;
begin
  for c in
    select cm.id, h.resident_confirm_days
      from public.complaints cm join public.hostels h on h.id = cm.hostel_id
     where cm.source = 'resident' and cm.status = 'resolved'
       and cm.resolved_at < now() - make_interval(days => h.resident_confirm_days)
  loop
    perform private.set_complaint_status(c.id, 'closed',
      'Closed automatically: no answer from the resident in ' || c.resident_confirm_days || ' days',
      'Automatic');
    closed := closed + 1;
  end loop;
  return closed;
end;
$$;

select cron.schedule('close-unconfirmed-complaints', '23 * * * *',
                     $$select private.close_unconfirmed_complaints()$$);

-- Old codes and sessions are of no use to anyone.
select cron.schedule('purge-resident-codes', '41 3 * * *', $$
  delete from public.resident_codes where created_at < now() - interval '2 days';
  delete from public.resident_sessions where expires_at < now() - interval '1 day';
  delete from public.resident_status_tokens where expires_at < now();
$$);

-- ---------------------------------------------------------------------------
-- Privileges and row-level security
-- ---------------------------------------------------------------------------
alter table public.room_report_tokens enable row level security;
alter table public.sms_outbox enable row level security;
alter table public.resident_codes enable row level security;
alter table public.resident_sessions enable row level security;
alter table public.resident_status_tokens enable row level security;

revoke all on public.room_report_tokens, public.sms_outbox, public.resident_codes,
  public.resident_sessions, public.resident_status_tokens from authenticated, anon;

-- Members see their rooms' codes (to print them); nothing else here is
-- readable by signed-in users.
grant select on public.room_report_tokens to authenticated;
create policy "room report tokens: members read"
  on public.room_report_tokens for select to authenticated
  using (hostel_id in (select private.user_hostel_ids()));

-- Read-only mode covers the new tenant tables; the service role passes.
do $$
declare
  t text;
begin
  foreach t in array array['room_report_tokens', 'sms_outbox', 'resident_codes',
                           'resident_sessions', 'resident_status_tokens'] loop
    execute format(
      'create trigger %I before insert or update or delete on public.%I
         for each row execute function private.require_account_can_write()',
      t || '_require_account_can_write', t
    );
  end loop;
end;
$$;

revoke all on function private.room_report_token(uuid, uuid, boolean),
  private.resident_in_room(uuid, text), private.live_room_token(text), private.resident_room(text),
  private.resident_request_code(text, text), private.resident_verify_code(text, text, text),
  private.resident_session(text), private.resident_form(text),
  private.resident_status_token(uuid, uuid), private.resident_raise_complaint(text, uuid, text),
  private.resident_add_attachment(text, uuid, text), private.resident_by_status_token(text),
  private.resident_status(text), private.resident_respond(text, uuid, boolean, integer, text),
  private.complaint_events_notify_resident(), private.close_unconfirmed_complaints() from public;
grant execute on function private.room_report_token(uuid, uuid, boolean) to authenticated;

revoke execute on function public.room_report_token(uuid, boolean) from public, anon;
grant execute on function public.room_report_token(uuid, boolean) to authenticated;

-- Server-side wrappers for the resident pages: service role only.
create or replace function public.resident_room(p_token text)
returns jsonb language sql stable security invoker set search_path = ''
as $$ select private.resident_room(p_token); $$;
create or replace function public.resident_request_code(p_token text, p_phone text)
returns jsonb language sql security invoker set search_path = ''
as $$ select private.resident_request_code(p_token, p_phone); $$;
create or replace function public.resident_verify_code(p_token text, p_phone text, p_code text)
returns text language sql security invoker set search_path = ''
as $$ select private.resident_verify_code(p_token, p_phone, p_code); $$;
create or replace function public.resident_form(p_session text)
returns jsonb language sql stable security invoker set search_path = ''
as $$ select private.resident_form(p_session); $$;
create or replace function public.resident_raise_complaint(p_session text, p_category_id uuid, p_description text)
returns jsonb language sql security invoker set search_path = ''
as $$ select private.resident_raise_complaint(p_session, p_category_id, p_description); $$;
create or replace function public.resident_add_attachment(p_session text, p_complaint_id uuid, p_path text)
returns uuid language sql security invoker set search_path = ''
as $$ select private.resident_add_attachment(p_session, p_complaint_id, p_path); $$;
create or replace function public.resident_status(p_token text)
returns jsonb language sql stable security invoker set search_path = ''
as $$ select private.resident_status(p_token); $$;
create or replace function public.resident_respond(
  p_token text, p_complaint_id uuid, p_fixed boolean, p_rating integer, p_comment text)
returns void language sql security invoker set search_path = ''
as $$ select private.resident_respond(p_token, p_complaint_id, p_fixed, p_rating, p_comment); $$;

revoke execute on function public.resident_room(text), public.resident_request_code(text, text),
  public.resident_verify_code(text, text, text), public.resident_form(text),
  public.resident_raise_complaint(text, uuid, text), public.resident_add_attachment(text, uuid, text),
  public.resident_status(text), public.resident_respond(text, uuid, boolean, integer, text)
  from public, anon, authenticated;
grant execute on function public.resident_room(text), public.resident_request_code(text, text),
  public.resident_verify_code(text, text, text), public.resident_form(text),
  public.resident_raise_complaint(text, uuid, text), public.resident_add_attachment(text, uuid, text),
  public.resident_status(text), public.resident_respond(text, uuid, boolean, integer, text)
  to service_role;
grant execute on function private.resident_room(text), private.resident_request_code(text, text),
  private.resident_verify_code(text, text, text), private.resident_form(text),
  private.resident_raise_complaint(text, uuid, text), private.resident_add_attachment(text, uuid, text),
  private.resident_status(text), private.resident_respond(text, uuid, boolean, integer, text),
  private.resident_session(text), private.resident_by_status_token(text) to service_role;
