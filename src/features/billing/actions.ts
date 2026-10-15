"use server";

import type { PostgrestError } from "@supabase/supabase-js";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";

import { requireRole } from "@/lib/auth/session";
import { AuthorizationError } from "@/lib/auth/roles";
import { billingGateway } from "@/lib/billing/config";
import { GSTIN_PATTERN } from "@/lib/billing/pricing";
import { GatewayError } from "@/lib/billing/razorpay";
import { logUnexpected, unexpectedFailure } from "@/lib/request-context";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import {
  formFailure,
  formSuccess,
  formValues,
  optional,
  requiredText,
  validateFormData,
  type FormState,
} from "@/lib/validation";

import { ensureGatewayPlan, startGatewayCheckout, type CheckoutNeed } from "./gateway";

/**
 * The owner's billing actions (E14-T5, T8). Only owners reach them; the
 * database checks again. Nothing here changes a subscription's status: the
 * gateway's signed webhook does that (src/app/api/webhooks/billing).
 */

const NOT_SET_UP =
  "Online payment is not set up yet. Contact Hostel ERP support and we will activate your plan.";

const GATEWAY_FAILED =
  "The payment gateway could not be reached. Nothing has been charged; try again in a few minutes.";

const RULE_MESSAGES: Record<string, string> = {
  no_subscription: "Create your hostel first; your trial starts then.",
  already_subscribed: "You already have a paid plan. Change it below instead.",
  plan_not_found: "That plan is not available.",
  billing_interval: "Choose monthly or annual billing.",
  coupon_invalid: "That coupon is not valid or has run out.",
  coupon_used: "You have already used that coupon.",
  coupon_not_online: "That coupon cannot be used for online payment yet. Contact support.",
  no_paid_plan: "There is no paid plan to change or cancel.",
  plan_unchanged: "You are already on that plan.",
};

const WHAT: Record<string, string> = { beds: "beds", hostels: "hostels", staff: "staff accounts" };

/** "Remove 12 beds first" for a plan the account does not fit (E14-T4). */
function tooSmall(error: PostgrestError): string {
  try {
    const violations = JSON.parse(error.details) as { what: string; limit: number; used: number }[];
    const parts = violations.map(
      (v) =>
        `${v.used - v.limit} ${WHAT[v.what] ?? v.what} (you have ${v.used}, it allows ${v.limit})`,
    );
    return `Your account is larger than that plan allows. Remove ${parts.join(" and ")} first, or choose a bigger plan.`;
  } catch {
    return "Your account is larger than that plan allows.";
  }
}

async function failure(action: string, error: PostgrestError, values?: Record<string, string>) {
  if (error.code === "P0001" && error.hint === "plan_too_small") {
    return formFailure(tooSmall(error), values);
  }
  const message = error.code === "P0001" && error.hint ? RULE_MESSAGES[error.hint] : undefined;
  return message ? formFailure(message, values) : unexpectedFailure(action, error, values);
}

async function requireOwner(): Promise<FormState | null> {
  try {
    await requireRole(["owner"]);
    return null;
  } catch (error) {
    if (error instanceof AuthorizationError) return formFailure(error.message);
    throw error;
  }
}

async function gatewayFailure(action: string, error: unknown, values?: Record<string, string>) {
  await logUnexpected(action, error);
  return formFailure(error instanceof GatewayError ? GATEWAY_FAILED : undefined, values);
}

const planChoice = z.object({
  plan: z.string().regex(/^[a-z][a-z0-9_]{1,39}$/, { error: "Choose a plan" }),
  interval: z.enum(["month", "year"], { error: "Choose monthly or annual billing" }),
});

// ---------------------------------------------------------------------------
// Checkout (E14-T5)
// ---------------------------------------------------------------------------

const checkoutSchema = planChoice.extend({
  coupon: optional(z.string().trim().max(30)),
});

/** Sends the owner to the gateway's hosted page to authorise payment. */
export async function startCheckout(_previous: FormState, formData: FormData): Promise<FormState> {
  const values = formValues(formData, ["plan", "interval", "coupon"]);
  const denied = await requireOwner();
  if (denied) return denied;
  const parsed = validateFormData(checkoutSchema, formData);
  if (!parsed.ok) return formFailure(undefined, values, parsed.fieldErrors);

  const gateway = billingGateway();
  if (!gateway) return formFailure(NOT_SET_UP, values);

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("billing_prepare_checkout", {
    p_plan_code: parsed.data.plan,
    p_interval: parsed.data.interval,
    p_coupon_code: parsed.data.coupon ?? undefined,
  });
  if (error) return failure("startCheckout", error, values);

  let checkoutUrl: string;
  try {
    checkoutUrl = await startGatewayCheckout(gateway, data as unknown as CheckoutNeed);
  } catch (gatewayError) {
    return gatewayFailure("startCheckout", gatewayError, values);
  }
  redirect(checkoutUrl);
}

// ---------------------------------------------------------------------------
// Plan changes (E14-T8)
// ---------------------------------------------------------------------------

interface Quote {
  plan_id: string;
  plan_code: string;
  plan_name: string;
  interval: "month" | "year";
  amount_with_gst: number;
  effect: "now" | "renewal";
  gateway_subscription_id: string;
  gateway_plan_id: string | null;
}

