"use client";

import { useActionState, useState, useTransition } from "react";

import { HostelField } from "@/components/shell/ActiveHostel";
import { Alert, Button, buttonClass, Input, Select, Textarea } from "@/components/ui";
import { PAYMENT_MODE_OPTIONS } from "@/features/fees/options";
import { todayIst } from "@/lib/validation";
import { initialFormState, type FormState } from "@/lib/validation/result";

import {
  addComplaintCost,
  assignComplaint,
  commentOnComplaint,
  createJobLink,
  recordPayout,
  setComplaintStatus,
  voidComplaintCost,
  type JobLinkResult,
} from "../actions";
import { COST_KIND_OPTIONS, NEXT_STATUSES, STATUS_LABELS, type ComplaintStatus } from "../options";

function Feedback({ state }: { state: FormState }) {
  if (state.formError) return <Alert tone="error">{state.formError}</Alert>;
  if (state.status === "success" && state.warning)
    return <Alert tone="warning">{state.warning}</Alert>;
  if (state.status === "success" && state.message) {
    return (
      <p role="status" className="text-sm text-emerald-700">
        {state.message}
      </p>
    );
  }
  return null;
}

type Action = (previous: FormState, formData: FormData) => Promise<FormState>;

/** A button that runs one action with fixed fields, e.g. a toggle. */
export function InlineAction({
  action,
  fields,
  label,
  variant = "secondary",
  ariaLabel,
}: {
  action: Action;
  fields: Record<string, string>;
  label: string;
  variant?: "primary" | "secondary" | "danger";
  ariaLabel?: string;
}) {
  const [state, run, pending] = useActionState(action, initialFormState);
  return (
    <form action={run} className="inline-flex flex-col items-end gap-1">
      <HostelField />
      {Object.entries(fields).map(([name, value]) => (
        <input key={name} type="hidden" name={name} value={value} />
      ))}
      <Button type="submit" size="sm" variant={variant} loading={pending} aria-label={ariaLabel}>
        {label}
      </Button>
      {state.formError && <span className="text-xs text-red-700">{state.formError}</span>}
    </form>
  );
}

export function StatusForm({
  complaintId,
  status,
}: {
  complaintId: string;
  status: ComplaintStatus;
}) {
  const [state, action, pending] = useActionState(setComplaintStatus, initialFormState);
  const next = NEXT_STATUSES[status];
  const [choice, setChoice] = useState<string>(state.values?.status ?? next[0] ?? "");
  if (next.length === 0) return null;
  return (
    <form key={state.id} action={action} noValidate className="space-y-3">
      <HostelField />
      <input type="hidden" name="complaint_id" value={complaintId} />
      <Feedback state={state} />
      <Select
        id="complaint-status"
        name="status"
        label="Move to"
        options={next.map((value) => ({ value, label: STATUS_LABELS[value] }))}
        value={choice}
        onChange={(event) => setChoice(event.target.value)}
        error={state.fieldErrors.status?.[0]}
      />
      <Input
        id="complaint-status-note"
        name="note"
        label={choice === "on_hold" || choice === "reopened" ? "Why" : "Note (optional)"}
        required={choice === "on_hold" || choice === "reopened"}
        defaultValue={state.values?.note ?? ""}
        error={state.fieldErrors.note?.[0]}
      />
      <Button type="submit" loading={pending}>
        Update status
      </Button>
    </form>
  );
}

export function AssignForm({
  complaintId,
  workers,
  workerId,
}: {
  complaintId: string;
  workers: readonly { id: string; label: string }[];
  workerId: string | null;
}) {
  const [state, action, pending] = useActionState(assignComplaint, initialFormState);
  return (
    <form key={state.id} action={action} noValidate className="space-y-3">
      <HostelField />
      <input type="hidden" name="complaint_id" value={complaintId} />
      <Feedback state={state} />
      <Select
        id="complaint-worker"
        name="worker_id"
        label="Worker"
        placeholder="Nobody"
        options={workers.map((worker) => ({ value: worker.id, label: worker.label }))}
        defaultValue={state.values?.worker_id ?? workerId ?? ""}
        error={state.fieldErrors.worker_id?.[0]}
      />
      <div className="flex flex-wrap gap-2">
        <Button type="submit" loading={pending}>
          Assign
        </Button>
        <Button type="submit" variant="secondary" name="auto" value="1" disabled={pending}>
          Pick automatically
        </Button>
      </div>
    </form>
  );
}

export function CommentForm({ complaintId }: { complaintId: string }) {
  const [state, action, pending] = useActionState(commentOnComplaint, initialFormState);
  return (
    <form key={state.id} action={action} noValidate className="space-y-3">
      <HostelField />
      <input type="hidden" name="complaint_id" value={complaintId} />
      <Feedback state={state} />
      <Textarea
        id="complaint-comment"
        name="body"
        label="Add a comment"
        rows={2}
        defaultValue={state.status === "error" ? (state.values?.body ?? "") : ""}
        error={state.fieldErrors.body?.[0]}
      />
      <Button type="submit" variant="secondary" loading={pending}>
        Comment
      </Button>
    </form>
  );
}

