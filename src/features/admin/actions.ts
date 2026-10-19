"use server";

import type { PostgrestError } from "@supabase/supabase-js";
import { revalidatePath } from "next/cache";
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
  })
  .refine((input) => input.plan !== "trial" || input.trial_ends_at !== null, {
    error: "Choose the last day of the trial",
    path: ["trial_ends_at"],
  });

export async function setHostelPlan(_previous: FormState, formData: FormData): Promise<FormState> {
  const values = formValues(formData, ["hostel_id", "plan", "trial_ends_at"]);
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
  });
  if (error) return failure("setHostelPlan", error, values);

  revalidatePath("/admin", "layout");
  return formSuccess("Plan saved.");
}

const suspendSchema = z.object({
  hostel_id: uuid("Hostel"),
  suspend: z.enum(["true", "false"]),
  reason: optional(requiredText("Reason", 500)),
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
  if (suspend && !parsed.data.reason) {
    return formFailure(undefined, values, {
      reason: ["Say why the hostel is suspended. The owner will see it."],
    });
  }

  const supabase = await createClient();
  const { error } = await supabase.rpc("admin_set_suspended", {
    p_hostel_id: parsed.data.hostel_id,
    p_suspend: suspend,
    p_reason: parsed.data.reason ?? "",
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
