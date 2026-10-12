"use client";

import { useActionState } from "react";

import { Alert, Button, Checkbox, Input, Select } from "@/components/ui";
import { initialFormState } from "@/lib/validation/result";

import { settleResident } from "../actions";
import { PAYMENT_MODE_OPTIONS } from "../options";

/**
 * Settles a resident who has left (E13-T8): optional deductions from the
 * deposit, whether the deposit pays what is owed, and how what is left is
 * paid back.
 */
export function SettlementForm({ residentId }: { residentId: string }) {
  const [state, action, pending] = useActionState(settleResident, initialFormState);
  return (
    <form key={state.id} action={action} noValidate className="space-y-5">
      {state.formError && <Alert tone="error">{state.formError}</Alert>}
      {state.status === "success" && <Alert tone="success">{state.message}</Alert>}
      <input type="hidden" name="resident_id" value={residentId} />

      <fieldset className="space-y-3">
        <legend className="text-sm font-semibold text-slate-900">
          Deductions from the deposit
        </legend>
        <p className="text-xs text-slate-500">Optional. Each needs a reason, kept on record.</p>
        {[0, 1, 2].map((index) => (
          <div key={index} className="grid gap-3 sm:grid-cols-[10rem_1fr]">
            <Input
              id={`deduction-amount-${index}`}
              name="deduction_amount"
              label={`Deduction ${index + 1} (₹)`}
              inputMode="decimal"
            />
            <Input
              id={`deduction-reason-${index}`}
              name="deduction_reason"
              label={`Reason ${index + 1}`}
              maxLength={500}
            />
          </div>
        ))}
      </fieldset>

      <Checkbox
        id="use-deposit"
        name="use_deposit"
        label="Pay what is still owed from the deposit"
        hint="Otherwise the deposit is only refunded or kept, and dues stay open."
        defaultChecked
      />

      <div className="grid gap-4 sm:grid-cols-2">
        <Select
          id="refund-mode"
          name="refund_mode"
          label="Pay back what is left by"
          placeholder="Do not pay back now"
          options={PAYMENT_MODE_OPTIONS}
        />
        <Input id="refund-reference" name="refund_reference" label="Reference" maxLength={100} />
      </div>

      <Button type="submit" loading={pending}>
        Settle
      </Button>
    </form>
  );
}
