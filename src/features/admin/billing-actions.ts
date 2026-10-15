"use server";

import type { PostgrestError } from "@supabase/supabase-js";
import { revalidatePath } from "next/cache";
import { z } from "zod";

import { assertPlatformAdmin } from "@/lib/auth/admin";
import { AuthorizationError } from "@/lib/auth/roles";
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

/**
 * Admin billing actions (E10-T7, E14-T1, T10). Each checks the admin first;
 * the database function checks again, requires a reason where it changes a
 * customer's account, and writes the audit log.
 */

const RULE_MESSAGES: Record<string, string> = {
  reason_required: "Give a reason of at least a few words. It is shown in the audit log.",
  no_subscription: "This owner has no subscription yet: it starts with their first hostel.",
  days_range: "Extend by 1 to 90 days.",
  not_a_trial: "Only an unpaid trial can be extended.",
  plan_not_found: "That plan does not exist.",
  billing_interval: "Choose monthly or annual.",
  has_gateway_subscription:
    "This owner pays through the gateway. Cancel that subscription before making the plan complimentary.",
  until_past: "The end date must be in the future.",
  plan_tiers_invalid: "Tiers must go up in beds, and only the last may have no limit.",
  coupon_not_found: "That coupon could not be found.",
};

async function failure(action: string, error: PostgrestError, values?: Record<string, string>) {
  const message = error.code === "P0001" && error.hint ? RULE_MESSAGES[error.hint] : undefined;
  if (message) return formFailure(message, values);
  if (error.code === "23505") return formFailure("That code is already taken.", values);
  if (error.code === "23514")
    return formFailure("Some values are out of range. Check and try again.", values);
  return unexpectedFailure(action, error, values);
}

async function guard(): Promise<FormState | null> {
  try {
    await assertPlatformAdmin();
    return null;
  } catch (error) {
    if (error instanceof AuthorizationError) return formFailure(error.message);
    throw error;
  }
}

const reason = requiredText("Reason", 500).refine((value) => value.length >= 5, {
  error: "Give a reason of at least a few words",
});

const optionalLimit = (label: string, min: number) =>
  optional(integer(label, min, 1_000_000)).transform((value) => value ?? null);

// ---------------------------------------------------------------------------
// Account adjustments (E10-T7)
// ---------------------------------------------------------------------------

const adjustSchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("extend_trial"),
    account_id: uuid("Account"),
    reason,
    days: integer("Days", 1, 90),
  }),
  z.object({
    action: z.literal("complimentary"),
    account_id: uuid("Account"),
    reason,
    plan: z.string().min(1, { error: "Choose a plan" }),
    until: optional(isoDate("End date")),
  }),
  z.object({
    action: z.literal("correct_plan"),
    account_id: uuid("Account"),
    reason,
    plan: z.string().min(1, { error: "Choose a plan" }),
    interval: z.enum(["month", "year"], { error: "Choose monthly or annual" }),
  }),
]);

export async function adjustAccount(_previous: FormState, formData: FormData): Promise<FormState> {
  const values = formValues(formData, ["reason", "days", "plan", "until", "interval"]);
  const denied = await guard();
  if (denied) return denied;
  const parsed = validateFormData(adjustSchema, formData);
  if (!parsed.ok) return formFailure(undefined, values, parsed.fieldErrors);
  const input = parsed.data;

  const supabase = await createClient();
  const { error } = await supabase.rpc("admin_billing_adjust", {
    p_account_id: input.account_id,
    p_action: input.action,
    p_reason: input.reason,
    p_days: input.action === "extend_trial" ? input.days : undefined,
    p_plan_code: input.action === "extend_trial" ? undefined : input.plan,
    p_interval: input.action === "correct_plan" ? input.interval : undefined,
    p_until: input.action === "complimentary" ? (input.until ?? undefined) : undefined,
  });
  if (error) return failure("adjustAccount", error, values);

  revalidatePath(`/admin/customers/${input.account_id}`);
  return formSuccess(
    {
      extend_trial: "Trial extended.",
      complimentary: "Complimentary plan applied.",
      correct_plan: "Plan corrected.",
    }[input.action],
  );
}

// ---------------------------------------------------------------------------
// Plans (E14-T1)
// ---------------------------------------------------------------------------

/** "500, 9999, 99990" per line; the last line may leave the bed limit blank. */
function parseTiers(text: string) {
  const tiers = [];
  for (const line of text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean)) {
    const [beds, month, year] = line.split(",").map((part) => part.trim());
    const monthly = Number(month);
    const annual = Number(year);
    if (!Number.isFinite(monthly) || !Number.isFinite(annual) || monthly < 0 || annual < 0) {
      return null;
    }
    const upTo = beds === "" ? null : Number(beds);
    if (upTo !== null && (!Number.isInteger(upTo) || upTo < 1)) return null;
    tiers.push({
      up_to_beds: upTo,
      monthly_price: Math.round(monthly * 100),
      annual_price: Math.round(annual * 100),
    });
  }
  return tiers;
}

