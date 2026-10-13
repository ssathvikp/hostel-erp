"use client";

import { useActionState, useEffect, useState } from "react";

import { Alert, Button, Input, Modal, Select, Textarea } from "@/components/ui";
import { paiseToInput } from "@/lib/money";
import { todayIst } from "@/lib/validation";
import { initialFormState, type FormState } from "@/lib/validation/result";
import { TRADES, type Trade, type WorkerKind } from "@/types";

import {
  addWorkerToHostel,
  addWorkerUnavailability,
  removeWorkerUnavailability,
  saveWorker,
  setWorkerActive,
} from "../actions";
import { TRADE_LABELS, WORKER_KIND_LABELS } from "../options";
import type { WorkerRow } from "../queries";

function useDialog(state: FormState) {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (state.status === "success") setOpen(false);
  }, [state]);
  return { open, setOpen };
}

function Announce({ state }: { state: FormState }) {
  if (state.status === "success" && state.message) {
    return (
      <span role="status" className="sr-only">
        {state.message}
      </span>
    );
  }
  if (state.status === "error" && state.formError) {
    return <Alert tone="error">{state.formError}</Alert>;
  }
  return null;
}

function TradeChecks({
  name,
  legend,
  hint,
  selected,
  only,
  error,
  idPrefix,
}: {
  name: string;
  legend: string;
  hint?: string;
  selected: readonly string[];
  only?: readonly Trade[];
  error?: string;
  idPrefix: string;
}) {
  const trades = only ?? TRADES;
  return (
    <fieldset className="space-y-2">
      <legend className="text-sm font-medium text-slate-800">{legend}</legend>
      {hint && <p className="text-xs text-slate-500">{hint}</p>}
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
        {trades.map((trade) => (
          <label key={trade} className="flex items-center gap-2 text-sm">
            <input
              id={`${idPrefix}-${name}-${trade}`}
              type="checkbox"
              name={name}
              value={trade}
              defaultChecked={selected.includes(trade)}
              className="size-4 accent-brand-600"
            />
            {TRADE_LABELS[trade]}
          </label>
        ))}
      </div>
      {error && <p className="text-xs text-red-600">{error}</p>}
    </fieldset>
  );
}

/**
 * Adds or edits a worker (E15-T6): the hostel's own staff, or an outside
 * vendor with a business name and call-out charge.
 */
export function WorkerDialog({ worker }: { worker?: WorkerRow }) {
  const [state, action, pending] = useActionState(saveWorker, initialFormState);
  const { open, setOpen } = useDialog(state);
  const values = state.values;
  const [kind, setKind] = useState<WorkerKind>(
    (values?.kind as WorkerKind) || worker?.kind || "vendor",
  );
  const formId = `worker-${worker?.id ?? "new"}`;
  const trades = values?.trades?.split(",").filter(Boolean) ?? worker?.trades ?? [];
  const preferred =
    values?.preferred_trades?.split(",").filter(Boolean) ?? worker?.preferredTrades ?? [];

  return (
    <>
      <Button
        size={worker ? "sm" : "md"}
        variant={worker ? "secondary" : "primary"}
        onClick={() => setOpen(true)}
        aria-label={worker ? `Edit ${worker.name}` : undefined}
      >
        {worker ? "Edit" : "Add worker"}
      </Button>
      <Announce state={state.status === "success" ? state : initialFormState} />
      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title={worker ? `Edit ${worker.name}` : "Add a worker"}
        description="Complaints are routed by trade: your own staff first, then your first-choice vendor, then any vendor."
        footer={
          <>
            <Button variant="secondary" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" form={formId} loading={pending}>
              Save
            </Button>
          </>
        }
      >
        <form key={state.id} id={formId} action={action} noValidate className="space-y-4">
          {state.formError && <Alert tone="error">{state.formError}</Alert>}
          {worker && <input type="hidden" name="worker_id" value={worker.id} />}
          {worker ? (
            <input type="hidden" name="kind" value={worker.kind} />
          ) : (
            <Select
              id={`${formId}-kind`}
              name="kind"
              label="Type"
              options={(["vendor", "on_site"] as const).map((k) => ({
                value: k,
                label: WORKER_KIND_LABELS[k],
              }))}
              value={kind}
              onChange={(event) => setKind(event.target.value as WorkerKind)}
              error={state.fieldErrors.kind?.[0]}
            />
          )}
          <div className="grid gap-4 sm:grid-cols-2">
            <Input
              id={`${formId}-name`}
              name="name"
              label="Name"
              defaultValue={values?.name ?? worker?.name ?? ""}
              required
              maxLength={100}
              error={state.fieldErrors.name?.[0]}
            />
            <Input
              id={`${formId}-phone`}
              name="phone"
              label="Mobile"
              inputMode="tel"
              defaultValue={values?.phone ?? worker?.phone ?? ""}
              required
              error={state.fieldErrors.phone?.[0]}
            />
            {kind === "vendor" && (
              <>
                <Input
                  id={`${formId}-business`}
                  name="business_name"
                  label="Business name"
                  defaultValue={values?.business_name ?? worker?.businessName ?? ""}
                  maxLength={100}
                  hint="Optional."
                  error={state.fieldErrors.business_name?.[0]}
                />
                <Input
                  id={`${formId}-callout`}
                  name="call_out_charge"
                  label="Call-out charge (₹)"
                  inputMode="decimal"
                  defaultValue={
                    values?.call_out_charge ??
                    (worker?.callOutCharge != null ? paiseToInput(worker.callOutCharge) : "")
                  }
                  hint="Optional. What they charge to come out."
                  error={state.fieldErrors.call_out_charge?.[0]}
                />
              </>
            )}
          </div>
          <TradeChecks
            idPrefix={formId}
            name="trades"
            legend="Trades"
            selected={trades}
            error={state.fieldErrors.trades?.[0]}
          />
          {kind === "vendor" && (
            <TradeChecks
              idPrefix={formId}
              name="preferred_trades"
              legend="First choice for this hostel"
              hint="Complaints in these trades go to this vendor before any other vendor."
              selected={preferred}
              error={state.fieldErrors.preferred_trades?.[0]}
            />
          )}
          <Textarea
            id={`${formId}-notes`}
            name="notes"
            label="Notes"
            rows={2}
            defaultValue={values?.notes ?? worker?.notes ?? ""}
            maxLength={500}
            hint="Optional. Working hours, languages, what they are good at."
            error={state.fieldErrors.notes?.[0]}
          />
        </form>
      </Modal>
    </>
  );
}

