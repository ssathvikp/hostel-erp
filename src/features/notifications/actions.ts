"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { AuthorizationError } from "@/lib/auth/roles";
import { requireRole } from "@/lib/auth/session";
import { getHostelContext } from "@/lib/hostels/active";
import { logUnexpected, unexpectedFailure } from "@/lib/request-context";
import { createClient } from "@/lib/supabase/server";
import { formFailure, formSuccess, formValues, uuid, type FormState } from "@/lib/validation";

import { MAX_TEMPLATE_LENGTH, unknownPlaceholders } from "./message";

const sendSchema = z.object({
  residentId: uuid("Resident"),
  kind: z.enum(["due", "receipt"]),
  channel: z.enum(["whatsapp", "copy"]),
  invoiceId: uuid("Invoice").nullable(),
  amount: z.number().int().positive(),
});

export type ReminderSend = z.input<typeof sendSchema>;

/**
 * Records that a reminder or receipt went out by hand. Called as the
 * WhatsApp link opens or the text is copied, so it never blocks the send;
 * a failure is logged and reported back quietly.
 */
export async function logReminderSend(input: ReminderSend): Promise<{ ok: boolean }> {
  try {
    await requireRole(["owner", "staff"]);
  } catch {
    return { ok: false };
  }
  const parsed = sendSchema.safeParse(input);
  const hostelId = (await getHostelContext()).active?.id;
  if (!parsed.success || !hostelId) return { ok: false };

  const supabase = await createClient();
  const { error } = await supabase.from("reminder_log").insert({
    hostel_id: hostelId,
    resident_id: parsed.data.residentId,
    kind: parsed.data.kind,
    channel: parsed.data.channel,
    invoice_id: parsed.data.invoiceId,
    amount: parsed.data.amount,
  });
  if (error) {
    await logUnexpected("logReminderSend", error);
    return { ok: false };
  }
  revalidatePath("/fees/reminders");
  revalidatePath("/dashboard");
  return { ok: true };
}

/** Owners choose the reminder wording; blank restores the default. */
export async function saveReminderTemplate(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  const values = formValues(formData, ["reminder_template"]);
  try {
    await requireRole(["owner"]);
  } catch (error) {
    if (error instanceof AuthorizationError) return formFailure(error.message, values);
    throw error;
  }
  const hostelId = (await getHostelContext()).active?.id;
  if (!hostelId) return formFailure("Finish setting up your hostel first.", values);

  const text = values.reminder_template.trim();
  if (text.length > MAX_TEMPLATE_LENGTH) {
    return formFailure(undefined, values, {
      reminder_template: [`Keep the message under ${MAX_TEMPLATE_LENGTH} characters`],
    });
  }
  const unknown = unknownPlaceholders(text);
  if (unknown.length > 0) {
    return formFailure(undefined, values, {
      reminder_template: [
        `Unknown ${unknown.length === 1 ? "placeholder" : "placeholders"}: ${unknown.map((key) => `{${key}}`).join(", ")}`,
      ],
    });
  }

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("hostels")
    .update({ reminder_template: text || null })
    .eq("id", hostelId)
    .select("id");
  if (error) return unexpectedFailure("saveReminderTemplate", error, values);
  if (!data?.length) return formFailure("Only the hostel owner can change this.", values);

  revalidatePath("/fees/reminders");
  revalidatePath("/settings/fees");
  return formSuccess(text ? "Reminder message saved." : "Reminder message reset to the default.");
}
