"use client";

import { useState } from "react";

import { initialFormState, type FormState } from "@/lib/validation/result";

/**
 * Form state for a form inside a dialog. The native <dialog> keeps its
 * content mounted, and `useActionState` keeps the last result, so without
 * this a dialog reopened after a failed or cancelled attempt shows the old
 * error and the old typed values. Each opening starts clean:
 * `shown` hides results from earlier openings, and `formKey` changes with
 * every opening so the form remounts with its defaults.
 */
export function useDialogState(state: FormState, open: boolean) {
  const [opening, setOpening] = useState({ open, count: 0, staleId: state.id });
  if (open !== opening.open) {
    setOpening(open ? { open, count: opening.count + 1, staleId: state.id } : { ...opening, open });
  }
  const fresh = state.id !== opening.staleId;
  return {
    shown: fresh ? state : initialFormState,
    formKey: `${opening.count}:${fresh ? state.id : "new"}`,
  };
}
