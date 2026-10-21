"use client";

import { useActionState, useEffect, useState } from "react";

import { HostelField } from "@/components/shell/ActiveHostel";
import { Alert, Button, Input, Modal, Select } from "@/components/ui";
import { formatPaise, paiseToInput } from "@/lib/money";
import { todayIst } from "@/lib/validation";
import { useDialogState } from "@/lib/hooks/useDialogState";
import { initialFormState } from "@/lib/validation/result";

import { recordPayment } from "../actions";
import { RENT_PAYMENT_MODE_OPTIONS } from "../options";

export interface PayableInvoice {
  id: string;
  /** e.g. "October 2026". */
  label: string;
  /** Still to collect, in paise: the balance less any cheque awaiting clearance. */
  balance: number;
}

/**
 * Records money received against an invoice (E7-T4). Partial payments are
 * normal; the amount defaults to what is still due. Anything above it is
 * kept as the resident's advance credit (ClickUp E13-T7); a cheque is
 * recorded as pending until it clears (E13-T11).
 */
export function PaymentDialog({
  residentName,
  invoices,
  triggerLabel = "Record payment",
  size = "md",
  variant = "primary",
}: {
  residentName: string;
  /** Open invoices, oldest first. The first is preselected. */
  invoices: readonly PayableInvoice[];
  triggerLabel?: string;
  size?: "sm" | "md";
  variant?: "primary" | "secondary";
}) {
  const [open, setOpen] = useState(false);
  const [state, action, pending] = useActionState(recordPayment, initialFormState);
  const { shown, formKey } = useDialogState(state, open);
  const [invoiceId, setInvoiceId] = useState(invoices[0]?.id ?? "");
  const [mode, setMode] = useState("");
  const today = todayIst();
  const formId = `payment-${invoices[0]?.id ?? "none"}`;
  const selected = invoices.find((invoice) => invoice.id === invoiceId) ?? invoices[0];

  useEffect(() => {
    if (state.status === "success") setOpen(false);
  }, [state]);

  if (invoices.length === 0) return null;

  return (
    <>
      <Button
        size={size}
        variant={variant}
        onClick={() => {
          // A reopened dialog starts clean, the chosen mode included.
          setMode("");
          setOpen(true);
        }}
        aria-label={`Record payment for ${residentName}`}
      >
        {triggerLabel}
      </Button>
      {state.status === "success" && (
        <span role="status" className="sr-only">
          {state.message}
        </span>
      )}
      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title={`Record a payment from ${residentName}`}
        description="Record money already received. A part payment is fine; the rest stays due."
        footer={
          <>
            <Button variant="secondary" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" form={formId} loading={pending}>
              Record payment
            </Button>
          </>
        }
      >
        <form key={formKey} id={formId} action={action} noValidate className="space-y-4">
          <HostelField />
          {shown.formError && <Alert tone="error">{shown.formError}</Alert>}
          {invoices.length === 1 ? (
            <>
              <input type="hidden" name="invoice_id" value={selected.id} />
              <p className="text-sm text-slate-700">
                Invoice for <span className="font-medium">{selected.label}</span>,{" "}
                {formatPaise(selected.balance)} due.
              </p>
            </>
          ) : (
            <Select
              id={`${formId}-invoice`}
              name="invoice_id"
              label="Invoice"
              options={invoices.map((invoice) => ({
                value: invoice.id,
                label: `${invoice.label}: ${formatPaise(invoice.balance)} due`,
              }))}
              value={invoiceId}
              onChange={(event) => setInvoiceId(event.target.value)}
              required
              error={shown.fieldErrors.invoice_id?.[0]}
            />
          )}
          <Input
            // Remount when the invoice changes so the default follows its balance.
            key={selected.id}
            id={`${formId}-amount`}
            name="amount"
            label="Amount (₹)"
            inputMode="decimal"
            // A typed amount survives a failed submit only for the same invoice.
            defaultValue={
              (shown.values?.invoice_id === selected.id && shown.values?.amount) ||
              paiseToInput(selected.balance)
            }
            required
            hint={
              mode === "cheque"
                ? `Up to ${formatPaise(selected.balance)}.`
                : `${formatPaise(selected.balance)} is due. Anything more is kept as advance credit.`
            }
            error={shown.fieldErrors.amount?.[0]}
          />
          <div className="grid gap-4 sm:grid-cols-2">
            <Input
              id={`${formId}-date`}
              name="paid_at"
              type="date"
              label="Received on"
              max={today}
              defaultValue={shown.values?.paid_at || today}
              required
              error={shown.fieldErrors.paid_at?.[0]}
            />
            <Select
              id={`${formId}-mode`}
              name="mode"
              label="Mode"
              placeholder="Choose a mode"
              options={RENT_PAYMENT_MODE_OPTIONS}
              value={mode || shown.values?.mode || ""}
              onChange={(event) => setMode(event.target.value)}
              required
              error={shown.fieldErrors.mode?.[0]}
            />
          </div>
          {(mode || shown.values?.mode) === "cheque" && (
            <div className="grid gap-4 sm:grid-cols-2">
              <Input
                id={`${formId}-cheque-number`}
                name="cheque_number"
                label="Cheque number"
                inputMode="numeric"
                maxLength={20}
                required
                defaultValue={shown.values?.cheque_number ?? ""}
                error={shown.fieldErrors.cheque_number?.[0]}
              />
              <Input
                id={`${formId}-cheque-bank`}
                name="cheque_bank"
                label="Bank"
                maxLength={100}
                required
                defaultValue={shown.values?.cheque_bank ?? ""}
                error={shown.fieldErrors.cheque_bank?.[0]}
              />
            </div>
          )}
          <Input
            id={`${formId}-reference`}
            name="reference"
            label="Reference"
            defaultValue={shown.values?.reference ?? ""}
            hint="Optional. UPI transaction ID, cheque or receipt number."
            maxLength={100}
            error={shown.fieldErrors.reference?.[0]}
          />
        </form>
      </Modal>
    </>
  );
}
