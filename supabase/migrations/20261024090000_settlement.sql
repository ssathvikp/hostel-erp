-- Move-out settlement (ClickUp E13-T8).
--
-- When a resident leaves, one statement settles everything:
--   - The final month is re-billed for the nights actually held, when its
--     rent invoice was issued for more (an invoice billed while the stay was
--     open runs to month end). This only happens when that invoice has no
--     payments or live late fee: those are voided by the owner first, as
--     anywhere else in the app.
--   - Held advance credit pays what is due.
--   - Deductions (damage, cleaning) come out of the security deposit.
--   - Optionally the deposit pays the remaining dues. Each use is a payment
--     of mode 'deposit' on the invoice and a matching deposit deduction, so
--     both ledgers stay complete and voiding the payment gives it back.
--   - What is left of the deposit and of the credit is refunded.
-- The result is one net figure: a refund to the resident or an amount still
-- owed. The statement is saved as a snapshot, once per stay.

-- ---------------------------------------------------------------------------
-- Payments from the deposit
-- ---------------------------------------------------------------------------
alter table public.payments drop constraint payments_mode_valid;
alter table public.payments
  add constraint payments_mode_valid
    check (mode in ('cash', 'upi', 'bank_transfer', 'card', 'cheque', 'credit', 'deposit'));

create or replace function private.payments_set_cleared()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if new.mode = 'credit' and current_user = 'authenticated' then
    raise exception 'Credit is applied by the app, not recorded by hand'
      using errcode = 'P0001', hint = 'credit_payment_manual';
  end if;
  if new.mode = 'deposit' and current_user = 'authenticated' then
    raise exception 'The deposit is used for dues through the move-out settlement'
      using errcode = 'P0001', hint = 'deposit_payment_manual';
  end if;
  new.cleared_at := case when new.mode = 'cheque' then null else now() end;
  new.cleared_by := null;
  return new;
end;
$$;

alter table public.deposit_entries add column payment_id uuid references public.payments (id);

comment on column public.deposit_entries.payment_id is
  'For a deduction that paid an invoice at move-out: the payment it became.';

create index deposit_entries_payment_idx on public.deposit_entries (payment_id) where payment_id is not null;

-- Such a deduction is voided only with its payment.
create or replace function private.deposit_entries_payment_guard()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if old.payment_id is not null and current_user = 'authenticated' then
    raise exception 'Void the deposit payment on the invoice instead'
      using errcode = 'P0001', hint = 'deposit_applied_void';
  end if;
  return new;
end;
$$;

create trigger deposit_entries_payment_guard
  before update on public.deposit_entries
  for each row execute function private.deposit_entries_payment_guard();

create or replace function private.payments_void_deposit()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.voided_at is not null and old.voided_at is null and new.mode = 'deposit' then
    update public.deposit_entries
       set void_reason = 'Payment voided: ' || new.void_reason
     where payment_id = new.id and voided_at is null;
  end if;
  return null;
end;
$$;

create trigger payments_void_deposit
  after update of void_reason on public.payments
  for each row execute function private.payments_void_deposit();

