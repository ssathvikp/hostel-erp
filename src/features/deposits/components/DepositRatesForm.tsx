"use client";

import { useActionState } from "react";

import { HostelField } from "@/components/shell/ActiveHostel";
import { Alert, Button, Input } from "@/components/ui";
import { SHARING_TYPE_LABELS } from "@/features/rooms/options";
import { initialFormState } from "@/lib/validation/result";
import { SHARING_TYPES, type SharingType } from "@/types";

import { saveDepositRates } from "../actions";

/** The usual security deposit per sharing type, offered at allocation (ClickUp E13-T4). */
export function DepositRatesForm({ rates }: { rates: Partial<Record<SharingType, number>> }) {
  const [state, action, pending] = useActionState(saveDepositRates, initialFormState);
  return (
    <form key={state.id} action={action} noValidate className="space-y-4">
      <HostelField />
      {state.formError && <Alert tone="error">{state.formError}</Alert>}
      {state.status === "success" && <Alert tone="success">{state.message}</Alert>}
      <div className="grid gap-4 sm:grid-cols-4">
        {SHARING_TYPES.map((type) => (
          <Input
            key={type}
            id={`deposit-${type}`}
            name={`deposit_${type}`}
            label={`${SHARING_TYPE_LABELS[type]} (₹)`}
            inputMode="decimal"
            defaultValue={
              state.values?.[`deposit_${type}`] ?? (rates[type] ? String(rates[type]! / 100) : "")
            }
            error={state.fieldErrors[`deposit_${type}`]?.[0]}
          />
        ))}
      </div>
      <Button type="submit" loading={pending}>
        Save deposits
      </Button>
    </form>
  );
}
