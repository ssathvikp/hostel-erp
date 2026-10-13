"use client";

import { useActionState, useEffect, useState } from "react";

import { Alert, Button, Checkbox, Input, Modal, Select } from "@/components/ui";
import { formatPaise, paiseToInput } from "@/lib/money";
import { todayIst } from "@/lib/validation";
import { initialFormState } from "@/lib/validation/result";

import { recordPayment } from "../actions";
import { INVOICE_PAYMENT_MODE_OPTIONS } from "../options";

export interface PayableInvoice {
  id: string;
  /** e.g. "October 2026". */
  label: string;
  /** Still due and not covered by a pending cheque, in paise. */
  balance: number;
}

/**
 * Records money received against an invoice (E7-T4). Partial payments are
 * normal; the amount defaults to what is still due. A cheque (E13-T11) also
 * takes its bank and stays pending until the owner marks it cleared.
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
  const [invoiceId, setInvoiceId] = useState(invoices[0]?.id ?? "");
  const [mode, setMode] = useState(state.values?.mode ?? "");
  const cheque = mode === "cheque";
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
        onClick={() => setOpen(true)}
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
        <form key={state.id} id={formId} action={action} noValidate className="space-y-4">
          {state.formError && <Alert tone="error">{state.formError}</Alert>}
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
              error={state.fieldErrors.invoice_id?.[0]}
            />
          )}
          <Input
            // Remount when the invoice changes so the default follows its balance.
            key={selected.id}
            id={`${formId}-amount`}
            name="amount"
            label="Amount (₹)"
            inputMode="decimal"
            defaultValue={state.values?.amount || paiseToInput(selected.balance)}
            required
            hint={`${formatPaise(selected.balance)} is due.`}
            error={state.fieldErrors.amount?.[0]}
          />
          <div className="grid gap-4 sm:grid-cols-2">
            <Input
              id={`${formId}-date`}
              name="paid_at"
              type="date"
              label="Received on"
              max={today}
              defaultValue={state.values?.paid_at || today}
              required
              error={state.fieldErrors.paid_at?.[0]}
            />
            <Select
              id={`${formId}-mode`}
              name="mode"
              label="Mode"
              placeholder="Choose a mode"
              options={INVOICE_PAYMENT_MODE_OPTIONS}
              value={mode}
              onChange={(event) => setMode(event.target.value)}
              required
              error={state.fieldErrors.mode?.[0]}
            />
          </div>
          {cheque ? (
            <div className="grid gap-4 sm:grid-cols-2">
              <Input
                id={`${formId}-reference`}
                name="reference"
                label="Cheque number"
                defaultValue={state.values?.reference ?? ""}
                required
                maxLength={100}
                error={state.fieldErrors.reference?.[0]}
              />
              <Input
                id={`${formId}-bank`}
                name="cheque_bank"
                label="Bank"
                defaultValue={state.values?.cheque_bank ?? ""}
                required
                maxLength={100}
                error={state.fieldErrors.cheque_bank?.[0]}
              />
              <p className="text-sm text-slate-600 sm:col-span-2">
                The cheque stays pending, and the balance unchanged, until you mark it cleared.
              </p>
            </div>
          ) : (
            <>
              <Input
                id={`${formId}-reference`}
                name="reference"
                label="Reference"
                defaultValue={state.values?.reference ?? ""}
                hint="Optional. UPI transaction ID or receipt number."
                maxLength={100}
                error={state.fieldErrors.reference?.[0]}
              />
              <Checkbox
                id={`${formId}-extra`}
                name="keep_extra"
                label="Keep anything above what is due as credit"
                hint="It pays the resident's other open invoices first, then the next ones issued."
                defaultChecked={state.values?.keep_extra === "on"}
              />
            </>
          )}
        </form>
      </Modal>
    </>
  );
}
