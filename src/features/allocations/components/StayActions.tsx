"use client";

import { useActionState, useEffect, useState, type ReactNode } from "react";

import { Alert, Button, Checkbox, Input, Modal, Select, type SelectOption } from "@/components/ui";
import { todayIst } from "@/lib/validation";
import { initialFormState } from "@/lib/validation/result";

import { transferBed, vacateBed } from "../actions";
import { VACATE_REASON_OPTIONS } from "../options";

interface Stay {
  allocationId: string;
  residentId: string;
  residentName: string;
  bedLabel: string;
  /** First night in the bed, `YYYY-MM-DD`. */
  startDate: string;
}

/** The day after `date`: the earliest a move can happen. */
function nextDay(date: string): string {
  const next = new Date(`${date}T00:00:00Z`);
  next.setUTCDate(next.getUTCDate() + 1);
  return next.toISOString().slice(0, 10);
}

/**
 * Vacate and transfer for a resident's current bed (E6-T4). Both are one
 * database call each; a transfer either fully happens or not at all.
 */
export function StayActions({
  stay,
  bedOptions,
  feeSummary,
  size = "md",
}: {
  stay: Stay;
  bedOptions: readonly SelectOption[];
  /** What the resident owes, shown before a transfer is confirmed (E7-T5 fills it). */
  feeSummary: ReactNode;
  size?: "sm" | "md";
}) {
  const earliest = nextDay(stay.startDate);
  const today = todayIst();
  const sameDay = earliest > today;

  return (
    <div className="flex flex-wrap gap-2">
      <TransferDialog
        stay={stay}
        bedOptions={bedOptions}
        feeSummary={feeSummary}
        earliest={earliest}
        disabled={sameDay}
        size={size}
      />
      <VacateDialog stay={stay} earliest={earliest} disabled={sameDay} size={size} />
      {sameDay && (
        <p className="basis-full text-xs text-slate-500">
          This allocation started today. It can be vacated or transferred from tomorrow.
        </p>
      )}
    </div>
  );
}

function VacateDialog({
  stay,
  earliest,
  disabled,
  size,
}: {
  stay: Stay;
  earliest: string;
  disabled: boolean;
  size: "sm" | "md";
}) {
  const [open, setOpen] = useState(false);
  const [state, action, pending] = useActionState(vacateBed, initialFormState);
  const formId = `vacate-${stay.allocationId}`;
  const today = todayIst();

  useEffect(() => {
    if (state.status === "success") setOpen(false);
  }, [state]);

  return (
    <>
      <Button
        variant="secondary"
        size={size}
        disabled={disabled}
        onClick={() => setOpen(true)}
        aria-label={`Vacate bed ${stay.bedLabel}`}
      >
        Vacate
      </Button>
      {state.status === "success" && (
        <span role="status" className="sr-only">
          {state.message}
        </span>
      )}
      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title={`Vacate bed ${stay.bedLabel}`}
        description={`${stay.residentName} leaves the bed. Their last night is the day before the move-out date, and the bed is free from the move-out date.`}
        footer={
          <>
            <Button variant="secondary" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" form={formId} loading={pending}>
              Vacate bed
            </Button>
          </>
        }
      >
        <form key={state.id} id={formId} action={action} noValidate className="space-y-4">
          {state.formError && <Alert tone="error">{state.formError}</Alert>}
          <input type="hidden" name="allocation_id" value={stay.allocationId} />
          <input type="hidden" name="resident_id" value={stay.residentId} />
          <Input
            id={`${formId}-date`}
            name="move_out_date"
            type="date"
            label="Move-out date"
            min={earliest}
            max={today}
            defaultValue={state.values?.move_out_date || today}
            required
            error={state.fieldErrors.move_out_date?.[0]}
          />
          <Select
            id={`${formId}-reason`}
            name="vacate_reason"
            label="Reason"
            placeholder="Choose a reason"
            options={VACATE_REASON_OPTIONS}
            defaultValue={state.values?.vacate_reason ?? ""}
            required
            error={state.fieldErrors.vacate_reason?.[0]}
          />
          <Checkbox
            id={`${formId}-mark`}
            name="mark_vacated"
            label="Also mark the resident as vacated"
            hint="They stay searchable, but are not billed or given a bed until reactivated."
            defaultChecked={state.values ? state.values.mark_vacated === "on" : true}
          />
        </form>
      </Modal>
    </>
  );
}

function TransferDialog({
  stay,
  bedOptions,
  feeSummary,
  earliest,
  disabled,
  size,
}: {
  stay: Stay;
  bedOptions: readonly SelectOption[];
  feeSummary: ReactNode;
  earliest: string;
  disabled: boolean;
  size: "sm" | "md";
}) {
  const [open, setOpen] = useState(false);
  const [state, action, pending] = useActionState(transferBed, initialFormState);
  const formId = `transfer-${stay.allocationId}`;
  const today = todayIst();
  const empty = bedOptions.length === 0;

  useEffect(() => {
    if (state.status === "success") setOpen(false);
  }, [state]);

  return (
    <>
      <Button
        size={size}
        disabled={disabled}
        onClick={() => setOpen(true)}
        aria-label={`Transfer ${stay.residentName} to another bed`}
      >
        Transfer
      </Button>
      {state.status === "success" && (
        <span role="status" className="sr-only">
          {state.message}
        </span>
      )}
      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title={`Move ${stay.residentName} to another bed`}
        description={`Closes the stay in bed ${stay.bedLabel} and opens one in the new bed in a single step.`}
        footer={
          <>
            <Button variant="secondary" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" form={formId} loading={pending} disabled={empty}>
              Confirm transfer
            </Button>
          </>
        }
      >
        {empty ? (
          <Alert tone="info">There are no vacant beds to move to.</Alert>
        ) : (
          <form key={state.id} id={formId} action={action} noValidate className="space-y-4">
            {state.formError && <Alert tone="error">{state.formError}</Alert>}
            <input type="hidden" name="allocation_id" value={stay.allocationId} />
            <input type="hidden" name="resident_id" value={stay.residentId} />
            <Select
              id={`${formId}-bed`}
              name="bed_id"
              label="New bed"
              placeholder="Choose a vacant bed"
              options={bedOptions}
              defaultValue={state.values?.bed_id ?? ""}
              required
              error={state.fieldErrors.bed_id?.[0]}
            />
            <Input
              id={`${formId}-date`}
              name="move_date"
              type="date"
              label="First night in the new bed"
              min={earliest}
              max={today}
              defaultValue={state.values?.move_date || today}
              required
              error={state.fieldErrors.move_date?.[0]}
            />
            <Input
              id={`${formId}-rent`}
              name="rent_override"
              label="Monthly rent override (₹)"
              inputMode="decimal"
              defaultValue={state.values?.rent_override ?? ""}
              hint="Optional. Leave blank to use the fee structure for the new room's sharing type."
              error={state.fieldErrors.rent_override?.[0]}
            />
            <div className="rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
              <p className="font-medium">Before you confirm</p>
              <div className="mt-1">{feeSummary}</div>
            </div>
          </form>
        )}
      </Modal>
    </>
  );
}
