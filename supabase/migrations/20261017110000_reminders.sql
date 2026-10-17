-- Rent reminders and receipts sent by hand (EP-11, manual channel).
--
-- There is no messaging provider yet, so staff send reminders themselves:
-- the app prepares the message and opens WhatsApp (or copies the text), and
-- records that a reminder went out. When a provider is added, its sends are
-- logged here too, with the same columns.
--
-- Rules:
-- - reminder_log is append-only. Members record their own sends; nobody
--   edits or deletes them.
-- - Each hostel may set its own reminder wording; null means the default
--   text built into the app.

alter table public.hostels
  add column reminder_template text,
  add constraint hostels_reminder_template_length
    check (char_length(btrim(reminder_template)) between 1 and 1000);

comment on column public.hostels.reminder_template is
  'Owner-chosen fee reminder text with {name}, {hostel}, {amount} and {due_date} placeholders. Null uses the app default.';

grant update (reminder_template) on public.hostels to authenticated;

create table public.reminder_log (
  id uuid primary key default gen_random_uuid(),
  hostel_id uuid not null references public.hostels (id) on delete cascade,
  resident_id uuid not null,
  -- What was sent: a reminder of money due, or a receipt for a payment.
  kind text not null,
  -- How: WhatsApp opened with the message, or the text copied to send
  -- some other way. Provider channels (sms, email) are reserved.
  channel text not null,
  invoice_id uuid,
  -- What the message said was owed (reminder) or received (receipt), in paise.
  amount integer not null,
  sent_by uuid not null default auth.uid() references public.profiles (id),
  sent_by_name text,
  sent_at timestamptz not null default now(),

  constraint reminder_log_resident_fkey foreign key (hostel_id, resident_id)
    references public.residents (hostel_id, id),
  constraint reminder_log_invoice_fkey foreign key (hostel_id, invoice_id)
    references public.invoices (hostel_id, id),
  constraint reminder_log_kind_valid check (kind in ('due', 'receipt')),
  constraint reminder_log_channel_valid check (channel in ('whatsapp', 'copy', 'sms', 'email')),
  constraint reminder_log_amount_positive check (amount > 0)
);

comment on table public.reminder_log is
  'Append-only record of fee reminders and receipts sent to residents, by whom and how.';

create index reminder_log_resident_idx on public.reminder_log (resident_id, sent_at desc);
create index reminder_log_hostel_idx on public.reminder_log (hostel_id, sent_at desc);

-- Who sent it, snapshotted: staff cannot read the owner's profile.
create or replace function private.reminder_log_guard_insert()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  new.sent_by_name := (select pr.full_name from public.profiles pr where pr.id = new.sent_by);
  new.sent_at := now();
  return new;
end;
$$;

create trigger reminder_log_guard_insert
  before insert on public.reminder_log
  for each row execute function private.reminder_log_guard_insert();

alter table public.reminder_log enable row level security;

revoke all on public.reminder_log from authenticated;
grant select on public.reminder_log to authenticated;
grant insert (hostel_id, resident_id, kind, channel, invoice_id, amount)
  on public.reminder_log to authenticated;

create policy "reminder log: members read"
  on public.reminder_log for select
  to authenticated
  using (hostel_id in (select private.user_hostel_ids()));

create policy "reminder log: members record their own"
  on public.reminder_log for insert
  to authenticated
  with check (hostel_id in (select private.user_hostel_ids()) and sent_by = (select auth.uid()));

-- Latest reminder per resident, for lists that show "last reminded".
create view public.last_reminders with (security_invoker = true) as
select distinct on (l.resident_id)
  l.hostel_id,
  l.resident_id,
  l.sent_at,
  l.channel,
  l.sent_by_name
from public.reminder_log l
where l.kind = 'due'
order by l.resident_id, l.sent_at desc;

revoke all on public.last_reminders from authenticated, anon;
grant select on public.last_reminders to authenticated;
