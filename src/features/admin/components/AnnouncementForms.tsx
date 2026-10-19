"use client";

import { useActionState } from "react";

import { Alert, Button, Input, Select, Textarea } from "@/components/ui";
import { initialFormState } from "@/lib/validation/result";

import { createAnnouncement, endAnnouncement } from "../actions";

/** A message to every owner and staff member until a date (ClickUp E10-T11). */
export function AnnouncementForm() {
  const [state, action, pending] = useActionState(createAnnouncement, initialFormState);
  return (
    <form key={state.id} action={action} noValidate className="space-y-4">
      {state.formError && <Alert tone="error">{state.formError}</Alert>}
      {state.status === "success" && <Alert tone="success">{state.message}</Alert>}
      <Textarea
        id="announcement-message"
        name="message"
        label="Message"
        rows={3}
        maxLength={500}
        required
        defaultValue={state.values?.message ?? ""}
        error={state.fieldErrors.message?.[0]}
      />
      <div className="grid gap-4 sm:grid-cols-2">
        <Select
          id="announcement-severity"
          name="severity"
          label="Look"
          options={[
            { value: "info", label: "Information" },
            { value: "warning", label: "Warning" },
          ]}
          defaultValue={state.values?.severity ?? "info"}
          error={state.fieldErrors.severity?.[0]}
        />
        <Input
          id="announcement-ends"
          name="ends_on"
          type="date"
          label="Show until"
          hint="Leave blank to show it until you end it."
          defaultValue={state.values?.ends_on ?? ""}
          error={state.fieldErrors.ends_on?.[0]}
        />
      </div>
      <Button type="submit" loading={pending}>
        Publish announcement
      </Button>
    </form>
  );
}

export function EndAnnouncementButton({ id }: { id: string }) {
  const [state, action, pending] = useActionState(endAnnouncement, initialFormState);
  return (
    <form action={action} className="inline">
      <input type="hidden" name="id" value={id} />
      <Button type="submit" size="sm" variant="secondary" loading={pending}>
        End now
      </Button>
      {state.formError && <span className="ml-2 text-xs text-red-700">{state.formError}</span>}
    </form>
  );
}
