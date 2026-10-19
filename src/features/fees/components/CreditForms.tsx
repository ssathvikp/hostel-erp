"use client";

import { useActionState, useEffect, useState } from "react";

import { HostelField } from "@/components/shell/ActiveHostel";
import { Alert, Button, Input, Modal, Select } from "@/components/ui";
import { useDialogState } from "@/lib/hooks/useDialogState";
import { formatPaise } from "@/lib/money";
import { todayIst } from "@/lib/validation";
import { initialFormState } from "@/lib/validation/result";

import { applyCredit, recordCreditEntry } from "../actions";
import { PAYMENT_MODE_OPTIONS } from "../options";

/** Records an advance (money in) or a refund of held credit (ClickUp E13-T7). */
export function CreditDialog({
  residentId,
  residentName,
  kind,
  held,
}: {
  residentId: string;
  residentName: string;
  kind: "advance" | "refund";
  held: number;
}) {
  const [open, setOpen] = useState(false);
  const [state, action, pending] = useActionState(recordCreditEntry, initialFormState);
  const { shown, formKey } = useDialogState(state, open);
  const formId = `credit-${kind}-${residentId}`;
  const today = todayIst();

  useEffect(() => {
    if (state.status === "success") setOpen(false);
  }, [state]);

  return (
    <>
      <Button
        variant="secondary"
        onClick={() => setOpen(true)}
        aria-label={`${kind === "advance" ? "Record an advance from" : "Refund credit to"} ${residentName}`}
      >
        {kind === "advance" ? "Record advance" : "Refund credit"}
      </Button>
      {state.status === "success" && (
        <span role="status" className="sr-only">
          {state.message}
        </span>
      )}
      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title={
          kind === "advance" ? `Advance from ${residentName}` : `Refund credit to ${residentName}`
        }
        description={
          kind === "advance"
            ? "Money received before it is due. It is used on the resident's next invoice."
            : `${formatPaise(held)} is held. Record money given back.`
        }
        footer={
          <>
            <Button variant="secondary" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" form={formId} loading={pending}>
              {kind === "advance" ? "Record advance" : "Record refund"}
            </Button>
          </>
        }
      >
        <form key={formKey} id={formId} action={action} noValidate className="space-y-4">
          <HostelField />
          <input type="hidden" name="resident_id" value={residentId} />
          <input type="hidden" name="kind" value={kind} />
          {shown.formError && <Alert tone="error">{shown.formError}</Alert>}
          <Input
            id={`${formId}-amount`}
            name="amount"
            label="Amount (₹)"
            inputMode="decimal"
            required
            defaultValue={shown.values?.amount ?? ""}
            error={shown.fieldErrors.amount?.[0]}
          />
          <div className="grid gap-4 sm:grid-cols-2">
            <Input
              id={`${formId}-date`}
              name="entry_date"
              type="date"
              label="Date"
              max={today}
              required
              defaultValue={shown.values?.entry_date || today}
              error={shown.fieldErrors.entry_date?.[0]}
            />
            <Select
              id={`${formId}-mode`}
              name="mode"
              label="Mode"
              placeholder="Choose a mode"
              options={PAYMENT_MODE_OPTIONS}
              required
              defaultValue={shown.values?.mode ?? ""}
              error={shown.fieldErrors.mode?.[0]}
            />
          </div>
          <Input
            id={`${formId}-reference`}
            name="reference"
            label="Reference"
            maxLength={100}
            hint="Optional."
            defaultValue={shown.values?.reference ?? ""}
            error={shown.fieldErrors.reference?.[0]}
          />
        </form>
      </Modal>
    </>
  );
}

export function ApplyCreditButton({ residentId }: { residentId: string }) {
  const [state, action, pending] = useActionState(applyCredit, initialFormState);
  return (
    <form action={action} className="space-y-2">
      <input type="hidden" name="resident_id" value={residentId} />
      {state.status === "success" && <Alert tone="success">{state.message}</Alert>}
      {state.formError && <Alert tone="error">{state.formError}</Alert>}
      <Button type="submit" variant="secondary" loading={pending}>
        Use credit on open invoices
      </Button>
    </form>
  );
}
