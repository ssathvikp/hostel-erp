-- Residents' data rights under the Digital Personal Data Protection Act,
-- 2023 (deferred MVP gap): consent, a copy of their data, and erasure.
--
-- Rules:
-- - consent_at records when the resident agreed to their details being
--   kept for running the hostel, and who recorded it. Set once; new
--   registrations and imports must record it.
-- - Erasure is for people who have left: vacated, no bed, nothing owed and
--   no deposit held. It removes contact and KYC details and the ID proof
--   reference, and replaces the name, keeping the stays, invoices,
--   payments and deposits (money records the hostel must keep) under a
--   pseudonym. It cannot be undone, and an erased record cannot be edited
--   or reactivated.
-- - Exports and erasures are logged in data_rights_log, readable by owners.

alter table public.residents
  add column consent_at timestamptz,
  add column consent_recorded_by uuid references public.profiles (id) on delete set null,
  add column erased_at timestamptz,
  add column erased_by uuid references public.profiles (id) on delete set null;

comment on column public.residents.consent_at is
  'When the resident consented to their data being kept for hostel management (DPDP Act 2023). Null: not recorded.';
comment on column public.residents.erased_at is
  'When personal details were erased at the resident''s request. Money and stay records remain under a pseudonym.';

-- Erased residents keep no phone, birth date, address or ID fingerprint.
alter table public.residents
  alter column phone drop not null,
  alter column dob drop not null,
  alter column permanent_address drop not null,
  alter column id_proof_last4 drop not null,
  alter column id_proof_hash drop not null,
  add constraint residents_personal_data_present check (
    erased_at is not null
    or (phone is not null and dob is not null and permanent_address is not null
        and id_proof_last4 is not null and id_proof_hash is not null)
  );

grant insert (consent_at) on public.residents to authenticated;
grant update (consent_at) on public.residents to authenticated;

-- Consent is stamped by the database: when it is recorded, by whom, once.
-- Erased records are frozen for everyone but the erase function.
create or replace function private.residents_guard_data_rights()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if tg_op = 'UPDATE' and old.erased_at is not null and current_user = 'authenticated' then
    raise exception 'This resident''s details were erased and cannot be changed'
      using errcode = 'P0001', hint = 'resident_erased';
  end if;

  if current_user = 'authenticated' then
    if tg_op = 'INSERT' then
      new.erased_at := null;
      new.erased_by := null;
      if new.consent_at is not null then
        new.consent_at := now();
        new.consent_recorded_by := (select auth.uid());
      end if;
    elsif new.consent_at is distinct from old.consent_at then
      if old.consent_at is not null then
        raise exception 'Consent is already recorded for this resident'
          using errcode = 'P0001', hint = 'consent_recorded';
      end if;
      new.consent_at := now();
      new.consent_recorded_by := (select auth.uid());
    end if;
  end if;
  return new;
end;
$$;

create trigger residents_guard_data_rights
  before insert or update on public.residents
  for each row execute function private.residents_guard_data_rights();

-- ---------------------------------------------------------------------------
-- Log
-- ---------------------------------------------------------------------------
create table public.data_rights_log (
  id uuid primary key default gen_random_uuid(),
  hostel_id uuid not null references public.hostels (id) on delete cascade,
  resident_id uuid not null,
  action text not null,
  reason text,
  done_by uuid not null default auth.uid() references public.profiles (id),
  done_by_name text,
  done_at timestamptz not null default now(),

  constraint data_rights_log_resident_fkey foreign key (hostel_id, resident_id)
    references public.residents (hostel_id, id),
  constraint data_rights_log_action_valid check (action in ('export', 'erase')),
  constraint data_rights_log_reason_length check (char_length(btrim(reason)) between 1 and 500)
);

comment on table public.data_rights_log is
  'Append-only record of resident data exports and erasures: who, when and why.';

create index data_rights_log_resident_idx on public.data_rights_log (resident_id, done_at desc);

create or replace function private.data_rights_log_stamp()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  new.done_by_name := (select pr.full_name from public.profiles pr where pr.id = new.done_by);
  new.done_at := now();
  return new;
end;
$$;

create trigger data_rights_log_stamp
  before insert on public.data_rights_log
  for each row execute function private.data_rights_log_stamp();

alter table public.data_rights_log enable row level security;
revoke all on public.data_rights_log from authenticated;
grant select on public.data_rights_log to authenticated;
grant insert (hostel_id, resident_id, action, reason) on public.data_rights_log to authenticated;

create policy "data rights log: owners read"
  on public.data_rights_log for select
  to authenticated
  using (hostel_id in (select private.user_owned_hostel_ids()));

