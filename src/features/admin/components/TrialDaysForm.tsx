"use client";

import { useActionState } from "react";

import { Alert, Button, Input } from "@/components/ui";
import { initialFormState } from "@/lib/validation/result";

import { setTrialDays } from "../actions";

/** How long the free trial is for hostels that sign up from now on (plan E15-T2). */
export function TrialDaysForm({ trialDays }: { trialDays: number }) {
  const [state, action, pending] = useActionState(setTrialDays, initialFormState);
  return (
    <form key={state.id} action={action} noValidate className="space-y-4">
      {state.formError && <Alert tone="error">{state.formError}</Alert>}
      {state.status === "success" && <Alert tone="success">{state.message}</Alert>}
      <Input
        id="trial-days"
        name="trial_days"
        label="Free trial for new hostels (days)"
        inputMode="numeric"
        className="max-w-32"
        defaultValue={state.values?.trial_days ?? String(trialDays)}
        hint="Between 7 and 180. Hostels already on a trial keep their end date."
        error={state.fieldErrors.trial_days?.[0]}
      />
      <Button type="submit" loading={pending}>
        Save trial length
      </Button>
    </form>
  );
}
