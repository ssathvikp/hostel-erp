-- Security deposits (EP-12): money a resident hands over as security, and
-- what happens to it when they leave.
--
-- Rules:
-- - Append-only ledger in integer paise, like payments. Three kinds of
--   entry: collected (money in), deduction (kept by the hostel, with a
--   reason, e.g. damage or unpaid rent) and refund (money back).
-- - What is held is derived, never stored: collected - deductions - refunds
--   over entries that are not void (deposit_balances).
-- - Deductions and refunds can never exceed what is held, and a collection
--   cannot be voided if that would leave less than nothing held. Entries
--   for one resident are serialised on an advisory lock.
-- - Owners and staff record entries; only owners void them, with a reason.

create table public.deposit_entries (
  id uuid primary key default gen_random_uuid(),
  hostel_id uuid not null references public.hostels (id) on delete cascade,
  resident_id uuid not null,
  -- The stay the deposit was taken for, when known.
  allocation_id uuid,
  kind text not null,
  amount integer not null,
  -- The day the money changed hands (or the deduction was decided).
  entry_date date not null,
  -- How money moved. Deductions move no money, so they have no mode.
  mode text,
  reference text,
  reason text,
  recorded_by uuid not null default auth.uid() references public.profiles (id),
  recorded_by_name text,
  voided_at timestamptz,
  void_reason text,
  voided_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),

  constraint deposit_entries_resident_fkey foreign key (hostel_id, resident_id)
    references public.residents (hostel_id, id),
  constraint deposit_entries_allocation_fkey foreign key (hostel_id, allocation_id)
    references public.allocations (hostel_id, id),
  constraint deposit_entries_kind_valid check (kind in ('collected', 'deduction', 'refund')),
  constraint deposit_entries_amount_positive check (amount > 0),
  constraint deposit_entries_mode_valid check (mode in ('cash', 'upi', 'bank_transfer', 'card')),
  constraint deposit_entries_mode_by_kind check ((kind = 'deduction') = (mode is null)),
  constraint deposit_entries_deduction_reason check (kind <> 'deduction' or reason is not null),
  constraint deposit_entries_reference_length check (char_length(btrim(reference)) between 1 and 100),
  constraint deposit_entries_reason_length check (char_length(btrim(reason)) between 1 and 500),
  constraint deposit_entries_void_has_reason check ((voided_at is null) = (void_reason is null)),
  constraint deposit_entries_void_reason_length check (char_length(btrim(void_reason)) between 1 and 500)
);

comment on table public.deposit_entries is
  'Append-only security deposit ledger: collected, deducted and refunded amounts per resident. Voided with a reason, never edited.';

create index deposit_entries_resident_idx on public.deposit_entries (resident_id) where voided_at is null;
create index deposit_entries_hostel_idx on public.deposit_entries (hostel_id, entry_date desc);

-- What a resident's deposit holds right now, from entries that count.
create or replace function private.deposit_held(p_resident_id uuid)
returns integer
language sql
stable
security invoker
set search_path = ''
as $$
  select coalesce(sum(case when d.kind = 'collected' then d.amount else -d.amount end), 0)::integer
  from public.deposit_entries d
  where d.resident_id = p_resident_id and d.voided_at is null;
$$;

grant execute on function private.deposit_held(uuid) to authenticated;

create or replace function private.deposit_entries_guard_insert()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  held integer;
begin
  perform pg_advisory_xact_lock(hashtextextended('deposits:' || new.resident_id::text, 0));

  if current_user = 'authenticated' and new.entry_date > private.today_ist() then
    raise exception 'A deposit entry cannot be dated in the future'
      using errcode = 'P0001', hint = 'deposit_future';
  end if;

  if new.kind in ('deduction', 'refund') then
    held := private.deposit_held(new.resident_id);
    if new.amount > held then
      raise exception 'Only % of the deposit is held',
        '₹' || to_char(held / 100.0, 'FM999999990.00')
        using errcode = 'P0001', hint = 'deposit_exceeds_held';
    end if;
  end if;

  new.recorded_by_name := (select pr.full_name from public.profiles pr where pr.id = new.recorded_by);
  new.voided_at := null;
  new.void_reason := null;
  new.voided_by := null;
  return new;
