-- Fixes from the full-repository review (docs/review-fixes.md). Each
-- section names the problem it closes. Earlier migrations are not edited.

-- ---------------------------------------------------------------------------
-- 6. Voiding an invoice while a payment is being recorded on it
-- ---------------------------------------------------------------------------
-- payments_guard_insert serialises payments on an advisory lock per invoice,
-- but voiding did not take it. A void and a payment committing at the same
-- moment could each miss the other, leaving a live payment on a void
-- invoice (money that then vanishes from every balance). The void now takes
-- the same lock, so one of the two always sees the other.
create or replace function private.invoices_guard_update()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  perform pg_advisory_xact_lock(hashtextextended('payments:' || old.id::text, 0));
  if old.status = 'void' then
    raise exception 'This invoice is already void'
      using errcode = 'P0001', hint = 'invoice_void';
  end if;
  if new.status <> 'void' then
    raise exception 'Invoices cannot be edited; void it and generate the month again'
      using errcode = 'P0001', hint = 'invoice_immutable';
  end if;
  -- A fresh statement after the lock, so a payment committed while we
  -- waited is seen.
  if exists (
    select 1 from public.payments p where p.invoice_id = old.id and p.voided_at is null
  ) then
    raise exception 'This invoice has payments recorded against it'
      using errcode = 'P0001', hint = 'invoice_has_payments';
  end if;
  new.voided_at := now();
  new.voided_by := (select auth.uid());
  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- 7. Erasing a resident before their last stay is billed
-- ---------------------------------------------------------------------------
-- "Owes nothing" only looked at invoices already issued. A resident who
-- left on the 10th could be erased on the 12th, and billing that month on
-- the 15th then created an invoice for a person with no contact details.
--
-- erase_resident now also refuses while any month the resident held a
-- priced bed, from the hostel's first billed month on, has no issued
-- invoice. (Months before the hostel started billing in the app are not
-- held against anyone.) generate_invoices skips erased residents as a
-- safety net.
create or replace function private.erase_resident(p_resident_id uuid, p_reason text)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  r record;
  first_billed date;
  unbilled date;
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
    select 1 from public.allocations a
     where a.resident_id = r.id and (a.end_date is null or a.end_date >= private.today_ist())
  ) then
    raise exception 'Only residents who have left can be erased'
      using errcode = 'P0001', hint = 'erase_not_vacated';
  end if;

  select min(i.period_month) into first_billed
    from public.invoices i where i.hostel_id = r.hostel_id;
  if first_billed is not null then
    select m::date into unbilled
      from public.allocations a
      join public.rooms rm on rm.id = a.room_id
      cross join lateral generate_series(
        date_trunc('month', greatest(a.start_date, first_billed)),
        date_trunc('month', a.end_date),
        interval '1 month'
      ) as m
     where a.resident_id = r.id
       and a.end_date >= first_billed
       and coalesce(a.rent_override, private.monthly_rate(r.hostel_id, rm.sharing_type, m::date)) > 0
       and not exists (
         select 1 from public.invoices i
          where i.resident_id = r.id and i.period_month = m::date and i.status = 'issued'
       )
     order by m
     limit 1;
    if unbilled is not null then
      raise exception 'Bill % first', to_char(unbilled, 'FMMonth YYYY')
        using errcode = 'P0001', hint = 'erase_month_unbilled';
    end if;
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