const planSchema = z
  .object({
    code: z
      .string()
      .trim()
      .regex(/^[a-z][a-z0-9_]{1,39}$/, {
        error: "Lower-case letters, digits and underscores, starting with a letter",
      }),
    name: requiredText("Name", 60),
    description: optional(z.string().trim().max(300)),
    pricing_basis: z.enum(["flat", "per_bed", "tiered"]),
    monthly_price: rupees("Monthly price", { positive: false, max: 10_00_000 }),
    annual_price: rupees("Annual price", { positive: false, max: 1_00_00_000 }),
    minimum_beds: integer("Minimum beds", 1, 100_000),
    tiers: z.string().default(""),
    max_beds: optionalLimit("Bed limit", 1),
    max_hostels: optionalLimit("Hostel limit", 1),
    max_staff: optionalLimit("Staff limit", 0),
    features: z.union([z.string(), z.array(z.string())]).optional(),
    is_public: z.string().optional(),
    is_active: z.string().optional(),
    sort_order: integer("Order", 0, 1000),
  })
  .transform((input, ctx) => {
    const tiers = input.pricing_basis === "tiered" ? parseTiers(input.tiers) : [];
    if (tiers === null || (input.pricing_basis === "tiered" && tiers.length === 0)) {
      ctx.addIssue({
        code: "custom",
        path: ["tiers"],
        message: "One tier per line: beds, monthly ₹, annual ₹ (leave beds blank on the last line)",
      });
      return z.NEVER;
    }
    const features = input.features === undefined ? [] : [input.features].flat();
    return {
      ...input,
      tiers,
      features,
      is_public: input.is_public === "on",
      is_active: input.is_active === "on",
    };
  });

export async function savePlan(_previous: FormState, formData: FormData): Promise<FormState> {
  const values = formValues(formData, [
    "code",
    "name",
    "description",
    "pricing_basis",
    "monthly_price",
    "annual_price",
    "minimum_beds",
    "tiers",
    "max_beds",
    "max_hostels",
    "max_staff",
    "sort_order",
  ]);
  const denied = await guard();
  if (denied) return denied;
  const parsed = validateFormData(planSchema, formData);
  if (!parsed.ok) return formFailure(undefined, values, parsed.fieldErrors);

  const supabase = await createClient();
  const { error } = await supabase.rpc("admin_save_plan", { p_plan: parsed.data });
  if (error) return failure("savePlan", error, values);

  revalidatePath("/admin/billing");
  return formSuccess("Plan saved. Running subscriptions keep their price until they renew.");
}

// ---------------------------------------------------------------------------
// Coupons (E14-T10)
// ---------------------------------------------------------------------------

const couponSchema = z
  .object({
    code: z
      .string()
      .trim()
      .toUpperCase()
      .regex(/^[A-Z0-9][A-Z0-9_-]{2,29}$/, { error: "3 to 30 letters, digits, - or _" }),
    description: optional(z.string().trim().max(200)),
    kind: z.enum(["percent", "amount"]),
    percent_off: optional(integer("Percent off", 1, 100)),
    amount_off: optional(rupees("Amount off", { max: 10_00_000 })),
    duration: z.enum(["once", "repeating", "forever"]),
    duration_cycles: optional(integer("Billing periods", 1, 36)),
    max_redemptions: optional(integer("Redemption limit", 1, 100_000)),
    redeem_by: optional(isoDate("Valid until")),
    gateway_offer_id: optional(z.string().trim().max(60)),
  })
  .superRefine((input, ctx) => {
    if (input.kind === "percent" && input.percent_off === null) {
      ctx.addIssue({ code: "custom", path: ["percent_off"], message: "Enter the percentage" });
    }
    if (input.kind === "amount" && input.amount_off === null) {
      ctx.addIssue({ code: "custom", path: ["amount_off"], message: "Enter the amount" });
    }
    if (input.duration === "repeating" && input.duration_cycles === null) {
      ctx.addIssue({
        code: "custom",
        path: ["duration_cycles"],
        message: "How many billing periods?",
      });
    }
  });

