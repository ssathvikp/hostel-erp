"use client";

import { useActionState, useState } from "react";

import { HostelField } from "@/components/shell/ActiveHostel";
import { Alert, Button, Checkbox, Input, Select } from "@/components/ui";
import { PAYMENT_MODE_OPTIONS } from "@/features/fees/options";
import { formatMonth, formatPaise } from "@/lib/money";
import { SETTLEMENT_DEDUCTION_ROWS } from "@/lib/validation";
import { initialFormState } from "@/lib/validation/result";

import { settleMoveOut } from "../actions";
import { estimateSettlement, type SettlementPreview } from "../totals";

function toPaise(value: string): number {
  const amount = Number(value);
  return Number.isFinite(amount) && amount > 0 ? Math.round(amount * 100) : 0;
}

function Row({ label, amount, strong }: { label: string; amount: string; strong?: boolean }) {
  return (
    <div className={`flex justify-between gap-4 py-1.5 ${strong ? "font-semibold" : ""}`}>
      <dt className="text-slate-700">{label}</dt>
      <dd className="tabular-nums">{amount}</dd>
    </div>
  );
}

/**
 * The owner's move-out settlement (ClickUp E13-T8): deductions, re-billing
 * the final month, the deposit against dues, and the refund. The summary
 * updates as they type; the database works it out again when they confirm.
 */
export function SettlementForm({ preview }: { preview: SettlementPreview }) {
  const [state, action, pending] = useActionState(settleMoveOut, initialFormState);
  const values = state.values ?? {};
  const rows = Array.from({ length: SETTLEMENT_DEDUCTION_ROWS }, (_, index) => index + 1);
  const [amounts, setAmounts] = useState<string[]>(
    rows.map((row) => values[`deduction_amount_${row}`] ?? ""),
  );
  const [rebill, setRebill] = useState(state.values ? values.rebill === "on" : true);
  const [useDeposit, setUseDeposit] = useState(state.values ? values.use_deposit === "on" : true);

  const deductions = amounts.reduce((sum, amount) => sum + toPaise(amount), 0);
  const estimate = estimateSettlement(preview, { deductions, rebill, useDeposit });
  const final = preview.finalMonth;

  return (
    <form key={state.id} action={action} noValidate className="space-y-6">
      <HostelField />
      <input type="hidden" name="allocation_id" value={preview.allocationId} />
      <input type="hidden" name="resident_id" value={preview.residentId} />
      {state.formError && <Alert tone="error">{state.formError}</Alert>}

      {final && (
        <fieldset className="space-y-2">
          <legend className="text-sm font-semibold text-slate-900">Final month</legend>
          {final.canRebill ? (
            <Checkbox
              id="settle-rebill"
              name="rebill"
              label={`Re-bill ${formatMonth(final.periodMonth)} for the ${final.nights} nights held`}
              hint={`Rent was billed at ${formatPaise(final.billedRent)}; for the nights held it is ${formatPaise(final.rentForNights)}. Invoice ${final.invoiceNumber} is voided and issued again.`}
              checked={rebill}
              onChange={(event) => setRebill(event.target.checked)}
            />
          ) : (
            <Alert tone="warning">
              {`Invoice ${final.invoiceNumber} charged rent for ${formatMonth(final.periodMonth)} beyond the ${final.nights} nights held, but it has payments or a late fee, so it is not re-billed here. Void those first if it should be.`}
            </Alert>
          )}
        </fieldset>
      )}

      <fieldset className="space-y-3">
        <legend className="text-sm font-semibold text-slate-900">
          Deductions from the deposit
        </legend>
        <p className="text-sm text-slate-600">
          {formatPaise(preview.depositHeld)} is held. Leave rows blank if nothing is kept.
        </p>
        {rows.map((row, index) => (
          <div key={row} className="grid gap-3 sm:grid-cols-[10rem_1fr]">
            <Input
              id={`settle-deduction-amount-${row}`}
              name={`deduction_amount_${row}`}
              label={`Deduction ${row} (₹)`}
              inputMode="decimal"
              defaultValue={values[`deduction_amount_${row}`] ?? ""}
              onChange={(event) =>
                setAmounts((current) =>
                  current.map((amount, at) => (at === index ? event.target.value : amount)),
                )
              }
              error={state.fieldErrors[`deduction_amount_${row}`]?.[0]}
            />
            <Input
              id={`settle-deduction-reason-${row}`}
              name={`deduction_reason_${row}`}
              label="What for"
              placeholder="e.g. Broken chair, deep cleaning"
              defaultValue={values[`deduction_reason_${row}`] ?? ""}
              error={state.fieldErrors[`deduction_reason_${row}`]?.[0]}
            />
          </div>
        ))}
        <Checkbox
          id="settle-use-deposit"
          name="use_deposit"
          label="Use the deposit to pay what is still due"
          hint="Each use is recorded as a payment from the security deposit on the invoice."
          checked={useDeposit}
          onChange={(event) => setUseDeposit(event.target.checked)}
        />
      </fieldset>

      <section aria-labelledby="settle-summary" className="rounded-lg bg-slate-50 p-4">
        <h3 id="settle-summary" className="text-sm font-semibold text-slate-900">
          Summary
        </h3>
        <dl className="mt-2 divide-y divide-slate-200 text-sm">
          <Row label="Dues" amount={formatPaise(estimate.owed + estimate.rebillSaving)} />
          {estimate.rebillSaving > 0 && (
            <Row label="Final month re-billed" amount={`-${formatPaise(estimate.rebillSaving)}`} />
          )}
          {estimate.creditUsed > 0 && (
            <Row label="Advance credit used" amount={`-${formatPaise(estimate.creditUsed)}`} />
          )}
          {estimate.paidFromDeposit > 0 && (
            <Row label="Paid from deposit" amount={`-${formatPaise(estimate.paidFromDeposit)}`} />
          )}
          <Row label="Deposit held" amount={formatPaise(preview.depositHeld)} />
          {deductions > 0 && <Row label="Deductions" amount={`-${formatPaise(deductions)}`} />}
          {estimate.net > 0 ? (
            <Row label="Still owed by the resident" amount={formatPaise(estimate.net)} strong />
          ) : (
            <Row label="Refund to the resident" amount={formatPaise(-estimate.net)} strong />
          )}
        </dl>
        {deductions > preview.depositHeld && (
          <p className="mt-2 text-sm text-red-700">
            The deductions are more than the deposit held.
          </p>
        )}
      </section>

      {estimate.refund > 0 && (
        <div className="grid gap-4 sm:grid-cols-2">
          <Select
            id="settle-refund-mode"
            name="refund_mode"
            label="Refund paid by"
            placeholder="Choose"
            options={PAYMENT_MODE_OPTIONS}
            defaultValue={values.refund_mode ?? ""}
            required
            error={state.fieldErrors.refund_mode?.[0]}
          />
          <Input
            id="settle-refund-reference"
            name="refund_reference"
            label="Reference (optional)"
            defaultValue={values.refund_reference ?? ""}
            error={state.fieldErrors.refund_reference?.[0]}
          />
        </div>
      )}

      <Button type="submit" loading={pending}>
        Settle move-out
      </Button>
    </form>
  );
}
