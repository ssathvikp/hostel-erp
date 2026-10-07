"use client";

import { useActionState } from "react";

import { Alert, Button, Input } from "@/components/ui";
import { initialFormState } from "@/lib/validation/result";

import { resetPassword } from "../actions";

export function ResetPasswordForm() {
  const [state, action, pending] = useActionState(resetPassword, initialFormState);

  return (
    <form key={state.id} action={action} noValidate className="space-y-4">
      {state.formError && <Alert tone="error">{state.formError}</Alert>}

      <Input
        id="password"
        label="New password"
        type="password"
        autoComplete="new-password"
        required
        hint="At least 8 characters, with letters and numbers."
        error={state.fieldErrors.password?.[0]}
      />
      <Input
        id="confirm_password"
        label="Confirm new password"
        type="password"
        autoComplete="new-password"
        required
        error={state.fieldErrors.confirm_password?.[0]}
      />

      <Button type="submit" loading={pending} className="w-full">
        Save new password
      </Button>
    </form>
  );
}
