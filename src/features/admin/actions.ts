"use server";

import type { PostgrestError } from "@supabase/supabase-js";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";

import { AuthorizationError } from "@/lib/auth/roles";
import { requireRole } from "@/lib/auth/session";
import { unexpectedFailure } from "@/lib/request-context";
import { createClient } from "@/lib/supabase/server";
import {
  formFailure,
  formSuccess,
  formValues,
  integer,
  isoDate,
  optional,
  requiredText,
  todayIst,
  uuid,
  validateFormData,
  type FormState,
} from "@/lib/validation";

import { PLANS } from "./options";

const RULE_MESSAGES: Record<string, string> = {
  plan_invalid: "Choose trial, paid or free.",
  trial_end_required: "Choose the last day of the trial.",
  hostel_not_found: "This hostel could not be found. Refresh the page.",
  hostel_draft: "This hostel is still being set up and cannot be suspended.",
  suspension_reason_required: "Say why the hostel is suspended. The owner will see it.",
  not_platform_admin: "Only platform admins can do this.",
  trial_days_range: "Choose between 7 and 180 days.",
  reason_required: "Say why. It goes in the audit log.",
  mfa_required: "Confirm your sign-in with your authenticator app first.",
  account_not_found: "This account could not be found. Refresh the page.",
  message_required: "Write the message.",
  announcement_dates: "The end must be after the start.",
  announcement_not_found: "This announcement has already ended. Refresh the page.",
};

function failure(action: string, error: PostgrestError, values?: Record<string, string>) {
  const message = error.hint ? RULE_MESSAGES[error.hint] : undefined;
  return message ? formFailure(message, values) : unexpectedFailure(action, error, values);
}

async function asAdmin(values: Record<string, string>): Promise<FormState | null> {
  try {
    await requireRole(["platform_admin"]);
    return null;
  } catch (error) {
    if (error instanceof AuthorizationError) return formFailure(error.message, values);
    throw error;
  }
}

const planSchema = z
  .object({
    hostel_id: uuid("Hostel"),
    plan: z.enum(PLANS, { error: "Choose a plan" }),
    trial_ends_at: optional(isoDate("Trial end")),
    reason: requiredText("Reason", 500),
  })
  .refine((input) => input.plan !== "trial" || input.trial_ends_at !== null, {
    error: "Choose the last day of the trial",
    path: ["trial_ends_at"],
  });

export async function setHostelPlan(_previous: FormState, formData: FormData): Promise<FormState> {
  const values = formValues(formData, ["hostel_id", "plan", "trial_ends_at", "reason"]);
  const denied = await asAdmin(values);
  if (denied) return denied;
  const parsed = validateFormData(planSchema, formData);
  if (!parsed.ok) return formFailure(undefined, values, parsed.fieldErrors);

  const supabase = await createClient();
  const { error } = await supabase.rpc("admin_set_plan", {
    p_hostel_id: parsed.data.hostel_id,
    p_plan: parsed.data.plan,
    // Ignored unless the plan is a trial; the function needs a date either way.
    p_trial_ends_at: parsed.data.trial_ends_at ?? todayIst(),
    p_reason: parsed.data.reason,
  });
  if (error) return failure("setHostelPlan", error, values);

  revalidatePath("/admin", "layout");
  return formSuccess("Plan saved.");
}

const suspendSchema = z.object({
  hostel_id: uuid("Hostel"),
  suspend: z.enum(["true", "false"]),
  reason: requiredText("Reason", 500),
});

export async function setHostelSuspended(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  const values = formValues(formData, ["hostel_id", "suspend", "reason"]);
  const denied = await asAdmin(values);
  if (denied) return denied;
  const parsed = validateFormData(suspendSchema, formData);
  if (!parsed.ok) return formFailure(undefined, values, parsed.fieldErrors);
  const suspend = parsed.data.suspend === "true";

  const supabase = await createClient();
  const { error } = await supabase.rpc("admin_set_suspended", {
    p_hostel_id: parsed.data.hostel_id,
    p_suspend: suspend,
    p_reason: parsed.data.reason,
  });
  if (error) return failure("setHostelSuspended", error, values);

  revalidatePath("/admin", "layout");
  return formSuccess(suspend ? "Hostel suspended." : "Hostel restored.");
}

const trialDaysSchema = z.object({ trial_days: integer("Trial length", 7, 180) });

/** The free trial every new hostel starts on (plan E15-T2). Existing trials keep their dates. */
export async function setTrialDays(_previous: FormState, formData: FormData): Promise<FormState> {
  const values = formValues(formData, ["trial_days"]);
  const denied = await asAdmin(values);
  if (denied) return denied;
  const parsed = validateFormData(trialDaysSchema, formData);
  if (!parsed.ok) return formFailure(undefined, values, parsed.fieldErrors);

  const supabase = await createClient();
  const { error } = await supabase.rpc("admin_set_trial_days", { p_days: parsed.data.trial_days });
  if (error) return failure("setTrialDays", error, values);

  revalidatePath("/admin", "layout");
  return formSuccess(`New hostels now start on a ${parsed.data.trial_days}-day trial.`);
}

