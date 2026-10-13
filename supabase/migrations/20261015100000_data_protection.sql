-- Data export, erasure and account closure under the DPDP Act 2023 (E10-T10).
--
-- Export: an owner downloads everything stored about one of their hostels
-- in one JSON file. Erasure: an owner erases a resident who has left; their
-- personal fields and ID proof go, and the financial records the law
-- requires stay (amounts, dates, invoice and receipt numbers), now pointing
-- at "Erased resident". Closure: an owner asks for their account to be
-- closed; it is scheduled after the notice period in docs/data-protection.md
-- so a final export can be taken, and carried out by an operator.
-- Every request is recorded in data_requests.

set check_function_bodies = off;

-- ---------------------------------------------------------------------------
-- Requests
-- ---------------------------------------------------------------------------
create table public.data_requests (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.profiles (id) on delete cascade,
  hostel_id uuid references public.hostels (id) on delete cascade,
  resident_id uuid,
  kind text not null,
  status text not null,
  reason text,
  requested_by uuid default auth.uid() references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  scheduled_for date,
  completed_at timestamptz,

  constraint data_requests_kind_valid check (kind in ('export', 'erasure', 'account_closure')),
  constraint data_requests_status_valid check (status in ('done', 'scheduled', 'cancelled')),
  constraint data_requests_reason_length check (char_length(reason) <= 500),
  constraint data_requests_scheduled check ((status = 'scheduled') = (scheduled_for is not null and completed_at is null))
);

comment on table public.data_requests is
  'Data protection requests: exports, resident erasures and account closures, with when they were done.';

create index data_requests_owner_idx on public.data_requests (owner_id, created_at desc);
create unique index data_requests_one_open_closure
  on public.data_requests (owner_id) where kind = 'account_closure' and status = 'scheduled';

-- ---------------------------------------------------------------------------
-- Export
-- ---------------------------------------------------------------------------
-- Runs as the owner: RLS decides what is returned. The keyed ID hash is left
-- out; it identifies nobody without the app's secret and is no use outside.
create or replace function public.export_hostel_data(p_hostel_id uuid)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  result jsonb;
begin
  if p_hostel_id is null or p_hostel_id not in (select private.user_owned_hostel_ids()) then
    raise exception 'You do not have permission to do that' using errcode = '42501';
  end if;

  select jsonb_build_object(
    'exported_at', now(),
    'format', 'Hostel ERP export, version 1',
    'hostel', (select to_jsonb(h) from public.hostels h where h.id = p_hostel_id),
    'rooms', coalesce((select jsonb_agg(to_jsonb(t) order by t.room_number) from public.rooms t where t.hostel_id = p_hostel_id), '[]'),
    'beds', coalesce((select jsonb_agg(to_jsonb(t) order by t.bed_label) from public.beds t where t.hostel_id = p_hostel_id), '[]'),
    'residents', coalesce((select jsonb_agg(to_jsonb(t) - 'id_proof_hash' order by t.created_at) from public.residents t where t.hostel_id = p_hostel_id), '[]'),
    'allocations', coalesce((select jsonb_agg(to_jsonb(t) order by t.start_date) from public.allocations t where t.hostel_id = p_hostel_id), '[]'),
    'allocation_events', coalesce((select jsonb_agg(to_jsonb(t) order by t.created_at) from public.allocation_events t where t.hostel_id = p_hostel_id), '[]'),
    'fee_structures', coalesce((select jsonb_agg(to_jsonb(t)) from public.fee_structures t where t.hostel_id = p_hostel_id), '[]'),
    'fee_heads', coalesce((select jsonb_agg(to_jsonb(t)) from public.fee_heads t where t.hostel_id = p_hostel_id), '[]'),
    'fee_head_rates', coalesce((select jsonb_agg(to_jsonb(t)) from public.fee_head_rates t where t.hostel_id = p_hostel_id), '[]'),
    'invoices', coalesce((select jsonb_agg(to_jsonb(t) order by t.period_month) from public.invoices t where t.hostel_id = p_hostel_id), '[]'),
    'invoice_lines', coalesce((select jsonb_agg(to_jsonb(t)) from public.invoice_lines t where t.hostel_id = p_hostel_id), '[]'),
    'payments', coalesce((select jsonb_agg(to_jsonb(t) order by t.paid_at) from public.payments t where t.hostel_id = p_hostel_id), '[]'),
    'resident_charges', coalesce((select jsonb_agg(to_jsonb(t)) from public.resident_charges t where t.hostel_id = p_hostel_id), '[]'),
    'discounts', coalesce((select jsonb_agg(to_jsonb(t)) from public.discounts t where t.hostel_id = p_hostel_id), '[]'),
    'resident_credit', coalesce((select jsonb_agg(to_jsonb(t)) from public.resident_credit t where t.hostel_id = p_hostel_id), '[]'),
    'deposit_ledger', coalesce((select jsonb_agg(to_jsonb(t)) from public.deposit_ledger t where t.hostel_id = p_hostel_id), '[]'),
    'meter_readings', coalesce((select jsonb_agg(to_jsonb(t)) from public.meter_readings t where t.hostel_id = p_hostel_id), '[]'),
    'complaints', coalesce((select jsonb_agg(to_jsonb(t) order by t.number) from public.complaints t where t.hostel_id = p_hostel_id), '[]'),
    'complaint_events', coalesce((select jsonb_agg(to_jsonb(t) order by t.id) from public.complaint_events t where t.hostel_id = p_hostel_id), '[]'),
    'workers', coalesce((select jsonb_agg(to_jsonb(w)) from public.workers w
                          join public.worker_hostels wh on wh.worker_id = w.id and wh.hostel_id = p_hostel_id), '[]'),
    'vendor_payouts', coalesce((select jsonb_agg(to_jsonb(t)) from public.vendor_payouts t where t.hostel_id = p_hostel_id), '[]')
  ) into result;

  perform private.record_data_request('export', p_hostel_id, null, null);
  return result;