/**
 * Upgrades take effect now; downgrades and interval switches at renewal.
 * The gateway is told first; only once it accepts is the change recorded.
 */
export async function changePlan(_previous: FormState, formData: FormData): Promise<FormState> {
  const values = formValues(formData, ["plan", "interval"]);
  const denied = await requireOwner();
  if (denied) return denied;
  const parsed = validateFormData(planChoice, formData);
  if (!parsed.ok) return formFailure(undefined, values, parsed.fieldErrors);

  const gateway = billingGateway();
  if (!gateway) return formFailure(NOT_SET_UP, values);

  const supabase = await createClient();
  const user = await requireRole(["owner"]);
  const { data, error } = await supabase.rpc("billing_quote_change", {
    p_plan_code: parsed.data.plan,
    p_interval: parsed.data.interval,
  });
  if (error) return failure("changePlan", error, values);
  const quote = data as unknown as Quote;

  try {
    const gatewayPlanId = await ensureGatewayPlan(gateway, quote);
    await gateway.client.updateSubscription(quote.gateway_subscription_id, {
      planId: gatewayPlanId,
      when: quote.effect === "now" ? "now" : "cycle_end",
    });
    const { error: recordError } = await createAdminClient().rpc("billing_apply_plan_change", {
      p_owner_id: user.id,
      p_plan_id: quote.plan_id,
      p_interval: quote.interval,
      p_effect: quote.effect,
      p_gateway_plan_id: gatewayPlanId,
    });
    if (recordError) throw recordError;
  } catch (gatewayError) {
    return gatewayFailure("changePlan", gatewayError, values);
  }

  revalidatePath("/settings/billing");
  return formSuccess(
    quote.effect === "now"
      ? `You are now on ${quote.plan_name}.`
      : `You will move to ${quote.plan_name} at your next renewal.`,
  );
}

// ---------------------------------------------------------------------------
// Cancellation (E14-T8)
// ---------------------------------------------------------------------------

const cancelSchema = z.object({
  reason: requiredText("Reason", 500),
});

/** Cancels at the end of the paid period; nothing is deleted. */
export async function cancelPlan(_previous: FormState, formData: FormData): Promise<FormState> {
  const values = formValues(formData, ["reason"]);
  const denied = await requireOwner();
  if (denied) return denied;
  const parsed = validateFormData(cancelSchema, formData);
  if (!parsed.ok) return formFailure(undefined, values, parsed.fieldErrors);

  const gateway = billingGateway();
  if (!gateway) return formFailure(NOT_SET_UP, values);

  const supabase = await createClient();
  const user = await requireRole(["owner"]);
  const { data: gatewaySubscriptionId, error } = await supabase.rpc("billing_cancel_target");
  if (error) return failure("cancelPlan", error, values);

  try {
    await gateway.client.cancelSubscription(gatewaySubscriptionId, { atCycleEnd: true });
    const { error: recordError } = await createAdminClient().rpc("billing_mark_cancel", {
      p_owner_id: user.id,
      p_reason: parsed.data.reason,
    });
    if (recordError) throw recordError;
  } catch (gatewayError) {
    return gatewayFailure("cancelPlan", gatewayError, values);
  }

  revalidatePath("/settings/billing");
  return formSuccess(
    "Your plan is cancelled from the end of this period. Until then nothing changes, and afterwards your data stays readable.",
  );
}

// ---------------------------------------------------------------------------
// Business details for invoices (E14-T6)
// ---------------------------------------------------------------------------

const profileSchema = z
  .object({
    legal_name: requiredText("Business name", 120).refine((value) => value.length >= 2, {
      error: "Business name is too short",
    }),
    gstin: optional(
      z
        .string()
        .trim()
        .toUpperCase()
        .regex(GSTIN_PATTERN, { error: "Enter a valid 15-character GSTIN" }),
    ),
    address: requiredText("Address", 300).refine((value) => value.length >= 5, {
      error: "Enter the full address",
    }),
    state_code: z.string().regex(/^\d{2}$/, { error: "Choose a state" }),
    billing_email: optional(z.email({ error: "Enter a valid email address" })),
  })
  .refine((input) => !input.gstin || input.gstin.slice(0, 2) === input.state_code, {
    error: "The GSTIN's first two digits must match the state",
    path: ["gstin"],
  });

export async function saveBillingProfile(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  const values = formValues(formData, [
    "legal_name",
    "gstin",
    "address",
    "state_code",
    "billing_email",
  ]);
  const denied = await requireOwner();
  if (denied) return denied;
  const parsed = validateFormData(profileSchema, formData);
  if (!parsed.ok) return formFailure(undefined, values, parsed.fieldErrors);

  // Update first, insert if there was nothing to update: owner_id is never
  // writable, so an upsert (which would set it) is not allowed.
  const supabase = await createClient();
  const user = await requireRole(["owner"]);
  const updated = await supabase
    .from("billing_profiles")
    .update(parsed.data)
    .eq("owner_id", user.id)
    .select("owner_id");
  const error =
    updated.error ??
    (updated.data?.length
      ? null
      : (await supabase.from("billing_profiles").insert(parsed.data)).error);
  if (error) return unexpectedFailure("saveBillingProfile", error, values);

  revalidatePath("/settings/billing");
  return formSuccess("Billing details saved. They appear on your next invoice.");
}