// ---------------------------------------------------------------------------
// Support view and support actions (ClickUp E10-T5, E10-T8)
// ---------------------------------------------------------------------------

const reasonSchema = z.object({ reason: requiredText("Reason", 500) });

/** Opens the read-only support view for an hour; the owner is told. */
export async function openSupportView(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  const values = formValues(formData, ["hostel_id", "reason"]);
  const denied = await asAdmin(values);
  if (denied) return denied;
  const parsed = validateFormData(reasonSchema.extend({ hostel_id: uuid("Hostel") }), formData);
  if (!parsed.ok) return formFailure(undefined, values, parsed.fieldErrors);

  const supabase = await createClient();
  const { error } = await supabase.rpc("admin_open_support_view", {
    p_hostel_id: parsed.data.hostel_id,
    p_reason: parsed.data.reason,
  });
  if (error) return failure("openSupportView", error, values);
  redirect(`/admin/hostels/${parsed.data.hostel_id}/support`);
}

const SUPPORT_ACTIONS = ["sign_out_everywhere", "resend_confirmation", "password_reset"] as const;
const supportActionSchema = reasonSchema.extend({
  user_id: uuid("Account"),
  email: z.email({ error: "Account e-mail missing" }),
  action: z.enum(SUPPORT_ACTIONS, { error: "Choose an action" }),
});

/**
 * Account help without ever seeing or setting a password: sign out of
 * every device, resend the sign-up confirmation, or send a reset link.
 * Each is recorded with its reason before it runs.
 */
export async function runSupportAction(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  const values = formValues(formData, ["user_id", "email", "action", "reason"]);
  const denied = await asAdmin(values);
  if (denied) return denied;
  const parsed = validateFormData(supportActionSchema, formData);
  if (!parsed.ok) return formFailure(undefined, values, parsed.fieldErrors);
  const { user_id, email, action, reason } = parsed.data;

  const supabase = await createClient();
  if (action === "sign_out_everywhere") {
    const { error } = await supabase.rpc("admin_sign_out_everywhere", {
      p_user_id: user_id,
      p_reason: reason,
    });
    if (error) return failure("signOutEverywhere", error, values);
    revalidatePath("/admin", "layout");
    return formSuccess("Signed out of every device. They must sign in again.");
  }

  const { error: logError } = await supabase.rpc("admin_record_email_action", {
    p_action: action === "resend_confirmation" ? "confirmation_resent" : "password_reset_sent",
    p_user_id: user_id,
    p_reason: reason,
  });
  if (logError) return failure("runSupportAction", logError, values);

  const { error } =
    action === "resend_confirmation"
      ? await supabase.auth.resend({ type: "signup", email })
      : await supabase.auth.resetPasswordForEmail(email);
  if (error) return unexpectedFailure("runSupportAction", error, values);
  revalidatePath("/admin", "layout");
  return formSuccess(
    action === "resend_confirmation"
      ? `Confirmation e-mail sent to ${email}.`
      : `Password reset link sent to ${email}.`,
  );
}

// ---------------------------------------------------------------------------
// Announcements (ClickUp E10-T11)
// ---------------------------------------------------------------------------

const announcementSchema = z.object({
  message: requiredText("Message", 500),
  severity: z.enum(["info", "warning"], { error: "Choose how it looks" }),
  ends_on: optional(isoDate("Show until")),
});

export async function createAnnouncement(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  const values = formValues(formData, ["message", "severity", "ends_on"]);
  const denied = await asAdmin(values);
  if (denied) return denied;
  const parsed = validateFormData(announcementSchema, formData);
  if (!parsed.ok) return formFailure(undefined, values, parsed.fieldErrors);

  const supabase = await createClient();
  const { error } = await supabase.rpc("admin_create_announcement", {
    p_message: parsed.data.message,
    p_severity: parsed.data.severity,
    // Shown until the end of that day in India.
    p_ends_at: parsed.data.ends_on ? `${parsed.data.ends_on}T23:59:59+05:30` : undefined,
  });
  if (error) return failure("createAnnouncement", error, values);
  revalidatePath("/", "layout");
  return formSuccess("Announcement published. Owners and staff see it now.");
}

export async function endAnnouncement(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  const denied = await asAdmin({});
  if (denied) return denied;
  const parsed = validateFormData(z.object({ id: uuid("Announcement") }), formData);
  if (!parsed.ok) return formFailure("This announcement could not be found.");

  const supabase = await createClient();
  const { error } = await supabase.rpc("admin_end_announcement", { p_id: parsed.data.id });
  if (error) return failure("endAnnouncement", error);
  revalidatePath("/", "layout");
  return formSuccess("Announcement ended.");
}