end;
$$;

create trigger deposit_entries_guard_insert
  before insert on public.deposit_entries
  for each row execute function private.deposit_entries_guard_insert();

-- An entry changes once: when it is voided. Voiding money collected must
-- not leave refunds and deductions greater than what remains.
create or replace function private.deposit_entries_guard_update()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  perform pg_advisory_xact_lock(hashtextextended('deposits:' || old.resident_id::text, 0));
  if old.voided_at is not null then
    raise exception 'This deposit entry is already void'
      using errcode = 'P0001', hint = 'deposit_void';
  end if;
  if new.void_reason is null then
    raise exception 'Deposit entries cannot be edited; void it and record it again'
      using errcode = 'P0001', hint = 'deposit_immutable';
  end if;
  if old.kind = 'collected' and private.deposit_held(old.resident_id) < old.amount then
    raise exception 'Void the refunds or deductions taken from this deposit first'
      using errcode = 'P0001', hint = 'deposit_in_use';
  end if;
  new.voided_at := now();
  new.voided_by := (select auth.uid());
  return new;
end;
$$;

create trigger deposit_entries_guard_update
  before update on public.deposit_entries
  for each row execute function private.deposit_entries_guard_update();

-- ---------------------------------------------------------------------------
-- Derived balances
-- ---------------------------------------------------------------------------
create view public.deposit_balances with (security_invoker = true) as
select
  d.hostel_id,
  d.resident_id,
  sum(d.amount) filter (where d.kind = 'collected')::integer as collected,
  coalesce(sum(d.amount) filter (where d.kind = 'deduction'), 0)::integer as deducted,
  coalesce(sum(d.amount) filter (where d.kind = 'refund'), 0)::integer as refunded,
  sum(case when d.kind = 'collected' then d.amount else -d.amount end)::integer as held
from public.deposit_entries d
where d.voided_at is null
group by d.hostel_id, d.resident_id;

comment on view public.deposit_balances is
  'Per resident: deposit collected, deducted, refunded and still held, from entries that are not void.';

-- ---------------------------------------------------------------------------
-- Privileges and row-level security
-- ---------------------------------------------------------------------------
alter table public.deposit_entries enable row level security;

revoke all on public.deposit_entries from authenticated;
grant select on public.deposit_entries to authenticated;
grant insert (hostel_id, resident_id, allocation_id, kind, amount, entry_date, mode, reference, reason)
  on public.deposit_entries to authenticated;
grant update (void_reason) on public.deposit_entries to authenticated;

revoke all on public.deposit_balances from authenticated, anon;
grant select on public.deposit_balances to authenticated;

create policy "deposit entries: members read"
  on public.deposit_entries for select
  to authenticated
  using (hostel_id in (select private.user_hostel_ids()));

create policy "deposit entries: members record"
  on public.deposit_entries for insert
  to authenticated
  with check (hostel_id in (select private.user_hostel_ids()) and recorded_by = (select auth.uid()));

create policy "deposit entries: owners void"
  on public.deposit_entries for update
  to authenticated
  using (hostel_id in (select private.user_owned_hostel_ids()))
  with check (hostel_id in (select private.user_owned_hostel_ids()));

-- Total held across a hostel, for the dashboard. One number, so it never
-- runs into the API's row cap.
create or replace function public.deposits_held_total(p_hostel_id uuid)
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
  select jsonb_build_object(
    'held', coalesce(sum(b.held), 0)::integer,
    'residents', count(*) filter (where b.held > 0)::integer
  )
  from public.deposit_balances b
  where b.hostel_id = p_hostel_id;
$$;

revoke execute on function public.deposits_held_total(uuid) from public, anon;
grant execute on function public.deposits_held_total(uuid) to authenticated;
