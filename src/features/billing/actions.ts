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
  rupees,
  uuid,
  validateFormData,
  type FormState,
} from "@/lib/validation";

import { SUBSCRIPTION_STATUSES } from "./options";

const RULE_MESSAGES: Record<string, string> = {
  reason_required: "Say why. It goes in the audit log.",
  status_invalid: "Choose a status.",
  trial_end_required: "Choose the last day of the trial.",
  plan_invalid: "Choose an active plan.",
  owner_not_found: "This owner could not be found. Refresh the page.",
  not_platform_admin: "Only platform admins can do this.",
  mfa_required: "Confirm your sign-in with your authenticator app first.",
};

function failure(action: string, error: PostgrestError, values?: Record<string, string>) {
  // A refused downgrade lists what to remove; the database wrote it for the admin.
  if (error.hint === "plan_downgrade") return formFailure(`${error.message}.`, values);
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

const subscriptionSchema = z
  .object({
    owner_id: uuid("Owner"),
    plan_id: requiredText("Plan", 40),
    status: z.enum(SUBSCRIPTION_STATUSES, { error: "Choose a status" }),
    trial_ends_at: optional(isoDate("Trial end")),
    period_end: optional(isoDate("Paid until")),
    reason: requiredText("Reason", 500),
  })
  .refine((input) => input.status !== "trialing" || input.trial_ends_at !== null, {
    error: "Choose the last day of the trial",
    path: ["trial_ends_at"],
  });

/** Sets an owner's plan and status (ClickUp EP-14 T2), audited with a reason. */
export async function setSubscription(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  const values = formValues(formData, [
    "plan_id",
    "status",
    "trial_ends_at",
    "period_end",
    "reason",
  ]);
  const denied = await asAdmin(values);
  if (denied) return denied;
  const parsed = validateFormData(subscriptionSchema, formData);
  if (!parsed.ok) return formFailure(undefined, values, parsed.fieldErrors);

  const supabase = await createClient();
  const { error } = await supabase.rpc("admin_set_subscription", {
    p_owner_id: parsed.data.owner_id,
    p_plan_id: parsed.data.plan_id,
    p_status: parsed.data.status,
    p_trial_ends_at: parsed.data.trial_ends_at ?? undefined,
    p_period_end: parsed.data.period_end ?? undefined,
    p_reason: parsed.data.reason,
  });
  if (error) return failure("setSubscription", error, values);
  revalidatePath("/admin", "layout");
  return formSuccess("Subscription saved.");
}

const limit = (label: string) => optional(integer(label, 0, 100000));

const planSchema = z.object({
  id: z
    .string()
    .trim()
    .regex(/^[a-z][a-z0-9_]{1,30}$/, { error: "Use lowercase letters, digits and _" }),
  name: requiredText("Name", 60),
  monthly_price: rupees("Monthly price", { positive: false, max: 1_00_000 }),
  yearly_price: optional(rupees("Yearly price", { positive: false, max: 10_00_000 })),
  pricing_basis: z.enum(["flat", "per_bed", "tiered"], { error: "Choose a pricing basis" }),
  max_beds: limit("Beds"),
  max_hostels: limit("Hostels"),
  max_staff: limit("Staff"),
  gst_inclusive: z
    .literal("on")
    .optional()
    .transform((value) => value === "on"),
  public: z
    .literal("on")
    .optional()
    .transform((value) => value === "on"),
  active: z
    .literal("on")
    .optional()
    .transform((value) => value === "on"),
  reason: requiredText("Reason", 500),
});

/** Adds or edits a plan (ClickUp EP-14 T1). Prices apply to subscriptions from renewal. */
export async function savePlan(_previous: FormState, formData: FormData): Promise<FormState> {
  const fields = [
    "id",
    "name",
    "monthly_price",
    "yearly_price",
    "pricing_basis",
    "max_beds",
    "max_hostels",
    "max_staff",
    "gst_inclusive",
    "public",
    "active",
    "reason",
  ];
  const values = formValues(formData, fields);
  const denied = await asAdmin(values);
  if (denied) return denied;
  const parsed = validateFormData(planSchema, formData);
  if (!parsed.ok) return formFailure(undefined, values, parsed.fieldErrors);
  const input = parsed.data;

  const supabase = await createClient();
  const { error } = await supabase.rpc("admin_save_plan", {
    p_id: input.id,
    p_name: input.name,
    p_monthly_price: input.monthly_price,
    p_yearly_price: input.yearly_price as number,
    p_pricing_basis: input.pricing_basis,
    p_max_beds: input.max_beds as number,
    p_max_hostels: input.max_hostels as number,
    p_max_staff: input.max_staff as number,
    p_gst_inclusive: input.gst_inclusive,
    p_public: input.public,
    p_active: input.active,
    p_reason: input.reason,
  });
  if (error) {
    if (error.code === "23514") return formFailure("A limit or price is out of range.", values);
    return failure("savePlan", error, values);
  }
  revalidatePath("/admin/plans");
  return formSuccess(`${input.name} saved.`);
}
