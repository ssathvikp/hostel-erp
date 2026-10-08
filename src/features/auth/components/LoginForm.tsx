"use client";

import Link from "next/link";
import { useActionState } from "react";

import { Alert, Button, Input } from "@/components/ui";
import { initialFormState } from "@/lib/validation/result";

import { signIn } from "../actions";

export function LoginForm({ next }: { next?: string }) {
  const [state, action, pending] = useActionState(signIn, initialFormState);

  return (
    <form key={state.id} action={action} noValidate className="space-y-4">
      {state.formError && <Alert tone="error">{state.formError}</Alert>}
      {next && <input type="hidden" name="next" value={next} />}

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
        autoComplete="current-password"
        required
        error={state.fieldErrors.password?.[0]}
      />

      <div className="flex justify-end">
        <Link
          href="/forgot-password"
          className="text-sm font-medium text-brand-700 hover:underline"
        >
          Forgot password?
        </Link>
      </div>

      <Button type="submit" loading={pending} className="w-full">
        Sign in
      </Button>
    </form>
  );
}
