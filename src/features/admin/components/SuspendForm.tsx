"use client";

import { useActionState } from "react";

import { Alert, Button, Textarea } from "@/components/ui";
import { initialFormState } from "@/lib/validation/result";

import { setHostelSuspended } from "../actions";

/** Suspends a hostel with a reason the owner sees, or restores it (EP-10). */
export function SuspendForm({ hostelId, suspended }: { hostelId: string; suspended: boolean }) {
  const [state, action, pending] = useActionState(setHostelSuspended, initialFormState);

  return (
    <form key={state.id} action={action} noValidate className="space-y-4">
      {state.formError && <Alert tone="error">{state.formError}</Alert>}
      {state.status === "success" && <Alert tone="success">{state.message}</Alert>}
      <input type="hidden" name="hostel_id" value={hostelId} />
      <input type="hidden" name="suspend" value={suspended ? "false" : "true"} />
      {suspended && (
        <p className="text-sm text-slate-600">
          The owner and staff can use the hostel again as soon as it is restored.
        </p>
      )}
      <Textarea
        id={suspended ? "admin-restore-reason" : "admin-suspend-reason"}
        name="reason"
        label="Reason"
        rows={2}
        maxLength={500}
        required
        hint={
          suspended
            ? "Why it is being restored. Kept in the audit log."
            : "Shown to the owner and kept in the audit log. Nobody can open the hostel's rooms, residents or fees while it is suspended; nothing is deleted."
        }
        defaultValue={state.values?.reason ?? ""}
        error={state.fieldErrors.reason?.[0]}
      />
      <Button type="submit" variant={suspended ? "primary" : "danger"} loading={pending}>
        {suspended ? "Restore hostel" : "Suspend hostel"}
      </Button>
    </form>
  );
}
