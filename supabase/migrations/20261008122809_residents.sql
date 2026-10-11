-- Residents: identity, contact, guardian and KYC reference for each person
-- staying in a hostel (E5-T1, E5-T3, E5-T6).
--
-- Full ID numbers are never stored. The server keeps the last 4 characters
-- for display and a keyed HMAC of the normalised number (secret held by the
-- app, never by the database) so duplicates can be detected.

create extension if not exists pg_trgm with schema extensions;

create table public.residents (
  id uuid primary key default gen_random_uuid(),
  hostel_id uuid not null references public.hostels (id) on delete cascade,
  full_name text not null,
  -- Normalised 10-digit Indian mobile number.
  phone text not null,
  alt_phone text,
  email text,
  gender text not null,
  dob date not null,
  id_proof_type text not null,
  id_proof_last4 text not null,
  -- Hex HMAC-SHA256 of "<type>:<normalised number>".
  id_proof_hash text not null,
  -- Object path in the private id-proofs bucket: <hostel_id>/<resident_id>/<file>.
  id_proof_path text,
  guardian_name text,
  guardian_phone text,
  permanent_address text not null,
  joining_date date not null,
  status text not null default 'active',
  status_changed_by uuid references public.profiles (id) on delete set null,
  status_changed_at timestamptz,
  notes text,
  created_by uuid default auth.uid() references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  -- Target of composite tenant keys from allocations and, later, invoices.
  constraint residents_hostel_id_id_key unique (hostel_id, id),
  -- One record per person per hostel (E5-T3): by phone, and by ID proof.
  constraint residents_hostel_phone_key unique (hostel_id, phone),
  constraint residents_hostel_id_proof_key unique (hostel_id, id_proof_type, id_proof_hash),
  constraint residents_full_name_length check (char_length(btrim(full_name)) between 1 and 120),
  constraint residents_phone_format check (phone ~ '^[6-9][0-9]{9}$'),
  constraint residents_alt_phone_format check (alt_phone ~ '^[6-9][0-9]{9}$'),
  constraint residents_guardian_phone_format check (guardian_phone ~ '^[6-9][0-9]{9}$'),
  constraint residents_email_format check (email ~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$'),
  constraint residents_gender_valid check (gender in ('male', 'female', 'other')),
  constraint residents_dob_range check (dob > date '1900-01-01'),
  constraint residents_id_proof_type_valid
    check (id_proof_type in ('aadhaar', 'pan', 'passport', 'driving_licence', 'voter_id')),
  constraint residents_id_proof_last4_format check (id_proof_last4 ~ '^[A-Z0-9]{4}$'),
  constraint residents_id_proof_hash_format check (id_proof_hash ~ '^[0-9a-f]{64}$'),
  -- Files can only live under this resident's own folder.
  constraint residents_id_proof_path_scoped
    check (id_proof_path like hostel_id::text || '/' || id::text || '/%'),
  constraint residents_guardian_name_length check (char_length(btrim(guardian_name)) between 1 and 120),
  constraint residents_address_length check (char_length(btrim(permanent_address)) between 1 and 500),
  constraint residents_notes_length check (char_length(notes) <= 1000),
  constraint residents_status_valid check (status in ('active', 'notice', 'vacated', 'blocked'))
);

comment on table public.residents is
  'People staying in a hostel. Full ID numbers are never stored: only last 4 and a keyed hash.';

-- Search by name (substring, case-insensitive) and by status.
create index residents_full_name_trgm_idx
  on public.residents using gin (full_name extensions.gin_trgm_ops);
create index residents_hostel_status_idx on public.residents (hostel_id, status);

create trigger residents_set_updated_at
  before update on public.residents
  for each row execute function private.set_updated_at();

-- ---------------------------------------------------------------------------
-- Status lifecycle (E5-T6)
-- ---------------------------------------------------------------------------
-- active  -> notice, blocked
-- notice  -> active (notice withdrawn), vacated, blocked
-- vacated -> active (reactivated)
-- blocked -> active
-- Every change records who made it and when. The allocations migration adds
-- the rule that a resident holding a live bed cannot be marked vacated.
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

  new.status_changed_by := (select auth.uid());
  new.status_changed_at := now();
  return new;
end;
$$;

create trigger residents_guard_status
  before update of status on public.residents
  for each row execute function private.residents_guard_status();

-- ---------------------------------------------------------------------------
-- Privileges and row-level security
-- ---------------------------------------------------------------------------
-- Owners and staff both register and maintain residents (front desk work).
-- Identity (name, date of birth, gender, ID proof) is fixed at registration;
-- there are no deletes, because residents carry history.
alter table public.residents enable row level security;

revoke all on public.residents from authenticated;
grant select on public.residents to authenticated;
grant insert (
  hostel_id, full_name, phone, alt_phone, email, gender, dob, id_proof_type, id_proof_last4,
  id_proof_hash, guardian_name, guardian_phone, permanent_address, joining_date, notes
) on public.residents to authenticated;
grant update (
  phone, alt_phone, email, guardian_name, guardian_phone, permanent_address, notes, status,
  id_proof_path
) on public.residents to authenticated;

create policy "residents: members read"
  on public.residents for select
  to authenticated
  using (hostel_id in (select private.user_hostel_ids()));

create policy "residents: members register"
  on public.residents for insert
  to authenticated
  with check (hostel_id in (select private.user_hostel_ids()) and status = 'active');

create policy "residents: members update"
  on public.residents for update
  to authenticated
  using (hostel_id in (select private.user_hostel_ids()))
  with check (hostel_id in (select private.user_hostel_ids()));
