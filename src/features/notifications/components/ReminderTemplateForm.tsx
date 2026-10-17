"use client";

import { useActionState } from "react";

import { Alert, Button, Textarea } from "@/components/ui";
import { initialFormState } from "@/lib/validation/result";

import { saveReminderTemplate } from "../actions";
import { DEFAULT_REMINDER_TEMPLATE, MAX_TEMPLATE_LENGTH, REMINDER_PLACEHOLDERS } from "../message";

/** The wording of fee reminders for this hostel (EP-11). */
export function ReminderTemplateForm({ template }: { template: string | null }) {
  const [state, action, pending] = useActionState(saveReminderTemplate, initialFormState);

  return (
    <form key={state.id} action={action} noValidate className="space-y-4">
      {state.formError && <Alert tone="error">{state.formError}</Alert>}
      {state.status === "success" && <Alert tone="success">{state.message}</Alert>}
      <Textarea
        id="reminder-template"
        name="reminder_template"
        label="Reminder message"
        rows={4}
        maxLength={MAX_TEMPLATE_LENGTH}
        defaultValue={state.values?.reminder_template ?? template ?? ""}
        placeholder={DEFAULT_REMINDER_TEMPLATE}
        hint={
          <>
            Leave blank to use the default shown. You can use{" "}
            {REMINDER_PLACEHOLDERS.map((key, i) => (
              <span key={key}>
                {i > 0 && (i === REMINDER_PLACEHOLDERS.length - 1 ? " and " : ", ")}
                <code className="rounded bg-slate-100 px-1 text-slate-800">{`{${key}}`}</code>
              </span>
            ))}
            .
          </>
        }
        error={state.fieldErrors.reminder_template?.[0]}
      />
      <Button type="submit" loading={pending}>
        Save message
      </Button>
    </form>
  );
}
