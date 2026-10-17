"use client";

import { useActionState, useState } from "react";

import { Alert, Button, Input, Select } from "@/components/ui";
import { initialFormState } from "@/lib/validation/result";

import { setHostelPlan } from "../actions";
import { PLAN_OPTIONS } from "../options";

export function PlanForm({
  hostelId,
  plan,
  trialEndsAt,
}: {
  hostelId: string;
  plan: string;
  trialEndsAt: string | null;
}) {
  const [state, action, pending] = useActionState(setHostelPlan, initialFormState);
  const [chosen, setChosen] = useState(plan);

  return (
    <form key={state.id} action={action} noValidate className="space-y-4">
      {state.formError && <Alert tone="error">{state.formError}</Alert>}
      {state.status === "success" && <Alert tone="success">{state.message}</Alert>}
      <input type="hidden" name="hostel_id" value={hostelId} />
      <div className="grid gap-4 sm:grid-cols-2">
        <Select
          id="admin-plan"
          name="plan"
          label="Plan"
          options={PLAN_OPTIONS}
          value={chosen}
          onChange={(event) => setChosen(event.target.value)}
          required
          error={state.fieldErrors.plan?.[0]}
        />
        {chosen === "trial" && (
          <Input
            id="admin-trial-end"
            name="trial_ends_at"
            type="date"
            label="Trial ends on"
            defaultValue={state.values?.trial_ends_at || trialEndsAt || ""}
            required
            error={state.fieldErrors.trial_ends_at?.[0]}
          />
        )}
      </div>
      <Button type="submit" loading={pending}>
        Save plan
      </Button>
    </form>
  );
}
