"use client";

import { useActionState } from "react";

import { HostelField } from "@/components/shell/ActiveHostel";
import { Alert, Button } from "@/components/ui";
import { initialFormState } from "@/lib/validation/result";

import { billElectricity, saveMeterReading } from "../actions";

/** One room's meter reading for the month, inline in the readings table. */
export function ReadingForm({
  roomId,
  roomNumber,
  month,
  reading,
  locked,
}: {
  roomId: string;
  roomNumber: string;
  /** `YYYY-MM`. */
  month: string;
  reading: number | null;
  /** Already billed: the reading is final. */
  locked: boolean;
}) {
  const [state, action, pending] = useActionState(saveMeterReading, initialFormState);
  const error = state.formError ?? state.fieldErrors.reading?.[0];
  if (locked) return <span className="tabular-nums">{reading}</span>;
  return (
    <form key={state.id} action={action} noValidate className="flex flex-wrap items-center gap-2">
      <HostelField />
      <input type="hidden" name="room_id" value={roomId} />
      <input type="hidden" name="reading_month" value={month} />
      <label htmlFor={`reading-${roomId}`} className="sr-only">
        Reading for room {roomNumber}
      </label>
      <input
        id={`reading-${roomId}`}
        name="reading"
        inputMode="decimal"
        defaultValue={state.values?.reading ?? (reading === null ? "" : String(reading))}
        aria-invalid={error ? true : undefined}
        className="h-9 w-28 rounded-md border border-slate-300 px-2 text-sm tabular-nums"
      />
      <Button type="submit" size="sm" variant="secondary" loading={pending}>
        Save
      </Button>
      {error && <span className="basis-full text-xs text-red-700">{error}</span>}
      {state.status === "success" && (
        <span role="status" className="text-xs text-emerald-700">
          {state.message}
        </span>
      )}
    </form>
  );
}

export function BillElectricityForm({ month }: { month: string }) {
  const [state, action, pending] = useActionState(billElectricity, initialFormState);
  return (
    <form key={state.id} action={action} className="space-y-3">
      <HostelField />
      <input type="hidden" name="period_month" value={month} />
      {state.formError && <Alert tone="error">{state.formError}</Alert>}
      {state.status === "success" && <Alert tone="success">{state.message}</Alert>}
      {state.warning && <Alert tone="warning">{state.warning}</Alert>}
      <Button type="submit" loading={pending}>
        Add electricity charges
      </Button>
    </form>
  );
}