/** Makes a job link for the assigned worker and offers it on WhatsApp (T8). */
export function JobLinkButton({
  complaintId,
  workerName,
}: {
  complaintId: string;
  workerName: string;
}) {
  const [result, setResult] = useState<JobLinkResult | null>(null);
  const [copied, setCopied] = useState(false);
  const [pending, startTransition] = useTransition();
  return (
    <div className="space-y-2">
      <Button
        variant="secondary"
        loading={pending}
        onClick={() =>
          startTransition(async () => {
            setCopied(false);
            setResult(await createJobLink(complaintId));
          })
        }
      >
        {result?.ok ? "Make a new link" : "Send job link"}
      </Button>
      {result && !result.ok && <Alert tone="error">{result.error}</Alert>}
      {result?.ok && (
        <div className="space-y-2 rounded-md border border-slate-200 bg-slate-50 p-3 text-sm">
          <p className="text-slate-700">
            {workerName} can open this link without an account. It stops working when the job is
            done or given to someone else.
          </p>
          <p className="font-mono text-xs break-all text-slate-900">{result.url}</p>
          <div className="flex flex-wrap gap-2">
            {result.whatsApp && (
              <a
                href={result.whatsApp}
                target="_blank"
                rel="noopener noreferrer"
                className={buttonClass({ size: "sm" })}
              >
                Send on WhatsApp
              </a>
            )}
            <Button
              size="sm"
              variant="secondary"
              onClick={async () => {
                try {
                  await navigator.clipboard.writeText(result.url);
                  setCopied(true);
                } catch {
                  setCopied(false);
                }
              }}
            >
              Copy link
            </Button>
            {copied && (
              <span role="status" className="self-center text-emerald-700">
                Copied.
              </span>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

export function CostForm({
  complaintId,
  hasResident,
}: {
  complaintId: string;
  hasResident: boolean;
}) {
  const [state, action, pending] = useActionState(addComplaintCost, initialFormState);
  const values = state.status === "error" ? (state.values ?? {}) : {};
  return (
    <form key={state.id} action={action} noValidate className="space-y-3">
      <HostelField />
      <input type="hidden" name="complaint_id" value={complaintId} />
      <Feedback state={state} />
      <div className="grid gap-3 sm:grid-cols-3">
        <Select
          id="cost-kind"
          name="kind"
          label="Cost"
          options={COST_KIND_OPTIONS}
          defaultValue={values.kind ?? "labour"}
          error={state.fieldErrors.kind?.[0]}
        />
        <Input
          id="cost-amount"
          name="amount"
          label="Amount (₹)"
          inputMode="decimal"
          defaultValue={values.amount ?? ""}
          required
          error={state.fieldErrors.amount?.[0]}
        />
        <Select
          id="cost-payer"
          name="payer"
          label="Who pays"
          options={[
            { value: "hostel", label: "The hostel" },
            { value: "resident", label: "The resident", disabled: !hasResident },
          ]}
          defaultValue={values.payer ?? "hostel"}
          hint={hasResident ? undefined : "Link a resident to charge them."}
          error={state.fieldErrors.payer?.[0]}
        />
      </div>
      <Input
        id="cost-description"
        name="description"
        label="Description (optional)"
        defaultValue={values.description ?? ""}
        error={state.fieldErrors.description?.[0]}
      />
      <Button type="submit" variant="secondary" loading={pending}>
        Add cost
      </Button>
    </form>
  );
}

export function VoidCostForm({ costId, complaintId }: { costId: string; complaintId: string }) {
  const [open, setOpen] = useState(false);
  const [state, action, pending] = useActionState(voidComplaintCost, initialFormState);
  if (!open) {
    return (
      <Button size="sm" variant="secondary" onClick={() => setOpen(true)}>
        Void
      </Button>
    );
  }
  return (
    <form action={action} noValidate className="flex flex-wrap items-end gap-2">
      <HostelField />
      <input type="hidden" name="cost_id" value={costId} />
      <input type="hidden" name="complaint_id" value={complaintId} />
      <Input
        id={`void-cost-${costId}`}
        name="reason"
        label="Why"
        required
        error={state.fieldErrors.reason?.[0] ?? state.formError}
      />
      <Button type="submit" size="sm" variant="danger" loading={pending}>
        Void cost
      </Button>
    </form>
  );
}

export function PayoutForm({
  complaintId,
  workers,
  workerId,
}: {
  complaintId: string;
  workers: readonly { id: string; label: string }[];
  workerId: string | null;
}) {
  const [state, action, pending] = useActionState(recordPayout, initialFormState);
  const values = state.status === "error" ? (state.values ?? {}) : {};
  return (
    <form key={state.id} action={action} noValidate className="space-y-3">
      <HostelField />
      <input type="hidden" name="complaint_id" value={complaintId} />
      <Feedback state={state} />
      <div className="grid gap-3 sm:grid-cols-2">
        <Select
          id="payout-worker"
          name="worker_id"
          label="Paid to"
          options={workers.map((worker) => ({ value: worker.id, label: worker.label }))}
          defaultValue={values.worker_id ?? workerId ?? workers[0]?.id ?? ""}
          error={state.fieldErrors.worker_id?.[0]}
        />
        <Input
          id="payout-amount"
          name="amount"
          label="Amount (₹)"
          inputMode="decimal"
          defaultValue={values.amount ?? ""}
          required
          error={state.fieldErrors.amount?.[0]}
        />
        <Input
          id="payout-date"
          name="paid_at"
          type="date"
          label="Date"
          max={todayIst()}
          defaultValue={values.paid_at ?? todayIst()}
          error={state.fieldErrors.paid_at?.[0]}
        />
        <Select
          id="payout-mode"
          name="mode"
          label="Paid by"
          options={[...PAYMENT_MODE_OPTIONS, { value: "cheque", label: "Cheque" }]}
          defaultValue={values.mode ?? "upi"}
          error={state.fieldErrors.mode?.[0]}
        />
      </div>
      <Input
        id="payout-reference"
        name="reference"
        label="Reference (optional)"
        defaultValue={values.reference ?? ""}
        error={state.fieldErrors.reference?.[0]}
      />
      <Button type="submit" variant="secondary" loading={pending}>
        Record payout
      </Button>
    </form>
  );
}
