"use client";

import { useActionState, useState } from "react";

import { HostelField } from "@/components/shell/ActiveHostel";
import { Alert, Button, Input, Select } from "@/components/ui";
import { initialFormState } from "@/lib/validation/result";

import { saveLateFeeRule } from "../actions";
import { LATE_FEE_MODE_OPTIONS } from "../options";
import type { LateFeeRule } from "../queries";

const toRupees = (paise: number | null) => (paise === null ? "" : String(paise / 100));

/**
 * The hostel's late-fee rule (ClickUp E13-T6): off, a fixed fee, or a fee
 * per day with a cap, after a number of grace days.
 */
export function LateFeeRuleForm({ rule }: { rule: LateFeeRule }) {
  const [state, action, pending] = useActionState(saveLateFeeRule, initialFormState);
  const [mode, setMode] = useState(state.values?.late_fee_mode ?? rule.mode);

  return (
    <form key={state.id} action={action} noValidate className="space-y-4">
      <HostelField />
      {state.formError && <Alert tone="error">{state.formError}</Alert>}
      {state.status === "success" && <Alert tone="success">{state.message}</Alert>}
      <div className="grid gap-4 sm:grid-cols-2">
        <Select
          id="late-fee-mode"
          name="late_fee_mode"
          label="Late fees"
          options={LATE_FEE_MODE_OPTIONS}
          value={mode}
          onChange={(event) => setMode(event.target.value as LateFeeRule["mode"])}
          error={state.fieldErrors.late_fee_mode?.[0]}
        />
        <Input
          id="late-fee-grace"
          name="late_fee_grace_days"
          label="Grace days after the due date"
          inputMode="numeric"
          defaultValue={state.values?.late_fee_grace_days ?? String(rule.graceDays)}
          error={state.fieldErrors.late_fee_grace_days?.[0]}
        />
        {mode !== "off" && (
          <Input
            id="late-fee-amount"
            name="late_fee_amount"
            label={mode === "per_day" ? "Fee per day late (₹)" : "Late fee (₹)"}
            inputMode="decimal"
            defaultValue={state.values?.late_fee_amount ?? toRupees(rule.amount)}
            required
            error={state.fieldErrors.late_fee_amount?.[0]}
          />
        )}
        {mode === "per_day" && (
          <Input
            id="late-fee-cap"
            name="late_fee_cap"
            label="Most per invoice (₹)"
            inputMode="decimal"
            defaultValue={state.values?.late_fee_cap ?? toRupees(rule.cap)}
            required
            error={state.fieldErrors.late_fee_cap?.[0]}
          />
        )}
      </div>
      <Button type="submit" loading={pending}>
        Save late fee rule
      </Button>
    </form>
  );
}
