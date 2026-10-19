"use client";

import { useActionState, useEffect, useState } from "react";

import { HostelField } from "@/components/shell/ActiveHostel";
import { Alert, Button, Modal, Textarea } from "@/components/ui";
import { useDialogState } from "@/lib/hooks/useDialogState";
import { initialFormState } from "@/lib/validation/result";

import { voidDepositEntry } from "@/features/deposits/actions";

import { voidInvoice, voidPayment } from "../actions";

const COPY = {
  invoice: {
    action: voidInvoice,
    title: "Void this invoice",
    description:
      "A void invoice stays on record but no longer counts towards any balance. You can then generate the month again for this resident.",
    confirm: "Void invoice",
    button: "Void",
  },
  lateFee: {
    action: voidInvoice,
    title: "Waive this late fee",
    description:
      "A waived late fee stays on record but no longer counts towards any balance, and is never charged again for this rent.",
    confirm: "Waive late fee",
    button: "Waive",
  },
  payment: {
    action: voidPayment,
    title: "Void this payment",
    description:
      "Use this for a payment recorded by mistake or one that bounced. It stays on record, marked void, and no longer counts towards any total.",
    confirm: "Void payment",
    button: "Void",
  },
  deposit: {
    action: voidDepositEntry,
    title: "Void this deposit entry",
    description:
      "Use this for an entry recorded by mistake. It stays on record, marked void, and no longer counts towards the deposit held.",
    confirm: "Void entry",
    button: "Void",
  },
} as const;

/**
 * Voids an invoice, payment or deposit entry, or waives a late fee, with a
 * reason. Nothing is ever edited or deleted.
 */
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
  const { shown, formKey } = useDialogState(state, open);
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
        aria-label={`${copy.button} ${subject}`}
      >
        {copy.button}
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
        <form key={formKey} id={formId} action={action} noValidate className="space-y-4">
          <HostelField />
          {shown.formError && <Alert tone="error">{shown.formError}</Alert>}
          <input type="hidden" name="id" value={id} />
          <Textarea
            id={`${formId}-reason`}
            name="void_reason"
            label="Reason"
            rows={3}
            maxLength={500}
            defaultValue={shown.values?.void_reason ?? ""}
            required
            error={shown.fieldErrors.void_reason?.[0]}
          />
        </form>
      </Modal>
    </>
  );
}
