"use client";

import { useActionState } from "react";

import { Alert, Button, Input } from "@/components/ui";
import { initialFormState } from "@/lib/validation/result";

import { requestPasswordReset } from "../actions";

export function ForgotPasswordForm() {
  const [state, action, pending] = useActionState(requestPasswordReset, initialFormState);

  if (state.status === "success") {
    return (
      <Alert tone="success" title="Check your email">
        If an account exists for <span className="font-medium">{state.message}</span>, we have sent
        a link to reset its password. The link works once and expires in one hour.
      </Alert>
    );
  }

  return (
    <form key={state.id} action={action} noValidate className="space-y-4">
      {state.formError && <Alert tone="error">{state.formError}</Alert>}

      <Input
        id="email"
        label="Email"
        type="email"
        autoComplete="email"
        required
        defaultValue={state.values?.email}
        error={state.fieldErrors.email?.[0]}
      />

      <Button type="submit" loading={pending} className="w-full">
        Send reset link
      </Button>
    </form>
  );
}
