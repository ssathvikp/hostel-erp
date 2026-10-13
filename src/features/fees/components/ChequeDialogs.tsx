"use client";

import { useActionState, useEffect, useState } from "react";

import { Alert, Button, Input, Modal, Textarea } from "@/components/ui";
import { todayIst } from "@/lib/validation";
import { initialFormState } from "@/lib/validation/result";

import { bounceCheque, clearCheque } from "../actions";

/**
 * The owner's two answers to a pending cheque (E13-T11): the bank paid it,
 * or the bank returned it. `subject` names the cheque for screen readers,
 * e.g. "cheque 004512 for ₹5,000".
 */
export function ChequeActions({
  id,
  subject,
  receivedOn,
}: {
  id: string;
  subject: string;
  /** The earliest day it can have cleared. */
  receivedOn: string;
}) {
  return (
    <div className="flex justify-end gap-2">
      <ClearDialog id={id} subject={subject} receivedOn={receivedOn} />
      <BounceDialog id={id} subject={subject} />
    </div>
  );
}

function ClearDialog({
  id,
  subject,
  receivedOn,
}: {
  id: string;
  subject: string;
  receivedOn: string;
}) {
  const [open, setOpen] = useState(false);
  const [state, action, pending] = useActionState(clearCheque, initialFormState);
  const formId = `clear-${id}`;
  const today = todayIst();

  useEffect(() => {
    if (state.status === "success") setOpen(false);
  }, [state]);

  return (
    <>
      <Button size="sm" onClick={() => setOpen(true)} aria-label={`Mark ${subject} cleared`}>
        Cleared
      </Button>
      {state.status === "success" && (
        <span role="status" className="sr-only">
          {state.message}
        </span>
      )}
      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title="Mark this cheque cleared"
        description="The bank has paid it. From now on it counts as paid on the invoice and as collected."
        footer={
          <>
            <Button variant="secondary" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" form={formId} loading={pending}>
              Mark cleared
            </Button>
          </>
        }
      >
        <form key={state.id} id={formId} action={action} noValidate className="space-y-4">
          {state.formError && <Alert tone="error">{state.formError}</Alert>}
          <input type="hidden" name="id" value={id} />
          <Input
            id={`${formId}-date`}
            name="cleared_on"
            type="date"
            label="Cleared on"
            min={receivedOn}
            max={today}
            defaultValue={state.values?.cleared_on || today}
            required
            error={state.fieldErrors.cleared_on?.[0]}
          />
        </form>
      </Modal>
    </>
  );
}

function BounceDialog({ id, subject }: { id: string; subject: string }) {
  const [open, setOpen] = useState(false);
  const [state, action, pending] = useActionState(bounceCheque, initialFormState);
  const formId = `bounce-${id}`;

  useEffect(() => {
    if (state.status === "success") setOpen(false);
  }, [state]);

  return (
    <>
      <Button
        variant="secondary"
        size="sm"
        onClick={() => setOpen(true)}
        aria-label={`Mark ${subject} bounced`}
      >
        Bounced
      </Button>
      {state.status === "success" && (
        <span role="status" className="sr-only">
          {state.message}
        </span>
      )}
      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title="Mark this cheque bounced"
        description="The bank returned it. It stays on record, marked bounced, and the amount is due again."
        footer={
          <>
            <Button variant="secondary" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" form={formId} variant="danger" loading={pending}>
              Mark bounced
            </Button>
          </>
        }
      >
        <form key={state.id} id={formId} action={action} noValidate className="space-y-4">
          {state.formError && <Alert tone="error">{state.formError}</Alert>}
          <input type="hidden" name="id" value={id} />
          <Textarea
            id={`${formId}-reason`}
            name="reason"
            label="Reason"
            rows={2}
            maxLength={500}
            defaultValue={state.values?.reason ?? ""}
            hint="As the bank gave it, e.g. insufficient funds."
            required
            error={state.fieldErrors.reason?.[0]}
          />
          <Input
            id={`${formId}-charge`}
            name="charge"
            label="Bounce charge (₹)"
            inputMode="decimal"
            defaultValue={state.values?.charge ?? ""}
            hint="Optional. Added to the resident's next invoice."
            error={state.fieldErrors.charge?.[0]}
          />
        </form>
      </Modal>
    </>
  );
}