end;
$$;

create or replace function private.record_data_request(
  p_kind text,
  p_hostel_id uuid,
  p_resident_id uuid,
  p_reason text
)
returns void
language sql
security definer
set search_path = ''
as $$
  insert into public.data_requests (owner_id, hostel_id, resident_id, kind, status, reason, completed_at)
  select h.owner_id, h.id, p_resident_id, p_kind, 'done', p_reason, now()
    from public.hostels h where h.id = p_hostel_id;
$$;

-- ---------------------------------------------------------------------------
-- Erasure of a resident
-- ---------------------------------------------------------------------------
alter table public.residents add column erased_at timestamptz;

alter table public.residents
  alter column phone drop not null,
  alter column gender drop not null,
  alter column dob drop not null,
  alter column id_proof_type drop not null,
  alter column id_proof_last4 drop not null,
  alter column id_proof_hash drop not null,
  alter column permanent_address drop not null,
  -- Personal fields may be empty only once the resident has been erased.
  add constraint residents_complete_unless_erased check (
    erased_at is not null
    or (phone is not null and gender is not null and dob is not null and id_proof_type is not null
        and id_proof_last4 is not null and id_proof_hash is not null and permanent_address is not null)
  );

-- An erased resident cannot be edited back into existence.
create or replace function private.residents_guard_erased()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if old.erased_at is not null then
    raise exception 'This resident has been erased' using errcode = 'P0001', hint = 'resident_erased';
  end if;
  return new;
end;
$$;

create trigger residents_guard_erased
  before update on public.residents
  for each row execute function private.residents_guard_erased();

-- Owners only. The resident must have left: status vacated and no current
-- or future stay. Returns the ID proof file to delete, if there was one.
create or replace function public.erase_resident(p_resident_id uuid, p_reason text)
returns text
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if not exists (
    select 1 from public.residents r
     where r.id = p_resident_id and r.hostel_id in (select private.user_owned_hostel_ids())
  ) then
    raise exception 'You do not have permission to do that' using errcode = '42501';
  end if;
  return private.erase_resident(p_resident_id, p_reason);
end;
$$;

create or replace function private.erase_resident(p_resident_id uuid, p_reason text)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  r record;
  reason text := private.require_reason(p_reason);
begin
  select rs.id, rs.hostel_id, rs.status, rs.erased_at, rs.id_proof_path into r
    from public.residents rs where rs.id = p_resident_id for update;
  if r.erased_at is not null then
    raise exception 'This resident has already been erased' using errcode = 'P0001', hint = 'resident_erased';
  end if;
  if r.status <> 'vacated' or exists (
    select 1 from public.allocations a
     where a.resident_id = r.id and (a.end_date is null or a.end_date >= private.today_ist())
  ) then
    raise exception 'Only a resident who has left can be erased'
      using errcode = 'P0001', hint = 'resident_not_vacated';
  end if;

  -- The guard trigger lets this one update through: erased_at is still null.
  update public.residents
     set full_name = 'Erased resident',
         phone = null, alt_phone = null, email = null, gender = null, dob = null,
         id_proof_type = null, id_proof_last4 = null, id_proof_hash = null, id_proof_path = null,
         guardian_name = null, guardian_phone = null, permanent_address = null, notes = null,
         erased_at = now()
   where id = r.id;

  perform private.record_data_request('erasure', r.hostel_id, r.id, reason);
  return r.id_proof_path;
end;
$$;

-- ---------------------------------------------------------------------------
-- Account closure
-- ---------------------------------------------------------------------------
-- Days between an owner's request and closure, for a final export.
create or replace function private.closure_notice_days()
returns integer
language sql
immutable
set search_path = ''
as $$
  select 30;
