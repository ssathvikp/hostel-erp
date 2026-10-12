"use client";

import { useActionState } from "react";

import { Alert, Button, Input, Select } from "@/components/ui";
import { SHARING_TYPE_OPTIONS } from "@/features/rooms/options";
import { initialFormState } from "@/lib/validation/result";

import { setFeeStructure } from "../actions";

/**
 * Sets the monthly rent for a sharing type from a date (E7-T2). The rate in
 * force until then closes the day before; issued invoices never change.
 */
export function RateForm({ defaultFrom }: { defaultFrom: string }) {
  const [state, action, pending] = useActionState(setFeeStructure, initialFormState);

  return (
    <form key={state.id} action={action} noValidate className="space-y-4">
      {state.formError && <Alert tone="error">{state.formError}</Alert>}
      {state.status === "success" && <Alert tone="success">{state.message}</Alert>}
      <div className="grid gap-4 sm:grid-cols-3">
        <Select
          id="rate-sharing"
          name="sharing_type"
          label="Sharing type"
          placeholder="Choose a sharing type"
          options={SHARING_TYPE_OPTIONS}
          defaultValue={state.values?.sharing_type ?? ""}
          required
          error={state.fieldErrors.sharing_type?.[0]}
        />
        <Input
          id="rate-amount"
          name="monthly_amount"
          label="Monthly rent (₹)"
          inputMode="decimal"
          defaultValue={state.values?.monthly_amount ?? ""}
          required
          error={state.fieldErrors.monthly_amount?.[0]}
        />
        <Input
          id="rate-from"
          name="effective_from"
          type="date"
          label="Applies from"
          defaultValue={state.values?.effective_from || defaultFrom}
          required
          hint="Invoices use the rate in force on the 1st of each month, so start rates on the 1st."
          error={state.fieldErrors.effective_from?.[0]}
        />
      </div>
      <Button type="submit" loading={pending}>
        Save rate
      </Button>
    </form>
  );
}