-- Unchanged from 20261012100000 except the erased-resident filter in stays.
create or replace function public.generate_invoices(
  p_hostel_id uuid,
  p_period_month date,
  p_due_day integer default 5
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  month_start date := date_trunc('month', p_period_month)::date;
  month_end date := (date_trunc('month', p_period_month) + interval '1 month - 1 day')::date;
  days integer;
  result jsonb;
begin
  if p_period_month is null or p_period_month <> month_start then
    raise exception 'Choose a billing month' using errcode = 'P0001', hint = 'billing_month';
  end if;
  if month_start > date_trunc('month', private.today_ist())::date then
    raise exception 'A future month cannot be billed yet'
      using errcode = 'P0001', hint = 'billing_month_future';
  end if;
  if p_due_day is null or p_due_day not between 1 and 28 then
    raise exception 'Choose a due day between 1 and 28' using errcode = 'P0001', hint = 'due_day';
  end if;
  if not exists (select 1 from public.hostels h where h.id = p_hostel_id) then
    raise exception 'Hostel not found' using errcode = 'P0001', hint = 'hostel_not_found';
  end if;
  days := month_end - month_start + 1;

  with stays as (
    select
      a.id,
      a.resident_id,
      a.start_date,
      rm.room_number,
      rm.sharing_type,
      b.bed_label,
      greatest(a.start_date, month_start) as billed_from,
      least(coalesce(a.end_date, month_end), month_end) as billed_to,
      coalesce(a.rent_override, private.monthly_rate(p_hostel_id, rm.sharing_type, month_start))
        as rate,
      a.rent_override is not null as overridden
    from public.allocations a
    join public.rooms rm on rm.id = a.room_id
    join public.beds b on b.id = a.bed_id
    -- Erased residents can no longer be contacted or billed.
    join public.residents re on re.id = a.resident_id and re.erased_at is null
    where a.hostel_id = p_hostel_id
      and a.start_date <= month_end
      and (a.end_date is null or a.end_date >= month_start)
  ),
  candidates as (
    select
      s.resident_id,
      bool_and(s.rate is not null) as priced,
      -- Whole months bill the exact rate; part months round to the rupee.
      case
        when bool_and(s.billed_from = month_start and s.billed_to = month_end)
          then sum(s.rate)::integer
        else (round(sum(s.rate::numeric * (s.billed_to - s.billed_from + 1)) / days / 100) * 100)::integer
      end as amount,
      (array_agg(s.id order by s.start_date desc))[1] as allocation_id,
      jsonb_agg(
        jsonb_build_object(
          'allocation_id', s.id,
          'room_number', s.room_number,
          'bed_label', s.bed_label,
          'sharing_type', s.sharing_type,
          'from', s.billed_from,
          'to', s.billed_to,
          'nights', s.billed_to - s.billed_from + 1,
          'monthly_rate', s.rate,
          'rate_source', case when s.overridden then 'override' else 'structure' end
        )
        order by s.start_date
      ) as breakdown,
      exists (
        select 1 from public.invoices i
         where i.resident_id = s.resident_id
           and i.period_month = month_start
           and i.status = 'issued'
      ) as already_invoiced
    from stays s
    group by s.resident_id
  ),
  inserted as (
    insert into public.invoices
      (hostel_id, resident_id, allocation_id, period_month, amount, due_date, breakdown)
    select p_hostel_id, c.resident_id, c.allocation_id, month_start, c.amount,
           month_start + (p_due_day - 1), c.breakdown
      from candidates c
     where c.priced and not c.already_invoiced and c.amount > 0
    on conflict (resident_id, period_month) where status = 'issued' do nothing
    returning resident_id, amount
  )
  select jsonb_build_object(
    'period_month', month_start,
    'created', (select count(*) from inserted),
    'total_amount', (select coalesce(sum(amount), 0) from inserted),
    'already_invoiced',
      (select count(*) from candidates c where c.priced and c.amount > 0)
        - (select count(*) from inserted),
    'unpriced', (
      select coalesce(
        jsonb_agg(
          jsonb_build_object('resident_id', r.id, 'full_name', r.full_name)
          order by r.full_name
        ),
        '[]'::jsonb
      )
      from candidates c
      join public.residents r on r.id = c.resident_id
      where not c.priced and not c.already_invoiced
    )
  ) into result;

  return result;
end;
$$;

-- ---------------------------------------------------------------------------
-- 8. Erased residents and cross-resident references in the newer tables
-- ---------------------------------------------------------------------------
-- An erased resident's record is closed: no new deposits or reminders.
-- And a deposit's stay, or a reminder's invoice, must be that resident's
-- own (the composite keys only checked the hostel).
create or replace function private.resident_open_for_records(p_resident_id uuid)
returns void
language plpgsql
stable
security invoker
set search_path = ''
as $$
begin
  if exists (
    select 1 from public.residents r where r.id = p_resident_id and r.erased_at is not null
  ) then
    raise exception 'This resident''s details were erased'
      using errcode = 'P0001', hint = 'resident_erased';
  end if;
end;
$$;

grant execute on function private.resident_open_for_records(uuid) to authenticated;

-- One function per table: PL/pgSQL fails on a NEW field the table lacks,
-- even inside a branch that would not run.
create or replace function private.deposit_entries_refs_guard()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  perform private.resident_open_for_records(new.resident_id);
  if new.allocation_id is not null and not exists (
    select 1 from public.allocations a
     where a.id = new.allocation_id and a.resident_id = new.resident_id
  ) then
    raise exception 'That stay belongs to another resident'
      using errcode = 'P0001', hint = 'reference_other_resident';
  end if;
  return new;
end;
$$;

create or replace function private.reminder_log_refs_guard()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  perform private.resident_open_for_records(new.resident_id);
  if new.invoice_id is not null and not exists (
    select 1 from public.invoices i
     where i.id = new.invoice_id and i.resident_id = new.resident_id
  ) then
    raise exception 'That invoice belongs to another resident'
      using errcode = 'P0001', hint = 'reference_other_resident';
  end if;
  return new;
end;
$$;

create trigger deposit_entries_refs_guard
  before insert on public.deposit_entries
  for each row execute function private.deposit_entries_refs_guard();

create trigger reminder_log_refs_guard
  before insert on public.reminder_log
  for each row execute function private.reminder_log_refs_guard();

-- ---------------------------------------------------------------------------
-- 9. Deposit totals overflowed above about ₹2.15 crore
-- ---------------------------------------------------------------------------
-- Sums of integer paise were cast back to integer. They are bigint now,
-- and a single entry is capped at ₹10 lakh, the same as the form.
alter table public.deposit_entries
  add constraint deposit_entries_amount_max check (amount <= 100000000);

drop function private.deposit_held(uuid);
create function private.deposit_held(p_resident_id uuid)
returns bigint
language sql
stable
security invoker
set search_path = ''
as $$
  select coalesce(sum(case when d.kind = 'collected' then d.amount else -d.amount end), 0)::bigint
  from public.deposit_entries d
  where d.resident_id = p_resident_id and d.voided_at is null;
$$;
grant execute on function private.deposit_held(uuid) to authenticated;

drop view public.deposit_balances;
create view public.deposit_balances with (security_invoker = true) as
select
  d.hostel_id,
  d.resident_id,
  coalesce(sum(d.amount) filter (where d.kind = 'collected'), 0)::bigint as collected,
  coalesce(sum(d.amount) filter (where d.kind = 'deduction'), 0)::bigint as deducted,
  coalesce(sum(d.amount) filter (where d.kind = 'refund'), 0)::bigint as refunded,
  sum(case when d.kind = 'collected' then d.amount else -d.amount end)::bigint as held
from public.deposit_entries d
where d.voided_at is null
group by d.hostel_id, d.resident_id;

comment on view public.deposit_balances is
  'Per resident: deposit collected, deducted, refunded and still held, from entries that are not void.';
revoke all on public.deposit_balances from authenticated, anon;
grant select on public.deposit_balances to authenticated;

-- The insert guard kept what is held in an integer variable; same overflow.
create or replace function private.deposit_entries_guard_insert()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  held bigint;
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
        '₹' || to_char(held / 100.0, 'FM999999999990.00')
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

create or replace function public.deposits_held_total(p_hostel_id uuid)
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
  select jsonb_build_object(
    'held', coalesce(sum(b.held), 0)::bigint,
    'residents', count(*) filter (where b.held > 0)::integer
  )
  from public.deposit_balances b
  where b.hostel_id = p_hostel_id;
$$;

-- ---------------------------------------------------------------------------
-- 10. Races between allocating a bed and changing the room or resident
-- ---------------------------------------------------------------------------
-- allocate_bed holds a share lock on the bed. Archiving or shrinking a room
-- checked occupancy before waiting for that lock, so an allocation
-- committing meanwhile was missed and its bed retired. Both paths now lock
-- the room's beds first, then check in a fresh statement.
create or replace function private.rooms_guard_update()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if old.status = 'archived' then
    raise exception 'Room % is archived', old.room_number
      using errcode = 'P0001', hint = 'room_archived';
  end if;
  if new.status = 'archived' and old.status = 'active' then
    perform 1 from public.beds b where b.room_id = old.id and b.archived_at is null for update;
    if exists (
      select 1 from public.beds b
      where b.room_id = old.id and b.archived_at is null and private.bed_is_occupied(b.id)
    ) then
      raise exception 'Room % has occupied beds', old.room_number
        using errcode = 'P0001', hint = 'room_occupied';
    end if;
  end if;
  return new;
end;
$$;

create or replace function private.sync_room_beds(p_room_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  room public.rooms%rowtype;
  target integer;
  active_count integer;
  label_count integer;
  changed integer;
begin
  select * into room from public.rooms where id = p_room_id for update;
  if not found then
    return;
  end if;

  target := case when room.status = 'archived' then 0 else room.capacity end;
  select count(*) filter (where archived_at is null), count(*)
    into active_count, label_count
    from public.beds where room_id = room.id;

  if active_count < target then
    with restored as (
      select id from public.beds
      where room_id = room.id and archived_at is not null
      order by bed_label
      limit target - active_count
      for update
    )
    update public.beds b
       set archived_at = null, status = 'available', status_reason = null
      from restored
     where b.id = restored.id;
    get diagnostics changed = row_count;
    active_count := active_count + changed;

    if active_count < target then
      insert into public.beds (hostel_id, room_id, bed_label)
      select room.hostel_id, room.id, room.room_number || '-' || chr(ascii('A') + label_count + n)
        from generate_series(0, target - active_count - 1) as n
      on conflict (room_id, bed_label) do nothing;
    end if;

  elsif active_count > target then
    -- Wait for any allocation in progress on these beds, then decide which
    -- are vacant in a statement that sees it.
    perform 1 from public.beds where room_id = room.id and archived_at is null for update;
    with retiring as (
      select id from public.beds
      where room_id = room.id and archived_at is null
        and not private.bed_is_occupied(id)
      order by bed_label desc
      limit active_count - target
    )
    update public.beds b
       set archived_at = now()
      from retiring
     where b.id = retiring.id;
    get diagnostics changed = row_count;

    if changed < active_count - target then
      raise exception 'Room % has occupied beds that would be removed', room.room_number
        using errcode = 'P0001', hint = 'room_beds_occupied';
    end if;
  end if;

  select count(*) into active_count
    from public.beds where room_id = room.id and archived_at is null;
  if active_count <> target then
    raise exception 'Room % has % active beds but needs %', room.room_number, active_count, target
      using errcode = 'P0001', hint = 'room_beds_mismatch';
  end if;
end;
$$;

-- A resident marked vacated or blocked at the same moment as being given a
-- bed: the status change checked for a live allocation, the allocation
-- checked the status, and neither saw the other. The allocation now locks
-- the resident row (the status change takes the same lock), so the second
-- one waits and then sees the first.
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
  perform 1 from public.residents r where r.id = new.resident_id for no key update;
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

-- ---------------------------------------------------------------------------
-- 11. The new-hostel trial rule never ran
-- ---------------------------------------------------------------------------
-- As SECURITY DEFINER, current_user was always the function owner, so the
-- "signed-in users always start on a trial" branch was dead code. Column
-- grants happened to keep plan out of users' reach; the trigger now
-- enforces it too.
create or replace function private.hostels_start_trial()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if current_user = 'authenticated' then
    new.plan := 'trial';
    new.trial_ends_at := null;
    new.suspension_reason := null;
  end if;
  if new.plan = 'trial' and new.trial_ends_at is null then
    new.trial_ends_at := private.today_ist() + 90;
  end if;
  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- 12. A suspended hostel's owner could still edit its details
-- ---------------------------------------------------------------------------
drop policy "hostels: owners update" on public.hostels;
create policy "hostels: owners update"
  on public.hostels for update
  to authenticated
  using (owner_id = (select auth.uid()) and status <> 'suspended')
  with check (owner_id = (select auth.uid()));

-- ---------------------------------------------------------------------------
-- 13. The fee month filter listed months with only void invoices
-- ---------------------------------------------------------------------------
create or replace function public.billed_months(p_hostel_id uuid)
returns setof date
language sql
stable
security invoker
set search_path = ''
as $$
  select distinct i.period_month
    from public.invoices i
   where i.hostel_id = p_hostel_id and i.status = 'issued'
   order by i.period_month desc;
$$;
