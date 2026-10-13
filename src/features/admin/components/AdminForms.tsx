"use client";

import { useActionState, useEffect, useState } from "react";

import { Alert, Button, Input, Modal, Select, Textarea } from "@/components/ui";
import { initialFormState, type FormState } from "@/lib/validation/result";

import {
  completeClosure,
  createAnnouncement,
  endAnnouncement,
  openSupportView,
  setHostelStatus,
  supportAction,
} from "../actions";

type Action = (previous: FormState, formData: FormData) => Promise<FormState>;

/**
 * A button that opens a dialog asking for the reason, which goes into the
 * audit log with the action (E10-T3).
 */
export function ReasonDialog({
  action,
  fields,
  label,
  title,
  description,
  confirmLabel,
  variant = "secondary",
}: {
  action: Action;
  fields: Record<string, string>;
  label: string;
  title: string;
  description: string;
  confirmLabel: string;
  variant?: "primary" | "secondary" | "danger";
}) {
  const [state, formAction, pending] = useActionState(action, initialFormState);
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (state.status === "success") setOpen(false);
  }, [state]);
  const formId = `reason-${Object.values(fields).join("-")}`;

  return (
    <>
      <Button size="sm" variant={variant} onClick={() => setOpen(true)}>
        {label}
      </Button>
      {state.status === "success" && (
        <p role="status" className="text-sm text-emerald-700">
          {state.message}
        </p>
      )}
      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title={title}
        description={description}
        footer={
          <>
            <Button variant="secondary" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button
              type="submit"
              form={formId}
              variant={variant === "danger" ? "danger" : "primary"}
              loading={pending}
            >
              {confirmLabel}
            </Button>
          </>
        }
      >
        <form key={state.id} id={formId} action={formAction} noValidate className="space-y-4">
          {state.formError && <Alert tone="error">{state.formError}</Alert>}
          {Object.entries(fields).map(([name, value]) => (
            <input key={name} type="hidden" name={name} value={value} />
          ))}
          <Textarea
            id={`${formId}-reason`}
            name="reason"
            label="Reason"
            required
            rows={3}
            maxLength={500}
            defaultValue={state.values?.reason ?? ""}
            hint="Recorded in the audit log."
            error={state.fieldErrors.reason?.[0]}
          />
        </form>
      </Modal>
    </>
  );
}

export function SuspendButton({ hostelId, status }: { hostelId: string; status: string }) {
  if (status === "draft") return null;
  const suspend = status === "active";
  return (
    <ReasonDialog
      action={setHostelStatus}
      fields={{ hostel_id: hostelId, status: suspend ? "suspended" : "active" }}
      label={suspend ? "Suspend hostel" : "Restore hostel"}
      title={suspend ? "Suspend this hostel" : "Restore this hostel"}
      description={
        suspend
          ? "The owner and staff lose access and no invoice or payment can be recorded. No data is deleted. The owner is emailed."
          : "The owner and staff can work in the hostel again. The owner is emailed."
      }
      confirmLabel={suspend ? "Suspend" : "Restore"}
      variant={suspend ? "danger" : "primary"}
    />
  );
}

const SUPPORT: Record<string, { label: string; description: string }> = {
  resend_confirmation: {
    label: "Resend confirmation email",
    description: "Sends the sign-up confirmation email to the owner's address again.",
  },
  password_reset: {
    label: "Send password reset",
    description:
      "Emails the owner a link to choose a new password. You never see or set the password.",
  },
  sign_out_everywhere: {
    label: "Sign out everywhere",
    description:
      "Ends the owner's sessions on every device, for a lost or shared phone. They sign in again with their password.",
  },
};

export function SupportActionButton({
  accountId,
  action,
}: {
  accountId: string;
  action: keyof typeof SUPPORT;
}) {
  return (
    <ReasonDialog
      action={supportAction}
      fields={{ account_id: accountId, action }}
      label={SUPPORT[action].label}
      title={SUPPORT[action].label}
      description={SUPPORT[action].description}
      confirmLabel={SUPPORT[action].label}
    />
  );
}

/** Asks why before showing a hostel's data (E10-T5). */
export function OpenSupportViewForm({ hostelId }: { hostelId: string }) {
  const [state, formAction, pending] = useActionState(openSupportView, initialFormState);
  return (
    <form
      key={state.id}
      action={formAction}
      noValidate
      className="max-w-xl space-y-4 rounded-lg border border-slate-200 bg-white p-5"
    >
      {state.formError && <Alert tone="error">{state.formError}</Alert>}
      <input type="hidden" name="hostel_id" value={hostelId} />
      <Textarea
        id="support-reason"
        name="reason"
        label="Why are you opening this hostel?"
        required
        rows={3}
        maxLength={500}
        defaultValue={state.values?.reason ?? ""}
        hint="For example, the ticket you are working on. The owner sees this reason and the date."
        error={state.fieldErrors.reason?.[0]}
      />
      <Button type="submit" loading={pending}>
        Open read-only view
      </Button>
    </form>
  );
}

export function AnnouncementForm({ now }: { now: string }) {
  const [state, formAction, pending] = useActionState(createAnnouncement, initialFormState);
  const values = state.status === "error" ? state.values : undefined;
  return (
    <form
      key={state.id}
      action={formAction}
      noValidate
      className="space-y-4 rounded-lg border border-slate-200 bg-white p-5"
    >
      {state.formError && <Alert tone="error">{state.formError}</Alert>}
      {state.status === "success" && <Alert tone="success">{state.message}</Alert>}
      <Textarea
        id="announcement-message"
        name="message"
        label="Message"
        required
        rows={2}
        maxLength={500}
        defaultValue={values?.message ?? ""}
        hint="Shown at the top of every owner's and staff member's screen."
        error={state.fieldErrors.message?.[0]}
      />
      <div className="grid gap-4 sm:grid-cols-3">
        <Select
          id="announcement-severity"
          name="severity"
          label="Severity"
          options={[
            { value: "info", label: "Information" },
            { value: "warning", label: "Warning" },
            { value: "critical", label: "Critical" },
          ]}
          defaultValue={values?.severity || "info"}
        />
        <Input
          id="announcement-start"
          name="starts_at"
          type="datetime-local"
          label="Starts (India time)"
          defaultValue={values?.starts_at || now}
          required
          error={state.fieldErrors.starts_at?.[0]}
        />
        <Input
          id="announcement-end"
          name="ends_at"
          type="datetime-local"
          label="Ends (India time)"
          defaultValue={values?.ends_at ?? ""}
          required
          error={state.fieldErrors.ends_at?.[0]}
        />
      </div>
      <Button type="submit" loading={pending}>
        Publish
      </Button>
    </form>
  );
}

export function EndAnnouncementButton({ id }: { id: string }) {
  const [state, formAction, pending] = useActionState(endAnnouncement, initialFormState);
  return (
    <form action={formAction} className="inline">
      <input type="hidden" name="id" value={id} />
      <Button type="submit" size="sm" variant="ghost" loading={pending}>
        End now
      </Button>
      {state.formError && <span className="text-sm text-red-700">{state.formError}</span>}
    </form>
  );
}

export function CompleteClosureButton({ requestId }: { requestId: string }) {
  return (
    <ReasonDialog
      action={completeClosure}
      fields={{ request_id: requestId }}
      label="Mark done"
      title="Record this closure as done"
      description="Only after following the steps in docs/data-protection.md: residents erased, hostels suspended, money records kept for the retention period."
      confirmLabel="Mark done"
    />
  );
}
