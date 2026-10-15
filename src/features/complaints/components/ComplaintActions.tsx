"use client";

import { useActionState, useEffect, useState } from "react";

import { Alert, Button, Checkbox, Input, Modal, Select, Textarea } from "@/components/ui";
import { paiseToInput } from "@/lib/money";
import { todayIst } from "@/lib/validation";
import { shrinkInputFiles } from "@/lib/images/shrink";
import { initialFormState, type FormState } from "@/lib/validation/result";
import { COMPLAINT_NEXT_STATUSES, type ComplaintPriority, type ComplaintStatus } from "@/types";

import {
  assignComplaint,
  changeComplaintStatus,
  commentOnComplaint,
  createJobLink,
  recordVendorPayout,
  routeComplaint,
  saveComplaintCosts,
  updateComplaint,
  uploadComplaintFile,
} from "../actions";
import { COMPLAINT_STATUS_ACTIONS, PAYOUT_MODE_OPTIONS, PRIORITY_OPTIONS } from "../options";

/** A form inside a modal opened by a button; closes itself once saved. */
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
      <p role="status" className="text-sm text-emerald-700">
        {state.message}
      </p>
    );
  }
  if (state.status === "error" && state.formError) {
    return <Alert tone="error">{state.formError}</Alert>;
  }
  return null;
}

/** Statuses that need a note, and what the note is called. */
const NOTE_REQUIRED: Partial<Record<ComplaintStatus, string>> = {
  on_hold: "Why is it on hold",
  reopened: "Why reopen it",
};

/**
 * One button per status the complaint can move to next (E15-T1). Assigning
 * happens through the worker picker instead, so "assigned" is not offered.
 */
export function StatusButtons({ id, status }: { id: string; status: ComplaintStatus }) {
  const [state, action, pending] = useActionState(changeComplaintStatus, initialFormState);
  const { open, setOpen } = useDialog(state);
  const [target, setTarget] = useState<ComplaintStatus | null>(null);
  // "Back to open" only makes sense to take a complaint off hold.
  const next = COMPLAINT_NEXT_STATUSES[status].filter(
    (s) => s !== "assigned" && (s !== "open" || status === "on_hold"),
  );
  const formId = `status-${id}`;
  const noteLabel = target ? NOTE_REQUIRED[target] : undefined;

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-2">
        {next.map((s) => (
          <Button
            key={s}
            size="sm"
            variant={s === "resolved" ? "primary" : "secondary"}
            onClick={() => {
              setTarget(s);
              setOpen(true);
            }}
          >
            {COMPLAINT_STATUS_ACTIONS[s]}
          </Button>
        ))}
      </div>
      {state.status === "success" && <Announce state={state} />}
      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title={target ? COMPLAINT_STATUS_ACTIONS[target] : ""}
        description={
          target === "resolved"
            ? "The resident should confirm the fix. A bed taken out of service comes back now."
            : target === "closed"
              ? "Closing ends the complaint and any job link. It can be reopened later."
              : undefined
        }
        footer={
          <>
            <Button variant="secondary" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" form={formId} loading={pending}>
              {target ? COMPLAINT_STATUS_ACTIONS[target] : "Save"}
            </Button>
          </>
        }
      >
        <form key={state.id} id={formId} action={action} noValidate className="space-y-4">
          {state.formError && <Alert tone="error">{state.formError}</Alert>}
          <input type="hidden" name="id" value={id} />
          <input type="hidden" name="status" value={target ?? ""} />
          <Textarea
            id={`${formId}-note`}
            name="note"
            label={noteLabel ?? "Note"}
            required={Boolean(noteLabel)}
            hint={noteLabel ? undefined : "Optional. Saved in the history."}
            defaultValue={state.values?.note ?? ""}
            maxLength={2000}
            error={state.fieldErrors.note?.[0]}
          />
        </form>
      </Modal>
    </div>
  );
}

/** Choose or change the worker, or let routing find one (E15-T7). */
export function AssignForm({
  id,
  workerId,
  workers,
  finished,
}: {
  id: string;
  workerId: string | null;
  workers: readonly { value: string; label: string }[];
  finished: boolean;
}) {
  const [state, action, pending] = useActionState(assignComplaint, initialFormState);
  const [routeState, routeAction, routing] = useActionState(routeComplaint, initialFormState);
  const [choice, setChoice] = useState(workerId ?? "");

  if (finished) return null;
  return (
    <div className="space-y-3">
      <form action={action} className="flex flex-wrap items-end gap-2">
        <input type="hidden" name="id" value={id} />
        <div className="min-w-48 flex-1">
          <Select
            id={`assign-${id}`}
            name="worker_id"
            label="Worker"
            placeholder="Nobody"
            options={workers}
            value={choice}
            onChange={(event) => setChoice(event.target.value)}
          />
        </div>
        <Button
          type="submit"
          size="md"
          variant="secondary"
          loading={pending}
          disabled={choice === (workerId ?? "")}
        >
          {choice ? "Assign" : "Unassign"}
        </Button>
      </form>
      {!workerId && (
        <form action={routeAction}>
          <input type="hidden" name="id" value={id} />
          <Button type="submit" size="sm" variant="ghost" loading={routing}>
            Find a worker automatically
          </Button>
        </form>
      )}
      <Announce state={state} />
      <Announce state={routeState} />
    </div>
  );
}

