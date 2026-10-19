"use client";

import { useActionState } from "react";

import { Button } from "@/components/ui";
import { initialFormState } from "@/lib/validation/result";

import { clearCheque } from "../actions";

/** Marks a pending cheque cleared once the bank credits it (ClickUp E13-T11). */
export function ClearChequeButton({ id, subject }: { id: string; subject: string }) {
  const [state, action, pending] = useActionState(clearCheque, initialFormState);
  return (
    <form action={action} className="inline">
      <input type="hidden" name="id" value={id} />
      <Button type="submit" size="sm" loading={pending} aria-label={`Mark ${subject} cleared`}>
        Cleared
      </Button>
      {state.formError && <span className="ml-2 text-xs text-red-700">{state.formError}</span>}
    </form>
  );
}