-- ---------------------------------------------------------------------------
-- One resident's month, billed the way generate_invoices bills it
-- ---------------------------------------------------------------------------
-- Returns the rent, its breakdown and the full lines. With p_write it also
-- issues the invoice (due p_due_date). Callers check access.
create or replace function private.bill_resident_month(
  p_hostel_id uuid,
  p_resident_id uuid,
  p_month_start date,
  p_due_date date,
  p_write boolean
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  month_end date := (p_month_start + interval '1 month - 1 day')::date;
  days integer := month_end - p_month_start + 1;
  cand record;
  v_lines jsonb;
  v_total integer;
  v_id uuid;
begin
  with stays as (
    select
      a.id,
      a.start_date,
      rm.room_number,
      rm.sharing_type,
      b.bed_label,
      greatest(a.start_date, p_month_start) as billed_from,
      least(coalesce(a.end_date, month_end), month_end) as billed_to,
      coalesce(a.rent_override, private.monthly_rate(p_hostel_id, rm.sharing_type, p_month_start)) as rate,
      a.rent_override is not null as overridden
    from public.allocations a
    join public.rooms rm on rm.id = a.room_id
    join public.beds b on b.id = a.bed_id
    where a.hostel_id = p_hostel_id
      and a.resident_id = p_resident_id
      and a.start_date <= month_end
      and (a.end_date is null or a.end_date >= p_month_start)
  )
  select
    count(*) as stays,
    bool_and(s.rate is not null) as priced,
    case
      when bool_and(s.billed_from = p_month_start and s.billed_to = month_end) then sum(s.rate)::integer
      else (round(sum(s.rate::numeric * (s.billed_to - s.billed_from + 1)) / days / 100) * 100)::integer
    end as amount,
    sum(s.billed_to - s.billed_from + 1)::integer as nights,
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
    ) as breakdown
  into cand
  from stays s;

  if cand.stays = 0 or not cand.priced or cand.amount <= 0 then
    return jsonb_build_object('rent', 0, 'nights', coalesce(cand.nights, 0), 'total', 0, 'invoice_id', null);
  end if;
  v_lines := private.month_lines(p_hostel_id, p_resident_id, p_month_start, cand.amount, cand.breakdown);
  select sum((l ->> 'amount')::integer) into v_total from jsonb_array_elements(v_lines) l;
  if p_write and v_total > 0 then
    perform pg_advisory_xact_lock(hashtextextended('charges:' || p_resident_id::text, 0));
    insert into public.invoices
      (hostel_id, resident_id, allocation_id, period_month, amount, due_date, breakdown)
    values (p_hostel_id, p_resident_id, cand.allocation_id, p_month_start, v_total, p_due_date, cand.breakdown)
    returning id into v_id;
    perform private.write_invoice_lines(p_hostel_id, v_id, v_lines);
  end if;
  return jsonb_build_object('rent', cand.amount, 'nights', cand.nights, 'total', v_total, 'invoice_id', v_id);
end;
$$;

revoke all on function private.bill_resident_month(uuid, uuid, date, date, boolean) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Settlements
-- ---------------------------------------------------------------------------
create table public.settlements (
  id uuid primary key default gen_random_uuid(),
  hostel_id uuid not null references public.hostels (id) on delete cascade,
  resident_id uuid not null,
  allocation_id uuid not null,
  -- What was settled, as shown on the statement.
  statement jsonb not null,
  -- Positive: the resident still owes this. Negative: refunded to them.
  net_amount integer not null,
  settled_by uuid not null default auth.uid() references public.profiles (id),
  settled_by_name text,
  settled_at timestamptz not null default now(),

  constraint settlements_resident_fkey foreign key (hostel_id, resident_id)
    references public.residents (hostel_id, id),
  constraint settlements_allocation_fkey foreign key (hostel_id, allocation_id)
    references public.allocations (hostel_id, id),
  constraint settlements_one_per_stay unique (allocation_id)
);

comment on table public.settlements is
  'Move-out settlement statements (E13-T8): one per stay, written by settle_move_out and never edited.';

create index settlements_resident_idx on public.settlements (resident_id);

alter table public.settlements enable row level security;
revoke all on public.settlements from authenticated, anon;
grant select on public.settlements to authenticated;

create policy "settlements: members read" on public.settlements for select to authenticated
  using (hostel_id in (select private.user_hostel_ids()));

-- What settling a stay would do, without writing anything. Members only.
create or replace function private.settlement_preview(p_allocation_id uuid)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  al record;
  v_month date;
  inv record;
  v_billed_rent integer;
  v_correct jsonb;
  v_final jsonb := null;
  v_dues jsonb;
