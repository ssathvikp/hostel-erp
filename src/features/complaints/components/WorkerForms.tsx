"use client";

import { useActionState } from "react";

import { HostelField } from "@/components/shell/ActiveHostel";
import { Alert, Button, Checkbox, Input, Select, Textarea } from "@/components/ui";
import { paiseToInput } from "@/lib/money";
import { todayIst } from "@/lib/validation";
import { initialFormState } from "@/lib/validation/result";

import { addWorkerTimeOff, saveWorker } from "../actions";
import { TRADE_LABELS, TRADES } from "../options";
import type { Worker } from "../queries";

/** Adds or edits a worker (ClickUp EP-15 T6). */
export function WorkerForm({ worker }: { worker?: Worker }) {
  const [state, action, pending] = useActionState(saveWorker, initialFormState);
  const values = state.status === "error" ? (state.values ?? {}) : {};
  const prefix = worker ? `worker-${worker.id}` : "worker-new";
  const fresh = !worker && state.status === "success";
  return (
    <form key={state.id} action={action} noValidate className="space-y-4">
      <HostelField />
      {worker && <input type="hidden" name="worker_id" value={worker.id} />}
      {state.formError && <Alert tone="error">{state.formError}</Alert>}
      {state.status === "success" && (
        <p role="status" className="text-sm text-emerald-700">
          {state.message}
        </p>
      )}
      <div className="grid gap-4 sm:grid-cols-2">
        {worker ? (
          <input type="hidden" name="kind" value={worker.kind} />
        ) : (
          <Select
            id={`${prefix}-kind`}
            name="kind"
            label="Kind"
            options={[
              { value: "vendor", label: "Outside vendor (all your hostels)" },
              { value: "on_site", label: "On-site staff (this hostel)" },
            ]}
            defaultValue={values.kind ?? "vendor"}
            error={state.fieldErrors.kind?.[0]}
          />
        )}
        <Input
          id={`${prefix}-name`}
          name="full_name"
          label="Name"
          required
          defaultValue={fresh ? "" : (values.full_name ?? worker?.fullName ?? "")}
          error={state.fieldErrors.full_name?.[0]}
        />
        <Input
          id={`${prefix}-business`}
          name="business_name"
          label="Business (optional)"
          defaultValue={fresh ? "" : (values.business_name ?? worker?.businessName ?? "")}
          error={state.fieldErrors.business_name?.[0]}
        />
        <Input
          id={`${prefix}-phone`}
          name="phone"
          label="Mobile"
          inputMode="tel"
          required
          defaultValue={fresh ? "" : (values.phone ?? worker?.phone ?? "")}
          error={state.fieldErrors.phone?.[0]}
        />
        <Input
          id={`${prefix}-callout`}
          name="call_out_charge"
          label="Call-out charge (₹, optional)"
          inputMode="decimal"
          defaultValue={
            fresh
              ? ""
              : (values.call_out_charge ??
                (worker?.callOutCharge != null ? paiseToInput(worker.callOutCharge) : ""))
          }
          error={state.fieldErrors.call_out_charge?.[0]}
        />
      </div>
      <fieldset>
        <legend className="text-sm font-medium text-slate-800">Trades</legend>
        <div className="mt-2 grid grid-cols-2 gap-2 text-sm sm:grid-cols-4">
          {TRADES.map((trade) => (
            <label key={trade} className="flex items-center gap-2">
              <input
                type="checkbox"
                name="trades"
                value={trade}
                defaultChecked={!fresh && (worker?.trades.includes(trade) ?? false)}
                className="accent-brand-600"
              />
              {TRADE_LABELS[trade]}
            </label>
          ))}
        </div>
        {state.fieldErrors.trades?.[0] && (
          <p className="mt-1 text-sm text-red-700">{state.fieldErrors.trades[0]}</p>
        )}
      </fieldset>
      <Textarea
        id={`${prefix}-notes`}
        name="notes"
        label="Notes (optional)"
        rows={2}
        defaultValue={fresh ? "" : (values.notes ?? worker?.notes ?? "")}
        error={state.fieldErrors.notes?.[0]}
      />
      <Checkbox
        id={`${prefix}-preferred`}
        name="preferred"
        label="Preferred vendor"
        hint="Jobs go to on-site staff first, then preferred vendors, then other vendors."
        defaultChecked={!fresh && (worker?.preferred ?? false)}
      />
      <Button type="submit" loading={pending}>
        {worker ? "Save worker" : "Add worker"}
      </Button>
    </form>
  );
}

export function TimeOffForm({ workerId }: { workerId: string }) {
  const [state, action, pending] = useActionState(addWorkerTimeOff, initialFormState);
  const values = state.status === "error" ? (state.values ?? {}) : {};
  return (
    <form key={state.id} action={action} noValidate className="space-y-3">
      <HostelField />
      <input type="hidden" name="worker_id" value={workerId} />
      {state.formError && <Alert tone="error">{state.formError}</Alert>}
      {state.status === "success" && (
        <p role="status" className="text-sm text-emerald-700">
          {state.message}
        </p>
      )}
      <div className="grid gap-3 sm:grid-cols-3">
        <Input
          id={`timeoff-from-${workerId}`}
          name="from_date"
          type="date"
          label="From"
          defaultValue={values.from_date ?? todayIst()}
          error={state.fieldErrors.from_date?.[0]}
        />
        <Input
          id={`timeoff-to-${workerId}`}
          name="to_date"
          type="date"
          label="To"
          defaultValue={values.to_date ?? todayIst()}
          error={state.fieldErrors.to_date?.[0]}
        />
        <Input
          id={`timeoff-reason-${workerId}`}
          name="reason"
          label="Reason (optional)"
          defaultValue={values.reason ?? ""}
          error={state.fieldErrors.reason?.[0]}
        />
      </div>
      <Button type="submit" size="sm" variant="secondary" loading={pending}>
        Add time off
      </Button>
    </form>
  );
}
