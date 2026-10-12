-- Voiding an invoice and recording a payment on it at the same moment could
-- both succeed: each checked the other's row before either had committed, so
-- a live payment ended up on a void invoice. That money then dropped out of
-- every balance while still counting as collected.
--
-- Recording a payment already serialises on a per-invoice advisory lock.
-- Voiding now takes the same lock before it looks for live payments, so the
-- two run one after the other and the second sees the first: a payment
-- recorded first blocks the void, and a void that wins refuses the payment.

create or replace function private.invoices_guard_update()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if old.status = 'void' then
    raise exception 'This invoice is already void'
      using errcode = 'P0001', hint = 'invoice_void';
  end if;
  if new.status <> 'void' then
    raise exception 'Invoices cannot be edited; void it and generate the month again'
      using errcode = 'P0001', hint = 'invoice_immutable';
  end if;
  -- The same lock payments_guard_insert takes for this invoice.
  perform pg_advisory_xact_lock(hashtextextended('payments:' || old.id::text, 0));
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