begin
  select a.id, a.hostel_id, a.resident_id, a.start_date, a.end_date, a.vacate_reason into al
    from public.allocations a where a.id = p_allocation_id;
  if not found or al.hostel_id not in (select private.user_hostel_ids()) then
    raise exception 'This stay could not be found' using errcode = 'P0001', hint = 'allocation_not_found';
  end if;
  if al.end_date is null then
    raise exception 'Vacate the bed before settling' using errcode = 'P0001', hint = 'allocation_open';
  end if;
  -- A transfer ends one bed, not the stay: the resident has not left.
  if al.vacate_reason = 'transferred' then
    raise exception 'The resident moved to another bed; settle when they leave'
      using errcode = 'P0001', hint = 'allocation_transferred';
  end if;

  -- The final month's rent invoice, if it billed nights after the stay ended.
  v_month := date_trunc('month', al.end_date)::date;
  select i.id, i.amount, i.due_date, i.invoice_number into inv
    from public.invoices i
   where i.resident_id = al.resident_id and i.period_month = v_month
     and i.kind = 'rent' and i.status = 'issued';
  if found then
    select coalesce(sum(l.amount), 0)::integer into v_billed_rent
      from public.invoice_lines l where l.invoice_id = inv.id and l.kind = 'rent';
    v_correct := private.bill_resident_month(al.hostel_id, al.resident_id, v_month, inv.due_date, false);
    if v_billed_rent > (v_correct ->> 'rent')::integer then
      v_final := jsonb_build_object(
        'invoice_id', inv.id,
        'invoice_number', inv.invoice_number,
        'period_month', v_month,
        'billed_rent', v_billed_rent,
        'rent_for_nights', (v_correct ->> 'rent')::integer,
        'nights', (v_correct ->> 'nights')::integer,
        'can_rebill', not exists (
            select 1 from public.payments p where p.invoice_id = inv.id and p.voided_at is null
          ) and not exists (
            select 1 from public.invoices f
             where f.late_fee_for = inv.id and f.status = 'issued'
          )
      );
    end if;
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
           'invoice_id', b.id,
           'invoice_number', b.invoice_number,
           'period_month', b.period_month,
           'kind', b.kind,
           'balance', b.balance,
           'pending_cheques', b.pending_cheques
         ) order by b.due_date, b.period_month), '[]'::jsonb)
    into v_dues
    from public.invoice_balances b
   where b.resident_id = al.resident_id and b.status = 'issued' and b.balance > 0;

  return jsonb_build_object(
    'allocation_id', al.id,
    'resident_id', al.resident_id,
    'start_date', al.start_date,
    'end_date', al.end_date,
    'final_month', v_final,
    'dues', v_dues,
    'credit_held', private.credit_held(al.resident_id),
    'deposit_held', private.deposit_held(al.resident_id),
    'settled', exists (select 1 from public.settlements s where s.allocation_id = al.id)
  );
end;
$$;

create or replace function public.settlement_preview(p_allocation_id uuid)
returns jsonb
language sql
volatile
security invoker
set search_path = ''
as $$ select private.settlement_preview(p_allocation_id); $$;

revoke all on function private.settlement_preview(uuid) from public, anon;
revoke all on function public.settlement_preview(uuid) from public, anon;
grant execute on function private.settlement_preview(uuid) to authenticated;
grant execute on function public.settlement_preview(uuid) to authenticated;

-- Settles a closed stay in one transaction. Owners only.
--   p_deductions: [{"amount": paise, "reason": text}, ...] from the deposit.
--   p_rebill: re-bill the final month for the nights held, when possible.
--   p_use_deposit: let what is left of the deposit pay the remaining dues.
--   p_refund_mode / p_refund_reference: how any refund is paid out.
create or replace function private.settle_move_out(
  p_allocation_id uuid,
  p_deductions jsonb,
  p_rebill boolean,
  p_use_deposit boolean,
  p_refund_mode text,
  p_refund_reference text
)
returns uuid
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  al record;
  v_preview jsonb;
  v_final jsonb;
  v_today date := private.today_ist();
  v_ref text := nullif(btrim(p_refund_reference), '');
  v_rebilled jsonb := null;
  v_credit_applied integer;
  v_deducted integer := 0;
  v_from_deposit integer := 0;
  v_deposit_refund integer;
  v_credit_refund integer;
  v_owed integer;
  d jsonb;
  due record;
  v_amount integer;
  v_payment uuid;
  v_lines jsonb := '[]'::jsonb;
  v_id uuid;
