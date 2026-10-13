"use client";

import { useActionState, useEffect, useState } from "react";

import { Alert, Button, Modal, Textarea } from "@/components/ui";
import { initialFormState } from "@/lib/validation/result";

import { voidCharge, voidInvoice, voidMeterReading, voidPayment } from "../actions";

const COPY = {
  charge: {
    action: voidCharge,
    title: "Void this charge",
    description:
      "For a charge added by mistake, or a late fee you are waiving. It stays on record, marked void, and is never billed.",
    confirm: "Void charge",
  },
  invoice: {
    action: voidInvoice,
    title: "Void this invoice",
    description:
      "A void invoice stays on record but no longer counts towards any balance. You can then generate the month again for this resident.",
    confirm: "Void invoice",
  },
  payment: {
    action: voidPayment,
    title: "Void this payment",
    description:
      "Use this for a payment recorded by mistake or one that bounced. It stays on record, marked void, and no longer counts towards any total.",
    confirm: "Void payment",
  },
  reading: {
    action: voidMeterReading,
    title: "Void this meter reading",
    description:
      "For a reading taken wrongly. Its charges are voided with it, and the month can be read again. Not possible once a charge is on an invoice.",
    confirm: "Void reading",
  },
} as const;

/** Voids an invoice, payment, charge or meter reading with a reason. Nothing is ever edited or deleted. */
export function VoidDialog({
  kind,
  id,
  subject,
  size = "sm",
}: {
  kind: keyof typeof COPY;
  id: string;
  /** What is being voided, for the button's accessible name, e.g. "payment of ₹5,000". */
  subject: string;
  size?: "sm" | "md";
}) {
  const copy = COPY[kind];
  const [open, setOpen] = useState(false);
  const [state, action, pending] = useActionState(copy.action, initialFormState);
  const formId = `void-${kind}-${id}`;

  useEffect(() => {
    if (state.status === "success") setOpen(false);
  }, [state]);

  return (
    <>
      <Button
        variant="secondary"
        size={size}
        onClick={() => setOpen(true)}
        aria-label={`Void ${subject}`}
      >
        Void
      </Button>
      {state.status === "success" && (
        <span role="status" className="sr-only">
          {state.message}
        </span>
      )}
      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title={copy.title}
        description={copy.description}
        footer={
          <>
            <Button variant="secondary" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" form={formId} variant="danger" loading={pending}>
              {copy.confirm}
            </Button>
          </>
        }
      >
        <form key={state.id} id={formId} action={action} noValidate className="space-y-4">
          {state.formError && <Alert tone="error">{state.formError}</Alert>}
          <input type="hidden" name="id" value={id} />
          <Textarea
            id={`${formId}-reason`}
            name="void_reason"
            label="Reason"
            rows={3}
            maxLength={500}
            defaultValue={state.values?.void_reason ?? ""}
            required
            error={state.fieldErrors.void_reason?.[0]}
          />
        </form>
      </Modal>
    </>
  );
}