export function WorkerActiveToggle({ worker }: { worker: WorkerRow }) {
  const [state, action, pending] = useActionState(setWorkerActive, initialFormState);
  return (
    <form action={action} className="inline">
      <input type="hidden" name="worker_id" value={worker.id} />
      <input type="hidden" name="active" value={String(!worker.active)} />
      <Button
        type="submit"
        size="sm"
        variant="ghost"
        loading={pending}
        aria-label={`${worker.active ? "Stop jobs for" : "Resume jobs for"} ${worker.name}`}
      >
        {worker.active ? "Stop jobs" : "Resume jobs"}
      </Button>
      <Announce state={state} />
    </form>
  );
}

/** Leave or busy days: routing skips the worker on these dates. */
export function UnavailableDialog({ worker }: { worker: WorkerRow }) {
  const [state, action, pending] = useActionState(addWorkerUnavailability, initialFormState);
  const { open, setOpen } = useDialog(state);
  const formId = `away-${worker.id}`;
  const today = todayIst();
  return (
    <>
      <Button
        size="sm"
        variant="ghost"
        onClick={() => setOpen(true)}
        aria-label={`Add time off for ${worker.name}`}
      >
        Time off
      </Button>
      <Announce state={state.status === "success" ? state : initialFormState} />
      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title={`Time off for ${worker.name}`}
        description="New jobs go to someone else on these days."
        footer={
          <>
            <Button variant="secondary" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" form={formId} loading={pending}>
              Save
            </Button>
          </>
        }
      >
        <form key={state.id} id={formId} action={action} noValidate className="space-y-4">
          {state.formError && <Alert tone="error">{state.formError}</Alert>}
          <input type="hidden" name="worker_id" value={worker.id} />
          <div className="grid gap-4 sm:grid-cols-2">
            <Input
              id={`${formId}-from`}
              name="from_date"
              type="date"
              label="From"
              defaultValue={state.values?.from_date || today}
              required
              error={state.fieldErrors.from_date?.[0]}
            />
            <Input
              id={`${formId}-to`}
              name="to_date"
              type="date"
              label="To"
              defaultValue={state.values?.to_date || today}
              required
              error={state.fieldErrors.to_date?.[0]}
            />
          </div>
          <Input
            id={`${formId}-reason`}
            name="reason"
            label="Reason"
            defaultValue={state.values?.reason ?? ""}
            maxLength={200}
            hint="Optional. Leave, festival, busy on a big job."
            error={state.fieldErrors.reason?.[0]}
          />
        </form>
      </Modal>
    </>
  );
}

export function RemoveUnavailableButton({ id, label }: { id: string; label: string }) {
  const [state, action, pending] = useActionState(removeWorkerUnavailability, initialFormState);
  return (
    <form action={action} className="inline">
      <input type="hidden" name="id" value={id} />
      <Button
        type="submit"
        size="sm"
        variant="ghost"
        loading={pending}
        aria-label={`Remove ${label}`}
      >
        Remove
      </Button>
      <Announce state={state} />
    </form>
  );
}

export function AddToHostelButton({ id, name }: { id: string; name: string }) {
  const [state, action, pending] = useActionState(addWorkerToHostel, initialFormState);
  return (
    <form action={action} className="inline">
      <input type="hidden" name="worker_id" value={id} />
      <Button
        type="submit"
        size="sm"
        variant="secondary"
        loading={pending}
        aria-label={`Add ${name} to this hostel`}
      >
        Add to this hostel
      </Button>
      <Announce state={state} />
    </form>
  );
}
