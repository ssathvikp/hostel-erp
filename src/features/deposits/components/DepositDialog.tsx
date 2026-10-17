"use client";

import { useActionState, useEffect, useState } from "react";

import { HostelField } from "@/components/shell/ActiveHostel";
import { Alert, Button, Input, Modal, Select, Textarea } from "@/components/ui";
import { PAYMENT_MODE_OPTIONS } from "@/features/fees/options";
import { formatPaise, paiseToInput } from "@/lib/money";
import { todayIst } from "@/lib/validation";
import { initialFormState } from "@/lib/validation/result";
import type { DepositEntryKind } from "@/types";

import { recordDepositEntry } from "../actions";
import { DEPOSIT_KIND_OPTIONS } from "../options";

/**
 * Records a deposit collected, part of it kept, or a refund (EP-12). With
 * money held, the amount for a refund defaults to all of it, which is the
 * common case when a resident leaves.
 */
export function DepositDialog({
  residentId,
  residentName,
  held,
}: {
  residentId: string;
  residentName: string;
  /** Paise held now. */
  held: number;
}) {
  const [open, setOpen] = useState(false);
  const [state, action, pending] = useActionState(recordDepositEntry, initialFormState);
  const [kind, setKind] = useState<DepositEntryKind>(held > 0 ? "refund" : "collected");
  const today = todayIst();
  const formId = `deposit-${residentId}`;
  const movesMoney = kind !== "deduction";

  useEffect(() => {
    if (state.status === "success") setOpen(false);
  }, [state]);

  return (
    <>
      <Button
        variant="secondary"
        onClick={() => {
          // Each opening starts from the likely next step for what is held now.
          setKind(held > 0 ? "refund" : "collected");
          setOpen(true);
        }}
        aria-label={`Record deposit for ${residentName}`}
      >
        Record deposit
      </Button>
      {state.status === "success" && (
        <span role="status" className="sr-only">
          {state.message}
        </span>
      )}
      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title={`Security deposit for ${residentName}`}
        description={
          held > 0
            ? `${formatPaise(held)} is held now. Deductions and refunds cannot exceed it.`
            : "No deposit is held yet."
        }
        footer={
          <>
            <Button variant="secondary" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" form={formId} loading={pending}>
              Record
            </Button>
          </>
        }
      >
        <form key={state.id} id={formId} action={action} noValidate className="space-y-4">
          <HostelField />
          {state.formError && <Alert tone="error">{state.formError}</Alert>}
          <input type="hidden" name="resident_id" value={residentId} />
          <Select
            id={`${formId}-kind`}
            name="kind"
            label="What happened"
            options={held > 0 ? DEPOSIT_KIND_OPTIONS : DEPOSIT_KIND_OPTIONS.slice(0, 1)}
            value={kind}
            onChange={(event) => setKind(event.target.value as DepositEntryKind)}
            required
            error={state.fieldErrors.kind?.[0]}
          />
          <Input
            key={kind}
            id={`${formId}-amount`}
            name="amount"
            label="Amount (₹)"
            inputMode="decimal"
            defaultValue={
              state.values?.amount || (kind === "refund" && held > 0 ? paiseToInput(held) : "")
            }
            required
            hint={kind === "collected" ? undefined : `Up to ${formatPaise(held)}.`}
            error={state.fieldErrors.amount?.[0]}
          />
          <div className="grid gap-4 sm:grid-cols-2">
            <Input
              id={`${formId}-date`}
              name="entry_date"
              type="date"
              label="Date"
              max={today}
              defaultValue={state.values?.entry_date || today}
              required
              error={state.fieldErrors.entry_date?.[0]}
            />
            {movesMoney && (
              <Select
                id={`${formId}-mode`}
                name="mode"
                label="Mode"
                placeholder="Choose a mode"
                options={PAYMENT_MODE_OPTIONS}
                defaultValue={state.values?.mode ?? ""}
                required
                error={state.fieldErrors.mode?.[0]}
              />
            )}
          </div>
          {movesMoney && (
            <Input
              id={`${formId}-reference`}
              name="reference"
              label="Reference"
              defaultValue={state.values?.reference ?? ""}
              hint="Optional. UPI transaction ID, cheque or receipt number."
              maxLength={100}
              error={state.fieldErrors.reference?.[0]}
            />
          )}
          <Textarea
            id={`${formId}-reason`}
            name="reason"
            label={kind === "deduction" ? "Reason" : "Note"}
            rows={2}
            maxLength={500}
            defaultValue={state.values?.reason ?? ""}
            required={kind === "deduction"}
            hint={
              kind === "deduction"
                ? "For example: broken cupboard, or last month's rent unpaid."
                : "Optional."
            }
            error={state.fieldErrors.reason?.[0]}
          />
        </form>
      </Modal>
    </>
  );
}