export async function createCoupon(_previous: FormState, formData: FormData): Promise<FormState> {
  const values = formValues(formData, [
    "code",
    "description",
    "kind",
    "percent_off",
    "amount_off",
    "duration",
    "duration_cycles",
    "max_redemptions",
    "redeem_by",
    "gateway_offer_id",
  ]);
  const denied = await guard();
  if (denied) return denied;
  const parsed = validateFormData(couponSchema, formData);
  if (!parsed.ok) return formFailure(undefined, values, parsed.fieldErrors);
  const input = parsed.data;

  const supabase = await createClient();
  const { error } = await supabase.rpc("admin_save_coupon", {
    p_coupon: {
      code: input.code,
      description: input.description,
      percent_off: input.kind === "percent" ? input.percent_off : null,
      amount_off: input.kind === "amount" ? input.amount_off : null,
      duration: input.duration,
      duration_cycles: input.duration === "repeating" ? input.duration_cycles : null,
      max_redemptions: input.max_redemptions,
      // The end of that day in India.
      redeem_by: input.redeem_by ? `${input.redeem_by}T23:59:59+05:30` : null,
      gateway_offer_id: input.gateway_offer_id,
    },
  });
  if (error) return failure("createCoupon", error, values);

  revalidatePath("/admin/billing");
  return formSuccess(`Coupon ${input.code} created.`);
}

const couponToggleSchema = z.object({
  id: uuid("Coupon"),
  active: z.enum(["true", "false"]),
  gateway_offer_id: optional(z.string().trim().max(60)),
});

export async function setCouponActive(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  const denied = await guard();
  if (denied) return denied;
  const parsed = validateFormData(couponToggleSchema, formData);
  if (!parsed.ok) return formFailure("That coupon could not be changed.");

  const supabase = await createClient();
  const { data: current, error: readError } = await supabase.rpc("admin_coupons");
  if (readError) return unexpectedFailure("setCouponActive", readError);
  const coupon = (
    (current ?? []) as unknown as {
      id: string;
      description: string | null;
      redeem_by: string | null;
      max_redemptions: number | null;
      gateway_offer_id: string | null;
    }[]
  ).find((row) => row.id === parsed.data.id);
  if (!coupon) return formFailure(RULE_MESSAGES.coupon_not_found);

  const { error } = await supabase.rpc("admin_save_coupon", {
    p_coupon: {
      id: coupon.id,
      description: coupon.description,
      redeem_by: coupon.redeem_by,
      max_redemptions: coupon.max_redemptions,
      gateway_offer_id: parsed.data.gateway_offer_id ?? coupon.gateway_offer_id,
      active: parsed.data.active === "true",
    },
  });
  if (error) return failure("setCouponActive", error);

  revalidatePath("/admin/billing");
  return formSuccess(parsed.data.active === "true" ? "Coupon turned on." : "Coupon turned off.");
}

// ---------------------------------------------------------------------------
// Settings: trial, grace, GST and the seller's details (E14-T3, T6, T7)
// ---------------------------------------------------------------------------

const settingsSchema = z
  .object({
    trial_days: integer("Trial length", 1, 90),
    trial_plan_code: z.string().min(1, { error: "Choose a plan" }),
    grace_days: integer("Grace period", 0, 60),
    gst_rate: z.coerce
      .number({ error: "GST rate is required" })
      .min(0, { error: "GST rate cannot be negative" })
      .max(28, { error: "GST rate is at most 28%" }),
    sac_code: z
      .string()
      .trim()
      .regex(/^\d{6}$/, { error: "SAC is 6 digits" }),
    seller_legal_name: optional(z.string().trim().max(120)),
    seller_address: optional(z.string().trim().max(300)),
    seller_gstin: optional(
      z
        .string()
        .trim()
        .toUpperCase()
        .regex(/^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/, {
          error: "Enter a valid GSTIN",
        }),
    ),
    seller_state_code: optional(z.string().regex(/^\d{2}$/, { error: "Choose a state" })),
    seller_email: optional(z.email({ error: "Enter a valid email address" })),
    terms_version: isoDate("Terms version"),
  })
  .refine(
    (input) =>
      !input.seller_gstin ||
      !input.seller_state_code ||
      input.seller_gstin.slice(0, 2) === input.seller_state_code,
    { error: "The GSTIN's first two digits must match the state", path: ["seller_gstin"] },
  );

export async function saveBillingSettings(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  const names = [
    "trial_days",
    "trial_plan_code",
    "grace_days",
    "gst_rate",
    "sac_code",
    "seller_legal_name",
    "seller_address",
    "seller_gstin",
    "seller_state_code",
    "seller_email",
    "terms_version",
  ];
  const values = formValues(formData, names);
  const denied = await guard();
  if (denied) return denied;
  const parsed = validateFormData(settingsSchema, formData);
  if (!parsed.ok) return formFailure(undefined, values, parsed.fieldErrors);
  const { gst_rate, ...rest } = parsed.data;

  const supabase = await createClient();
  const { error } = await supabase.rpc("admin_save_billing_settings", {
    p_settings: { ...rest, gst_rate_bps: Math.round(gst_rate * 100) },
  });
  if (error) return failure("saveBillingSettings", error, values);

  revalidatePath("/admin/billing");
  return formSuccess("Billing settings saved.");
}
