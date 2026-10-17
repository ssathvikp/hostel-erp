"use client";

import { useActionState } from "react";

import { HostelField } from "@/components/shell/ActiveHostel";
import { Alert, Button, Input } from "@/components/ui";
import { initialFormState } from "@/lib/validation/result";

import { inviteStaff } from "../actions";

/** Owners invite a staff member by email (EP-12). */
export function InviteStaffForm() {
  const [state, action, pending] = useActionState(inviteStaff, initialFormState);

  return (
    <form key={state.id} action={action} noValidate className="space-y-4">
      <HostelField />
      {state.formError && <Alert tone="error">{state.formError}</Alert>}
      {state.status === "success" && <Alert tone="success">{state.message}</Alert>}
      <div className="grid gap-4 sm:grid-cols-2">
        <Input
          id="staff-name"
          name="full_name"
          label="Name"
          autoComplete="off"
          defaultValue={state.values?.full_name ?? ""}
          required
          error={state.fieldErrors.full_name?.[0]}
        />
        <Input
          id="staff-email"
          name="email"
          type="email"
          label="Email"
          autoComplete="off"
          hint="They get a link to choose their own password."
          defaultValue={state.values?.email ?? ""}
          required
          error={state.fieldErrors.email?.[0]}
        />
      </div>
      <Button type="submit" loading={pending}>
        Send invitation
      </Button>
    </form>
  );
}
