"use client";

import { useActionState } from "react";

import { Alert, Button, Input } from "@/components/ui";
import { initialFormState } from "@/lib/validation/result";

import { acceptInvitation } from "../actions";

export function AcceptInvitationForm({ email }: { email: string }) {
  const [state, action, pending] = useActionState(acceptInvitation, initialFormState);

  return (
    <form key={state.id} action={action} noValidate className="space-y-4">
      {state.formError && <Alert tone="error">{state.formError}</Alert>}

      {/* Lets password managers save the login against the right account. */}
      <input type="hidden" name="username" autoComplete="username" value={email} readOnly />
      <Input
        id="password"
        label="Password"
        type="password"
        autoComplete="new-password"
        required
        hint="At least 8 characters, with letters and numbers."
        error={state.fieldErrors.password?.[0]}
      />
      <Input
        id="confirm_password"
        label="Confirm password"
        type="password"
        autoComplete="new-password"
        required
        error={state.fieldErrors.confirm_password?.[0]}
      />

      <Button type="submit" loading={pending} className="w-full">
        Accept and continue
      </Button>
    </form>
  );
}