export function CommentForm({ id }: { id: string }) {
  const [state, action, pending] = useActionState(commentOnComplaint, initialFormState);
  return (
    <form key={state.id} action={action} noValidate className="space-y-2">
      <input type="hidden" name="id" value={id} />
      <Textarea
        id={`comment-${id}`}
        name="note"
        label="Add a comment"
        rows={2}
        defaultValue={state.status === "error" ? (state.values?.note ?? "") : ""}
        maxLength={2000}
        error={state.fieldErrors.note?.[0]}
      />
      <div className="flex items-center justify-between gap-3">
        <Announce state={state} />
        <Button type="submit" size="sm" variant="secondary" loading={pending}>
          Comment
        </Button>
      </div>
    </form>
  );
}

/** Priority and whether the worker may see the resident's phone. */
export function PriorityForm({
  id,
  priority,
  shareResidentPhone,
  hasResident,
}: {
  id: string;
  priority: ComplaintPriority;
  shareResidentPhone: boolean;
  hasResident: boolean;
}) {
  const [state, action, pending] = useActionState(updateComplaint, initialFormState);
  return (
    <form key={state.id} action={action} className="space-y-3">
      <input type="hidden" name="id" value={id} />
      <Select
        id={`priority-${id}`}
        name="priority"
        label="Priority"
        options={PRIORITY_OPTIONS}
        defaultValue={priority}
        hint="Sets the response and fix targets."
      />
      {hasResident && (
        <Checkbox
          id={`share-${id}`}
          name="share_resident_phone"
          label="Show the resident's name and phone on the job link"
          defaultChecked={shareResidentPhone}
        />
      )}
      <div className="flex items-center justify-between gap-3">
        <Announce state={state} />
        <Button type="submit" size="sm" variant="secondary" loading={pending}>
          Save
        </Button>
      </div>
    </form>
  );
}

export function UploadForm({ id }: { id: string }) {
  const [state, action, pending] = useActionState(uploadComplaintFile, initialFormState);
  return (
    <form key={state.id} action={action} className="space-y-2">
      <input type="hidden" name="id" value={id} />
      <Input
        id={`file-${id}`}
        name="file"
        type="file"
        label="Add a photo or video"
        accept="image/jpeg,image/png,image/webp,video/mp4,video/quicktime"
        onChange={(event) => void shrinkInputFiles(event.currentTarget)}
        hint="Up to 5 photos (5 MB each) and 1 video (20 MB)."
        error={state.fieldErrors.file?.[0]}
      />
      <div className="flex items-center justify-between gap-3">
        <Announce state={state} />
        <Button type="submit" size="sm" variant="secondary" loading={pending}>
          Upload
        </Button>
      </div>
    </form>
  );
}

/**
 * Creates a job link for an outside worker (E15-T8). The token is shown
 * once; the owner sends it by WhatsApp or SMS from their own phone.
 */
export function JobLinkPanel({
  id,
  workerName,
  workerPhone,
  hasLink,
}: {
  id: string;
  workerName: string;
  workerPhone: string | null;
  hasLink: boolean;
}) {
  const [state, action, pending] = useActionState<FormState & { token?: string }, FormData>(
    createJobLink,
    initialFormState,
  );
  const [copied, setCopied] = useState(false);
  const [origin, setOrigin] = useState("");
  useEffect(() => setOrigin(window.location.origin), []);
  const url = state.token ? `${origin}/job/${state.token}` : null;
  const message = url ? `Hello ${workerName}, a new job for you: ${url}` : "";

  return (
    <div className="space-y-3">
      {url ? (
        <div className="space-y-2">
          <Alert tone="success">{state.message}</Alert>
          <Input id={`job-url-${id}`} label="Job link" value={url} readOnly />
          <div className="flex flex-wrap gap-2">
            <Button
              size="sm"
              variant="secondary"
              onClick={async () => {
                await navigator.clipboard.writeText(url);
                setCopied(true);
              }}
            >
              {copied ? "Copied" : "Copy link"}
            </Button>
            {workerPhone && (
              <a
                href={`https://wa.me/91${workerPhone}?text=${encodeURIComponent(message)}`}
                target="_blank"
                rel="noreferrer"
                className="inline-flex h-8 items-center rounded-md border border-slate-300 bg-white px-3 text-sm font-medium text-slate-800 hover:bg-slate-50"
              >
                Send on WhatsApp
              </a>
            )}
          </div>
        </div>
      ) : (
        <form action={action} className="space-y-2">
          <input type="hidden" name="id" value={id} />
          <p className="text-sm text-slate-600">
            {hasLink
              ? "A link is live. A new one replaces it, and the old one stops working."
              : `${workerName} can see the job and update it from a link, without an account.`}
          </p>
          {state.status === "error" && <Announce state={state} />}
          <Button type="submit" size="sm" variant="secondary" loading={pending}>
            {hasLink ? "Make a new link" : "Create job link"}
          </Button>
        </form>
      )}
    </div>
  );
}