$$;

create or replace function public.request_account_closure(p_reason text default null)
returns date
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if (select private.current_user_role()) is distinct from 'owner' then
    raise exception 'You do not have permission to do that' using errcode = '42501';
  end if;
  return private.request_account_closure(p_reason);
end;
$$;

create or replace function private.request_account_closure(p_reason text)
returns date
language plpgsql
security definer
set search_path = ''
as $$
declare
  due date := private.today_ist() + private.closure_notice_days();
begin
  insert into public.data_requests (owner_id, kind, status, reason, scheduled_for)
  values (auth.uid(), 'account_closure', 'scheduled', nullif(left(btrim(p_reason), 500), ''), due);
  return due;
exception when unique_violation then
  raise exception 'Closing your account is already scheduled'
    using errcode = 'P0001', hint = 'closure_scheduled';
end;
$$;

create or replace function public.cancel_account_closure()
returns void
language sql
security invoker
set search_path = ''
as $$
  select private.cancel_account_closure();
$$;

create or replace function private.cancel_account_closure()
returns void
language sql
security definer
set search_path = ''
as $$
  update public.data_requests
     set status = 'cancelled', scheduled_for = null
   where owner_id = auth.uid() and kind = 'account_closure' and status = 'scheduled';
$$;

-- Admins: every request, newest first, and scheduled closures that are due.
create or replace function public.admin_data_requests(p_page integer default 1)
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
  select private.admin_data_requests(p_page);
$$;

create or replace function private.admin_data_requests(p_page integer)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  page_size constant integer := 50;
  result jsonb;
begin
  perform private.require_platform_admin();
  select jsonb_build_object(
    'total', (select count(*) from public.data_requests),
    'rows', coalesce((
      select jsonb_agg(to_jsonb(x) order by x.created_at desc)
        from (select d.id, d.kind, d.status, d.reason, d.created_at, d.scheduled_for, d.completed_at,
                     d.owner_id, u.email as owner_email, h.name as hostel_name
                from public.data_requests d
                join auth.users u on u.id = d.owner_id
                left join public.hostels h on h.id = d.hostel_id
               order by (d.status = 'scheduled') desc, d.created_at desc
               limit page_size offset (greatest(coalesce(p_page, 1), 1) - 1) * page_size) x
    ), '[]'::jsonb)
  ) into result;
  return result;
end;
$$;

-- An operator records that a closure has been carried out
-- (docs/data-protection.md).
create or replace function public.admin_complete_closure(p_request_id uuid, p_reason text)
returns void
language sql
security invoker
set search_path = ''
as $$
  select private.admin_complete_closure(p_request_id, p_reason);
$$;

create or replace function private.admin_complete_closure(p_request_id uuid, p_reason text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  reason text;
  request record;
begin
  perform private.require_platform_admin();
  reason := private.require_reason(p_reason);
  update public.data_requests
     set status = 'done', scheduled_for = null, completed_at = now()
   where id = p_request_id and kind = 'account_closure' and status = 'scheduled'
  returning owner_id into request;
  if request.owner_id is null then
    raise exception 'Not found' using errcode = 'P0001', hint = 'request_not_found';
  end if;
  perform private.admin_log('complete_closure', reason, null, request.owner_id);
end;
$$;

-- ---------------------------------------------------------------------------
-- Privileges and row-level security
-- ---------------------------------------------------------------------------
alter table public.data_requests enable row level security;
revoke all on public.data_requests from authenticated, anon;
grant select on public.data_requests to authenticated;
create policy "data requests: owners read their own"
  on public.data_requests for select to authenticated
  using (owner_id = (select auth.uid()));

revoke all on function private.record_data_request(text, uuid, uuid, text),
  private.residents_guard_erased(), private.erase_resident(uuid, text),
  private.closure_notice_days(), private.request_account_closure(text),
  private.cancel_account_closure(), private.admin_data_requests(integer),
  private.admin_complete_closure(uuid, text) from public;
grant execute on function private.record_data_request(text, uuid, uuid, text),
  private.erase_resident(uuid, text), private.closure_notice_days(),
  private.request_account_closure(text), private.cancel_account_closure(),
  private.admin_data_requests(integer), private.admin_complete_closure(uuid, text) to authenticated;

revoke execute on function public.export_hostel_data(uuid), public.erase_resident(uuid, text),
  public.request_account_closure(text), public.cancel_account_closure(),
  public.admin_data_requests(integer), public.admin_complete_closure(uuid, text) from public, anon;
grant execute on function public.export_hostel_data(uuid), public.erase_resident(uuid, text),
  public.request_account_closure(text), public.cancel_account_closure(),
  public.admin_data_requests(integer), public.admin_complete_closure(uuid, text) to authenticated;
