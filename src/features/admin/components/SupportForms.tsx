"use client";

import { useActionState } from "react";

import { Alert, Button, Select, Textarea } from "@/components/ui";
import { initialFormState } from "@/lib/validation/result";

import { openSupportView, runSupportAction } from "../actions";

/** Asks why before opening the read-only support view (ClickUp E10-T5). */
export function OpenSupportViewForm({ hostelId }: { hostelId: string }) {
  const [state, action, pending] = useActionState(openSupportView, initialFormState);
  return (
    <form key={state.id} action={action} noValidate className="space-y-4">
      {state.formError && <Alert tone="error">{state.formError}</Alert>}
      <input type="hidden" name="hostel_id" value={hostelId} />
      <Textarea
        id="support-reason"
        name="reason"
        label="Why do you need to see this hostel?"
        rows={2}
        maxLength={500}
        required
        hint="The owner sees this reason and when you looked. The view is read-only and closes after an hour."
        defaultValue={state.values?.reason ?? ""}
        error={state.fieldErrors.reason?.[0]}
      />
      <Button type="submit" loading={pending}>
        Open support view
      </Button>
    </form>
  );
}

const ACTION_OPTIONS = [
  { value: "password_reset", label: "Send a password reset link" },
  { value: "resend_confirmation", label: "Resend the sign-up confirmation e-mail" },
  { value: "sign_out_everywhere", label: "Sign them out of every device" },
];

/** Account help without ever seeing or setting a password (ClickUp E10-T8). */
export function SupportActionForm({
  userId,
  email,
  confirmed,
}: {
  userId: string;
  email: string;
  /** Unconfirmed accounts are offered the confirmation e-mail first. */
  confirmed: boolean;
}) {
  const [state, action, pending] = useActionState(runSupportAction, initialFormState);
  const options = confirmed
    ? ACTION_OPTIONS.filter((option) => option.value !== "resend_confirmation")
    : ACTION_OPTIONS;
  return (
    <form key={state.id} action={action} noValidate className="space-y-4">
      {state.formError && <Alert tone="error">{state.formError}</Alert>}
      {state.status === "success" && <Alert tone="success">{state.message}</Alert>}
      <input type="hidden" name="user_id" value={userId} />
      <input type="hidden" name="email" value={email} />
      <Select
        id="support-action"
        name="action"
        label="Action"
        options={options}
        defaultValue={
          state.values?.action ?? (confirmed ? "password_reset" : "resend_confirmation")
        }
        error={state.fieldErrors.action?.[0]}
      />
      <Textarea
        id="support-action-reason"
        name="reason"
        label="Reason"
        rows={2}
        maxLength={500}
        required
        hint="Kept in the audit log."
        defaultValue={state.values?.reason ?? ""}
        error={state.fieldErrors.reason?.[0]}
      />
      <Button type="submit" loading={pending}>
        Do it
      </Button>
    </form>
  );
}
