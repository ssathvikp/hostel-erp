"use client";

import { useActionState, useEffect, useState } from "react";

import { Alert, Button, Input, Modal } from "@/components/ui";
import { paiseToInput } from "@/lib/money";
import { initialFormState } from "@/lib/validation/result";

import { recordMeterReading, saveElectricityRate } from "../actions";

/** The rate per unit (E13-T3). Owners only; blank stops billing electricity. */
export function ElectricityRateForm({ unitRate }: { unitRate: number | null }) {
  const [state, action, pending] = useActionState(saveElectricityRate, initialFormState);

  return (
    <form key={state.id} action={action} noValidate className="space-y-4">
      {state.formError && <Alert tone="error">{state.formError}</Alert>}
      {state.status === "success" && <Alert tone="success">{state.message}</Alert>}
      <div className="flex flex-wrap items-end gap-4">
        <Input
          id="electricity-rate"
          name="unit_rate"
          label="Rate per unit (₹)"
          inputMode="decimal"
          defaultValue={state.values?.unit_rate ?? (unitRate ? paiseToInput(unitRate) : "")}
          hint="Leave blank if the hostel does not bill electricity."
          error={state.fieldErrors.unit_rate?.[0]}
          className="w-44"
        />
        <Button type="submit" loading={pending}>
          Save rate
        </Button>
      </div>
    </form>
  );
}

/** Records one room's opening and closing units for the month. */
export function MeterReadingDialog({
  roomId,
  roomNumber,
  month,
  monthLabel,
  previousClosing,
}: {
  roomId: string;
  roomNumber: string;
  /** YYYY-MM-01 */
  month: string;
  monthLabel: string;
  previousClosing: number | null;
}) {
  const [open, setOpen] = useState(false);
  const [state, action, pending] = useActionState(recordMeterReading, initialFormState);
  const formId = `meter-${roomId}`;

  useEffect(() => {
    if (state.status === "success") setOpen(false);
  }, [state]);

  return (
    <>
      <Button
        size="sm"
        onClick={() => setOpen(true)}
        aria-label={`Record reading for room ${roomNumber}`}
      >
        Record
      </Button>
      {state.status === "success" && (
        <span role="status" className="sr-only">
          {state.message}
        </span>
      )}
      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title={`Room ${roomNumber}, ${monthLabel}`}
        description="The units are split between everyone who held a bed in the room that month, by nights, and added to their next invoice."
        footer={
          <>
            <Button variant="secondary" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" form={formId} loading={pending}>
              Record reading
            </Button>
          </>
        }
      >
        <form key={state.id} id={formId} action={action} noValidate className="space-y-4">
          {state.formError && <Alert tone="error">{state.formError}</Alert>}
          <input type="hidden" name="room_id" value={roomId} />
          <input type="hidden" name="period_month" value={month.slice(0, 7)} />
          <div className="grid gap-4 sm:grid-cols-2">
            <Input
              id={`${formId}-opening`}
              name="opening"
              label="Opening units"
              inputMode="decimal"
              defaultValue={state.values?.opening ?? (previousClosing ?? "").toString()}
              hint={
                previousClosing === null
                  ? "The meter at the start of the month."
                  : "Last month's closing reading."
              }
              required
              error={state.fieldErrors.opening?.[0]}
            />
            <Input
              id={`${formId}-closing`}
              name="closing"
              label="Closing units"
              inputMode="decimal"
              defaultValue={state.values?.closing ?? ""}
              hint="The meter at the end of the month."
              required
              error={state.fieldErrors.closing?.[0]}
            />
          </div>
        </form>
      </Modal>
    </>
  );
}