/** What the repair cost and who pays (E15-T9). Owners only. */
export function CostsDialog({
  id,
  costs,
  residents,
  defaultResidentId,
}: {
  id: string;
  costs: { labour: number; material: number; vendorCharge: number; payer: "hostel" | "resident" };
  residents: readonly { value: string; label: string }[];
  defaultResidentId: string | null;
}) {
  const [state, action, pending] = useActionState(saveComplaintCosts, initialFormState);
  const { open, setOpen } = useDialog(state);
  const [payer, setPayer] = useState<string>(state.values?.payer || costs.payer);
  const formId = `costs-${id}`;
  const value = (name: string, paise: number) =>
    state.values?.[name] ?? (paise ? paiseToInput(paise) : "");

  return (
    <>
      <Button size="sm" variant="secondary" onClick={() => setOpen(true)}>
        Edit costs
      </Button>
      {state.status === "success" && <Announce state={state} />}
      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title="Repair costs"
        description="When the resident pays, the total is added to their next invoice."
        footer={
          <>
            <Button variant="secondary" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" form={formId} loading={pending}>
              Save costs
            </Button>
          </>
        }
      >
        <form key={state.id} id={formId} action={action} noValidate className="space-y-4">
          {state.formError && <Alert tone="error">{state.formError}</Alert>}
          <input type="hidden" name="id" value={id} />
          <div className="grid gap-4 sm:grid-cols-3">
            <Input
              id={`${formId}-labour`}
              name="labour_cost"
              label="Labour (₹)"
              inputMode="decimal"
              defaultValue={value("labour_cost", costs.labour)}
              error={state.fieldErrors.labour_cost?.[0]}
            />
            <Input
              id={`${formId}-material`}
              name="material_cost"
              label="Materials (₹)"
              inputMode="decimal"
              defaultValue={value("material_cost", costs.material)}
              error={state.fieldErrors.material_cost?.[0]}
            />
            <Input
              id={`${formId}-vendor`}
              name="vendor_charge"
              label="Worker's charge (₹)"
              inputMode="decimal"
              defaultValue={value("vendor_charge", costs.vendorCharge)}
              error={state.fieldErrors.vendor_charge?.[0]}
            />
          </div>
          <Select
            id={`${formId}-payer`}
            name="payer"
            label="Who pays"
            options={[
              { value: "hostel", label: "The hostel" },
              { value: "resident", label: "A resident (for example, damage they caused)" },
            ]}
            value={payer}
            onChange={(event) => setPayer(event.target.value)}
            error={state.fieldErrors.payer?.[0]}
          />
          {payer === "resident" && (
            <Select
              id={`${formId}-resident`}
              name="resident_id"
              label="Resident"
              placeholder="Choose the resident"
              options={residents}
              defaultValue={state.values?.resident_id || defaultResidentId || ""}
              required
              error={state.fieldErrors.resident_id?.[0]}
            />
          )}
        </form>
      </Modal>
    </>
  );
}

/** Money paid to the job's worker: a log, not a payment (E15-T9). */
export function PayoutDialog({ id, workerName }: { id: string; workerName: string }) {
  const [state, action, pending] = useActionState(recordVendorPayout, initialFormState);
  const { open, setOpen } = useDialog(state);
  const formId = `payout-${id}`;
  const today = todayIst();
  return (
    <>
      <Button size="sm" variant="secondary" onClick={() => setOpen(true)}>
        Record payment to worker
      </Button>
      {state.status === "success" && <Announce state={state} />}
      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title={`Payment to ${workerName}`}
        description="Record money already paid. No money moves through the app."
        footer={
          <>
            <Button variant="secondary" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" form={formId} loading={pending}>
              Record payment
            </Button>
          </>
        }
      >
        <form key={state.id} id={formId} action={action} noValidate className="space-y-4">
          {state.formError && <Alert tone="error">{state.formError}</Alert>}
          <input type="hidden" name="id" value={id} />
          <div className="grid gap-4 sm:grid-cols-2">
            <Input
              id={`${formId}-amount`}
              name="amount"
              label="Amount (₹)"
              inputMode="decimal"
              defaultValue={state.values?.amount ?? ""}
              required
              error={state.fieldErrors.amount?.[0]}
            />
            <Input
              id={`${formId}-date`}
              name="paid_at"
              type="date"
              label="Paid on"
              max={today}
              defaultValue={state.values?.paid_at || today}
              required
              error={state.fieldErrors.paid_at?.[0]}
            />
            <Select
              id={`${formId}-mode`}
              name="mode"
              label="Mode"
              placeholder="Choose a mode"
              options={PAYOUT_MODE_OPTIONS}
              defaultValue={state.values?.mode ?? ""}
              required
              error={state.fieldErrors.mode?.[0]}
            />
            <Input
              id={`${formId}-reference`}
              name="reference"
              label="Reference"
              defaultValue={state.values?.reference ?? ""}
              hint="Optional. UPI ID or cheque number."
              maxLength={100}
              error={state.fieldErrors.reference?.[0]}
            />
          </div>
        </form>
      </Modal>
    </>
  );
}
