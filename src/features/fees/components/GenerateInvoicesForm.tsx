"use client";

import { useActionState } from "react";

import { Alert, Button, Input } from "@/components/ui";
import { initialFormState } from "@/lib/validation/result";

import { generateInvoices } from "../actions";

/**
 * Bills every resident who held a bed in a month (E7-T3). Safe to run again:
 * residents who already have an invoice for the month are skipped.
 */
export function GenerateInvoicesForm({ currentMonth }: { currentMonth: string }) {
  const [state, action, pending] = useActionState(generateInvoices, initialFormState);

  return (
    <form key={state.id} action={action} noValidate className="space-y-4">
      {state.formError && <Alert tone="error">{state.formError}</Alert>}
      {state.status === "success" && <Alert tone="success">{state.message}</Alert>}
      {state.warning && <Alert tone="warning">{state.warning}</Alert>}
      <div className="flex flex-wrap items-end gap-4">
        <Input
          id="generate-month"
          name="period_month"
          type="month"
          label="Billing month"
          max={currentMonth}
          defaultValue={state.values?.period_month || currentMonth}
          required
          error={state.fieldErrors.period_month?.[0]}
          className="w-44"
        />
        <Input
          id="generate-due-day"
          name="due_day"
          type="number"
          label="Due on day"
          min={1}
          max={28}
          defaultValue={state.values?.due_day || "5"}
          required
          error={state.fieldErrors.due_day?.[0]}
          className="w-28"
        />
        <Button type="submit" loading={pending}>
          Generate invoices
        </Button>
      </div>
      <p className="text-xs text-slate-500">
        Everyone who held a bed in the month is billed once. A full month costs the monthly rent;
        part of a month (arriving, leaving or moving beds) costs the rent for the nights held,
        rounded to the rupee. Running it again only bills residents who were missed.
      </p>
    </form>
  );
}
