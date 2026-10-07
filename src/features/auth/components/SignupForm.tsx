"use client";

import { useActionState } from "react";

import { Alert, Button, Input } from "@/components/ui";
import { initialFormState } from "@/lib/validation/result";

import { signUp } from "../actions";

export function SignupForm() {
  const [state, action, pending] = useActionState(signUp, initialFormState);

  if (state.status === "success") {
    return (
      <Alert tone="success" title="Check your email">
        <p>
          We sent a confirmation link to <span className="font-medium">{state.message}</span>. Open
          it to finish creating your account.
        </p>
        <p className="mt-2">
          No email after a few minutes? Check your spam folder, then try signing up again.
        </p>
      </Alert>
    );
  }

  return (
    <form key={state.id} action={action} noValidate className="space-y-4">
      {state.formError && <Alert tone="error">{state.formError}</Alert>}

      <Input
        id="full_name"
        label="Your name"
        autoComplete="name"
        required
        defaultValue={state.values?.full_name}
        error={state.fieldErrors.full_name?.[0]}
      />
      <Input
        id="email"
        label="Email"
        type="email"
        autoComplete="email"
        required
        defaultValue={state.values?.email}
        error={state.fieldErrors.email?.[0]}
      />
      <Input
        id="password"
        label="Password"
        type="password"
        autoComplete="new-password"
        required
        hint="At least 8 characters, with letters and numbers."
        error={state.fieldErrors.password?.[0]}
      />

      <Button type="submit" loading={pending} className="w-full">
        Create account
      </Button>
    </form>
  );
}