begin
  select a.id, a.hostel_id, a.resident_id, a.end_date into al
    from public.allocations a where a.id = p_allocation_id;
  if not found or al.hostel_id not in (select private.user_hostel_ids()) then
    raise exception 'This stay could not be found' using errcode = 'P0001', hint = 'allocation_not_found';
  end if;
  if al.hostel_id not in (select private.user_owned_hostel_ids()) then
    raise exception 'Only the hostel owner can settle a move-out' using errcode = '42501', hint = 'not_owner';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('settle:' || al.id::text, 0));
  perform pg_advisory_xact_lock(hashtextextended('deposits:' || al.resident_id::text, 0));
  if exists (select 1 from public.settlements s where s.allocation_id = al.id) then
    raise exception 'This stay is already settled' using errcode = 'P0001', hint = 'already_settled';
  end if;
  if p_refund_mode is not null and p_refund_mode not in ('cash', 'upi', 'bank_transfer', 'card') then
    raise exception 'Choose how the refund is paid' using errcode = 'P0001', hint = 'refund_mode';
  end if;
  if jsonb_typeof(coalesce(p_deductions, '[]'::jsonb)) <> 'array' then
    raise exception 'Deductions must be a list' using errcode = 'P0001', hint = 'deductions_invalid';
  end if;

  v_preview := private.settlement_preview(al.id);
  v_final := v_preview -> 'final_month';

  -- 1. Re-bill the final month for the nights held.
  if p_rebill and v_final is not null and (v_final ->> 'can_rebill')::boolean then
    update public.invoices
       set status = 'void', void_reason = 'Re-billed at move-out for nights held'
     where id = (v_final ->> 'invoice_id')::uuid;
    v_rebilled := private.bill_resident_month(
      al.hostel_id, al.resident_id, (v_final ->> 'period_month')::date,
      (select i.due_date from public.invoices i where i.id = (v_final ->> 'invoice_id')::uuid), true);
    v_rebilled := v_rebilled || jsonb_build_object(
      'voided_invoice_id', v_final ->> 'invoice_id',
      'voided_invoice_number', v_final ->> 'invoice_number',
      'billed_rent', (v_final ->> 'billed_rent')::integer,
      'period_month', v_final ->> 'period_month');
  end if;

  -- 2. Held credit pays dues (the new invoice may already have taken some).
  v_credit_applied := private.apply_credit(al.resident_id);

  -- 3. Deductions from the deposit.
  for d in select * from jsonb_array_elements(coalesce(p_deductions, '[]'::jsonb))
  loop
    v_amount := (d ->> 'amount')::integer;
    if v_amount is null or v_amount <= 0 or nullif(btrim(d ->> 'reason'), '') is null then
      raise exception 'Each deduction needs an amount and a reason'
        using errcode = 'P0001', hint = 'deduction_invalid';
    end if;
    insert into public.deposit_entries
      (hostel_id, resident_id, allocation_id, kind, amount, entry_date, reason)
    values (al.hostel_id, al.resident_id, al.id, 'deduction', v_amount, v_today, btrim(d ->> 'reason'));
    v_deducted := v_deducted + v_amount;
    v_lines := v_lines || jsonb_build_object('amount', v_amount, 'reason', btrim(d ->> 'reason'));
  end loop;

  -- 4. The deposit pays what is still due, oldest first.
  if p_use_deposit then
    for due in
      select b.id, b.invoice_number, b.balance - b.pending_cheques as owed
        from public.invoice_balances b
       where b.resident_id = al.resident_id and b.status = 'issued' and b.balance - b.pending_cheques > 0
       order by b.due_date, b.period_month
    loop
      v_amount := least(due.owed, private.deposit_held(al.resident_id));
      exit when v_amount <= 0;
      insert into public.payments (hostel_id, invoice_id, amount, paid_at, mode, reference)
      values (al.hostel_id, due.id, v_amount, v_today, 'deposit', 'Security deposit')
      returning id into v_payment;
      insert into public.deposit_entries
        (hostel_id, resident_id, allocation_id, kind, amount, entry_date, reason, payment_id)
      values (al.hostel_id, al.resident_id, al.id, 'deduction', v_amount, v_today,
              'Paid invoice ' || due.invoice_number, v_payment);
      v_from_deposit := v_from_deposit + v_amount;
    end loop;
  end if;

  -- 5. Refund what is left.
  v_deposit_refund := private.deposit_held(al.resident_id);
  v_credit_refund := private.credit_held(al.resident_id);
  if (v_deposit_refund > 0 or v_credit_refund > 0) and p_refund_mode is null then
    raise exception 'Choose how the refund is paid' using errcode = 'P0001', hint = 'refund_mode';
  end if;
  if v_deposit_refund > 0 then
    insert into public.deposit_entries
      (hostel_id, resident_id, allocation_id, kind, amount, entry_date, mode, reference)
    values (al.hostel_id, al.resident_id, al.id, 'refund', v_deposit_refund, v_today, p_refund_mode, v_ref);
  end if;
  if v_credit_refund > 0 then
    insert into public.resident_credit_entries
      (hostel_id, resident_id, kind, amount, entry_date, mode, reference)
    values (al.hostel_id, al.resident_id, 'refund', v_credit_refund, v_today, p_refund_mode, v_ref);
  end if;

  select coalesce(sum(b.balance), 0)::integer into v_owed
    from public.invoice_balances b
   where b.resident_id = al.resident_id and b.status = 'issued' and b.balance > 0;

  insert into public.settlements (hostel_id, resident_id, allocation_id, statement, net_amount, settled_by_name)
  values (
    al.hostel_id, al.resident_id, al.id,
    jsonb_build_object(
      'end_date', al.end_date,
      'before', v_preview,
      'rebilled', v_rebilled,
      'credit_applied', v_credit_applied,
      'deductions', v_lines,
      'deducted', v_deducted,
      'paid_from_deposit', v_from_deposit,
      'deposit_refund', v_deposit_refund,
      'credit_refund', v_credit_refund,
      'refund_mode', case when v_deposit_refund + v_credit_refund > 0 then p_refund_mode end,
      'refund_reference', case when v_deposit_refund + v_credit_refund > 0 then v_ref end,
      'still_owed', v_owed
    ),
    case when v_owed > 0 then v_owed else -(v_deposit_refund + v_credit_refund) end,
    (select pr.full_name from public.profiles pr where pr.id = (select auth.uid()))
  )
  returning id into v_id;
  return v_id;
end;
$$;

create or replace function public.settle_move_out(
  p_allocation_id uuid,
  p_deductions jsonb default '[]'::jsonb,
  p_rebill boolean default true,
  p_use_deposit boolean default true,
  p_refund_mode text default null,
  p_refund_reference text default null
)
returns uuid
language sql
volatile
security invoker
set search_path = ''
as $$
  select private.settle_move_out(p_allocation_id, p_deductions, p_rebill, p_use_deposit,
                                 p_refund_mode, p_refund_reference);
$$;

revoke all on function private.settle_move_out(uuid, jsonb, boolean, boolean, text, text) from public, anon;
revoke all on function public.settle_move_out(uuid, jsonb, boolean, boolean, text, text) from public, anon;
grant execute on function private.settle_move_out(uuid, jsonb, boolean, boolean, text, text) to authenticated;
grant execute on function public.settle_move_out(uuid, jsonb, boolean, boolean, text, text) to authenticated;
