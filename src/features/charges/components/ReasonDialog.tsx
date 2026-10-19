"use client";

import { useActionState, useEffect, useState } from "react";

import { HostelField } from "@/components/shell/ActiveHostel";
import { Alert, Button, Modal, Textarea } from "@/components/ui";
import { useDialogState } from "@/lib/hooks/useDialogState";
import { initialFormState, type FormState } from "@/lib/validation/result";

/** A button that asks why before ending or voiding something, e.g. a charge or discount. */
export function ReasonDialog({
  action: serverAction,
  id,
  button,
  title,
  description,
  confirm,
  subject,
}: {
  action: (previous: FormState, formData: FormData) => Promise<FormState>;
  id: string;
  button: string;
  title: string;
  description: string;
  confirm: string;
  /** For the button's accessible name, e.g. "charge of ₹500". */
  subject: string;
}) {
  const [open, setOpen] = useState(false);
  const [state, action, pending] = useActionState(serverAction, initialFormState);
  const { shown, formKey } = useDialogState(state, open);
  const formId = `reason-${id}`;

  useEffect(() => {
    if (state.status === "success") setOpen(false);
  }, [state]);

  return (
    <>
      <Button
        size="sm"
        variant="secondary"
        onClick={() => setOpen(true)}
        aria-label={`${button} ${subject}`}
      >
        {button}
      </Button>
      {state.status === "success" && (
        <span role="status" className="sr-only">
          {state.message}
        </span>
      )}
      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title={title}
        description={description}
        footer={
          <>
            <Button variant="secondary" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" form={formId} variant="danger" loading={pending}>
              {confirm}
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
            required
            defaultValue={shown.values?.void_reason ?? ""}
            error={shown.fieldErrors.void_reason?.[0]}
          />
        </form>
      </Modal>
    </>
  );
}
