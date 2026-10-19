"use client";

import { useActionState } from "react";

import { HostelField } from "@/components/shell/ActiveHostel";
import { Alert, Button } from "@/components/ui";
import { initialFormState } from "@/lib/validation/result";

import { applyLateFees } from "../actions";

/**
 * Charges late fees for rent paid late (ClickUp E13-T6). Safe to press any
 * number of times: each rent invoice gets at most one late fee.
 */
export function ApplyLateFeesForm() {
  const [state, action, pending] = useActionState(applyLateFees, initialFormState);
  return (
    <form key={state.id} action={action} className="space-y-3">
      <HostelField />
      {state.formError && <Alert tone="error">{state.formError}</Alert>}
      {state.status === "success" && <Alert tone="success">{state.message}</Alert>}
      <Button type="submit" variant="secondary" loading={pending}>
        Add late fees now
      </Button>
    </form>
  );
}