-- Exports are logged by the owner who makes them; erasures by the function.
create policy "data rights log: owners record exports"
  on public.data_rights_log for insert
  to authenticated
  with check (
    hostel_id in (select private.user_owned_hostel_ids())
    and action = 'export'
    and done_by = (select auth.uid())
  );

-- ---------------------------------------------------------------------------
-- Erasure
-- ---------------------------------------------------------------------------
create or replace function private.erase_resident(p_resident_id uuid, p_reason text)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  r record;
begin
  select re.id, re.hostel_id, re.status, re.erased_at into r
    from public.residents re
   where re.id = p_resident_id
     and re.hostel_id in (select private.user_owned_hostel_ids())
   for update;
  if not found then
    raise exception 'Resident not found' using errcode = 'P0001', hint = 'resident_not_found';
  end if;
  if r.erased_at is not null then
    raise exception 'Already erased' using errcode = 'P0001', hint = 'resident_erased';
  end if;
  if nullif(btrim(p_reason), '') is null then
    raise exception 'Say why the details are being erased'
      using errcode = 'P0001', hint = 'erase_reason_required';
  end if;
  if r.status <> 'vacated' or private.resident_has_live_allocation(r.id) then
    raise exception 'Only residents who have left can be erased'
      using errcode = 'P0001', hint = 'erase_not_vacated';
  end if;
  if exists (
    select 1 from public.invoice_balances b where b.resident_id = r.id and b.balance > 0
  ) then
    raise exception 'Settle what the resident owes first'
      using errcode = 'P0001', hint = 'erase_balance_due';
  end if;
  if private.deposit_held(r.id) > 0 then
    raise exception 'Refund or deduct the deposit first'
      using errcode = 'P0001', hint = 'erase_deposit_held';
  end if;
  if exists (
    select 1 from public.allocations a
     where a.resident_id = r.id and (a.end_date is null or a.end_date >= private.today_ist())
  ) then
    raise exception 'Only residents who have left can be erased'
      using errcode = 'P0001', hint = 'erase_not_vacated';
  end if;

  update public.residents
     set full_name = 'Erased resident ' || upper(left(r.id::text, 6)),
         phone = null,
         alt_phone = null,
         email = null,
         dob = null,
         id_proof_last4 = null,
         id_proof_hash = null,
         id_proof_path = null,
         guardian_name = null,
         guardian_phone = null,
         permanent_address = null,
         notes = null,
         erased_at = now(),
         erased_by = (select auth.uid())
   where id = r.id;

  insert into public.data_rights_log (hostel_id, resident_id, action, reason, done_by)
  values (r.hostel_id, r.id, 'erase', btrim(p_reason), (select auth.uid()));
end;
$$;

create or replace function public.erase_resident(p_resident_id uuid, p_reason text)
returns void
language sql
volatile
security invoker
set search_path = ''
as $$ select private.erase_resident(p_resident_id, p_reason); $$;

revoke all on function private.erase_resident(uuid, text) from public, anon;
revoke all on function public.erase_resident(uuid, text) from public, anon;
grant execute on function private.erase_resident(uuid, text) to authenticated;
grant execute on function public.erase_resident(uuid, text) to authenticated;

-- ---------------------------------------------------------------------------
-- Imports record consent for every row that carries it
-- ---------------------------------------------------------------------------
create or replace function public.import_residents(p_hostel_id uuid, p_residents jsonb)
returns integer
language plpgsql
security invoker
set search_path = ''
as $$
declare
  created integer;
begin
  if jsonb_typeof(p_residents) <> 'array' or jsonb_array_length(p_residents) not between 1 and 500 then
    raise exception 'An import holds between 1 and 500 residents'
      using errcode = 'P0001', hint = 'import_size';
  end if;

  insert into public.residents (
    hostel_id, full_name, phone, alt_phone, email, gender, dob,
    id_proof_type, id_proof_last4, id_proof_hash,
    guardian_name, guardian_phone, permanent_address, joining_date, notes, consent_at
  )
  select
    p_hostel_id, r.full_name, r.phone, r.alt_phone, r.email, r.gender, r.dob,
    r.id_proof_type, r.id_proof_last4, r.id_proof_hash,
    r.guardian_name, r.guardian_phone, r.permanent_address, r.joining_date, r.notes,
    case when r.consent then now() end
  from jsonb_to_recordset(p_residents) as r (
    full_name text, phone text, alt_phone text, email text, gender text, dob date,
    id_proof_type text, id_proof_last4 text, id_proof_hash text,
    guardian_name text, guardian_phone text, permanent_address text, joining_date date, notes text,
    consent boolean
  );
  get diagnostics created = row_count;
  return created;
end;
$$;
