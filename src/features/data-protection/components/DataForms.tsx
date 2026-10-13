"use client";

import { useActionState, useState } from "react";

import { Alert, Button, Input, Modal, Textarea } from "@/components/ui";
import { initialFormState } from "@/lib/validation/result";

import { cancelAccountClosure, eraseResident, requestAccountClosure } from "../actions";

/** Erases a resident who has left, after typing ERASE (E10-T10). */
export function EraseResidentDialog({ residentId, name }: { residentId: string; name: string }) {
  const [state, action, pending] = useActionState(eraseResident, initialFormState);
  const [open, setOpen] = useState(false);
  const formId = `erase-${residentId}`;
  return (
    <>
      <Button variant="danger" size="sm" onClick={() => setOpen(true)}>
        Erase personal data
      </Button>
      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title={`Erase ${name}'s personal data`}
        description="Their name, phone numbers, email, address, date of birth, guardian, notes and ID proof are deleted for good. Invoices, payments and stay dates stay, as the law requires, under the name 'Erased resident'. This cannot be undone."
        footer={
          <>
            <Button variant="secondary" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" form={formId} variant="danger" loading={pending}>
              Erase for good
            </Button>
          </>
        }
      >
        <form key={state.id} id={formId} action={action} noValidate className="space-y-4">
          {state.formError && <Alert tone="error">{state.formError}</Alert>}
          <input type="hidden" name="resident_id" value={residentId} />
          <Textarea
            id={`${formId}-reason`}
            name="reason"
            label="Why"
            required
            rows={2}
            maxLength={500}
            defaultValue={state.values?.reason ?? ""}
            hint="For example: the resident asked for their data to be deleted."
            error={state.fieldErrors.reason?.[0]}
          />
          <Input
            id={`${formId}-confirm`}
            name="confirm"
            label="Type ERASE to confirm"
            autoComplete="off"
            required
            error={state.fieldErrors.confirm?.[0]}
          />
        </form>
      </Modal>
    </>
  );
}

/** Asks for the owner's account to be closed after the notice period. */
export function CloseAccountForm({ scheduledFor }: { scheduledFor: string | null }) {
  const [state, action, pending] = useActionState(requestAccountClosure, initialFormState);
  const [cancelState, cancelAction, cancelling] = useActionState(
    cancelAccountClosure,
    initialFormState,
  );
  const [open, setOpen] = useState(false);

  if (scheduledFor) {
    const on = new Intl.DateTimeFormat("en-IN", { dateStyle: "long", timeZone: "UTC" }).format(
      new Date(scheduledFor),
    );
    return (
      <div className="space-y-3">
        <Alert tone="warning" title={`Your account is scheduled to close on ${on}`}>
          Download your data before then. After closing, your hostels and residents are deleted,
          except the financial records the law requires us to keep.
        </Alert>
        <form action={cancelAction}>
          <Button type="submit" variant="secondary" loading={cancelling}>
            Keep my account
          </Button>
        </form>
        {cancelState.formError && <Alert tone="error">{cancelState.formError}</Alert>}
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {state.status === "success" && <Alert tone="success">{state.message}</Alert>}
      {cancelState.status === "success" && <Alert tone="success">{cancelState.message}</Alert>}
      {!open ? (
        <Button variant="secondary" onClick={() => setOpen(true)}>
          Close my account
        </Button>
      ) : (
        <form key={state.id} action={action} noValidate className="max-w-md space-y-3">
          {state.formError && <Alert tone="error">{state.formError}</Alert>}
          <Textarea
            id="closure-reason"
            name="reason"
            label="Why are you leaving?"
            rows={2}
            maxLength={500}
            defaultValue={state.values?.reason ?? ""}
            hint="Optional."
          />
          <Input
            id="closure-confirm"
            name="confirm"
            label="Type CLOSE to confirm"
            autoComplete="off"
            required
            error={state.fieldErrors.confirm?.[0]}
          />
          <div className="flex gap-2">
            <Button type="submit" variant="danger" loading={pending}>
              Schedule closing
            </Button>
            <Button variant="ghost" onClick={() => setOpen(false)}>
              Cancel
            </Button>
          </div>
        </form>
      )}
    </div>
  );
}
