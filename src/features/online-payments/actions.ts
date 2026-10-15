"use server";

import { randomBytes } from "node:crypto";

import type { PostgrestError } from "@supabase/supabase-js";
import { revalidatePath } from "next/cache";
import { z } from "zod";

import { requireRole } from "@/lib/auth/session";
import { AuthorizationError } from "@/lib/auth/roles";
import { createRazorpayClient, GatewayError } from "@/lib/billing/razorpay";
import { getHostelContext } from "@/lib/hostels/active";
import {
  canStoreGatewayKeys,
  openGatewaySecret,
  sealGatewaySecret,
  siteUrl,
} from "@/lib/payments/config";
import { logUnexpected, unexpectedFailure } from "@/lib/request-context";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import {
  formFailure,
  formSuccess,
  formValues,
  uuid,
  validateFormData,
  type FormState,
} from "@/lib/validation";

/**
 * Online rent collection (E13-T10). Owners connect the hostel's own
 * Razorpay account; owners and staff send payment links. The money is
 * recorded only by the gateway's signed webhook, never here.
 */

const RULE_MESSAGES: Record<string, string> = {
  invoice_not_found: "This invoice could not be found.",
  invoice_void: "A void invoice cannot be paid.",
  nothing_due: "Nothing is due on this invoice.",
  gateway_not_connected:
    "Online payment is not set up for this hostel. The owner can connect it under Settings → Online payments.",
};

async function failure(action: string, error: PostgrestError, values?: Record<string, string>) {
  const message = error.code === "P0001" && error.hint ? RULE_MESSAGES[error.hint] : undefined;
  return message ? formFailure(message, values) : unexpectedFailure(action, error, values);
}

async function guard(roles: ("owner" | "staff")[]) {
  try {
    return { user: await requireRole(roles), denied: null };
  } catch (error) {
    if (error instanceof AuthorizationError)
      return { user: null, denied: formFailure(error.message) };
    throw error;
  }
}

// ---------------------------------------------------------------------------
// Connecting the gateway (owners)
// ---------------------------------------------------------------------------

const connectSchema = z.object({
  key_id: z
    .string()
    .trim()
    .regex(/^rzp_(test|live)_[A-Za-z0-9]{6,40}$/, {
      error: "Key id starts with rzp_test_ or rzp_live_",
    }),
  key_secret: z.string().trim().min(10, { error: "Paste the key secret" }).max(100),
  webhook_secret: z
    .string()
    .trim()
    .min(8, { error: "Use a webhook secret of at least 8 characters" })
    .max(100),
});

/**
 * Saves the hostel's Razorpay keys, encrypted. The key pair is checked with
 * a harmless API call first, so a typo is caught now rather than when a
 * resident tries to pay.
 */
export async function connectGateway(_previous: FormState, formData: FormData): Promise<FormState> {
  const values = formValues(formData, ["key_id"]);
  const { denied } = await guard(["owner"]);
  if (denied) return denied;
  const parsed = validateFormData(connectSchema, formData);
  if (!parsed.ok) return formFailure(undefined, values, parsed.fieldErrors);
  if (!canStoreGatewayKeys()) {
    return formFailure(
      "Online payments cannot be connected yet: the server's encryption key is not configured. Contact support.",
      values,
    );
  }
  const { active } = await getHostelContext();
  if (!active) return formFailure("Choose a hostel first.", values);

  try {
    // Any authenticated call proves the pair; listing one link is cheap.
    const response = await fetch("https://api.razorpay.com/v1/payment_links?count=1", {
      headers: {
        authorization: `Basic ${Buffer.from(`${parsed.data.key_id}:${parsed.data.key_secret}`).toString("base64")}`,
      },
      signal: AbortSignal.timeout(10_000),
      cache: "no-store",
    });
    if (response.status === 401) {
      return formFailure(
        "Razorpay did not accept that key id and secret. Check them and try again.",
        values,
      );
    }
  } catch (error) {
    // Unreachable gateway: save anyway; links will report a problem later.
    await logUnexpected("connectGateway:check", error);
  }

  const supabase = await createClient();
  const sealed = {
    key_id: parsed.data.key_id,
    key_secret_encrypted: sealGatewaySecret(parsed.data.key_secret),
    webhook_secret_encrypted: sealGatewaySecret(parsed.data.webhook_secret),
  };
  const updated = await supabase
    .from("payment_gateway_accounts")
    .update({ ...sealed, enabled: true })
    .eq("hostel_id", active.id)
    .select("hostel_id");
  const error =
    updated.error ??
    (updated.data?.length
      ? null
      : (
          await supabase.from("payment_gateway_accounts").insert({
            hostel_id: active.id,
            webhook_token: randomBytes(16).toString("hex"),
            ...sealed,
          })
        ).error);
  if (error) return unexpectedFailure("connectGateway", error, values);

  revalidatePath("/settings/payments");
  return formSuccess("Razorpay is connected. Add the webhook below in your Razorpay dashboard.");
}

const toggleSchema = z.object({ enabled: z.enum(["true", "false"]) });

export async function setGatewayEnabled(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  const { denied } = await guard(["owner"]);
  if (denied) return denied;
  const parsed = validateFormData(toggleSchema, formData);
  if (!parsed.ok) return formFailure("That could not be changed.");
  const { active } = await getHostelContext();
  if (!active) return formFailure("Choose a hostel first.");

  const supabase = await createClient();
  const { error } = await supabase
    .from("payment_gateway_accounts")
    .update({ enabled: parsed.data.enabled === "true" })
    .eq("hostel_id", active.id);
  if (error) return unexpectedFailure("setGatewayEnabled", error);
  revalidatePath("/settings/payments");
  return formSuccess(
    parsed.data.enabled === "true"
      ? "Online payments are on."
      : "Online payments are off. Existing links still work until they expire.",
  );
}

/**
 * Deletes the keys. Payments on links already sent can then no longer be
 * recorded automatically, so the settings page warns before this.
 */
export async function disconnectGateway(): Promise<FormState> {
  const { denied } = await guard(["owner"]);
  if (denied) return denied;
  const { active } = await getHostelContext();
  if (!active) return formFailure("Choose a hostel first.");
  const supabase = await createClient();
  const { error } = await supabase
    .from("payment_gateway_accounts")
    .delete()
    .eq("hostel_id", active.id);
  if (error) return unexpectedFailure("disconnectGateway", error);
  revalidatePath("/settings/payments");
  return formSuccess("Razorpay is disconnected and its keys are deleted.");
}

// ---------------------------------------------------------------------------
// Payment links (owners and staff)
// ---------------------------------------------------------------------------

const linkSchema = z.object({ invoice_id: uuid("Invoice") });

const LINK_DAYS = 15;

interface Prepared {
  hostel_id: string;
  invoice_id: string;
  invoice_number: string;
  period_month: string;
  resident_id: string;
  resident_name: string;
  resident_phone: string | null;
  resident_email: string | null;
  hostel_name: string;
  amount: number;
  live: { reusable: boolean; gateway_link_id: string } | null;
}

/**
 * A payment link for the invoice's open balance. A live link for the same
 * amount is kept; otherwise a new one replaces it (the old one is
 * cancelled at the gateway so it cannot be paid twice).
 */
export async function createPaymentLink(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  const { denied } = await guard(["owner", "staff"]);
  if (denied) return denied;
  const parsed = validateFormData(linkSchema, formData);
  if (!parsed.ok) return formFailure("That invoice could not be found.");

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("prepare_payment_link", {
    p_invoice_id: parsed.data.invoice_id,
  });
  if (error) return failure("createPaymentLink", error);
  const prepared = data as unknown as Prepared;
  if (prepared.live?.reusable) {
    return formSuccess("The current link is still valid for this amount.");
  }

  const { data: keys, error: keysError } = await createAdminClient().rpc("gateway_keys", {
    p_hostel_id: prepared.hostel_id,
  });
  if (keysError || !keys)
    return failure(
      "createPaymentLink",
      keysError ?? ({ code: "P0001", hint: "gateway_not_connected" } as PostgrestError),
    );
  const { key_id, key_secret_encrypted } = keys as { key_id: string; key_secret_encrypted: string };

  try {
    const client = createRazorpayClient({
      keyId: key_id,
      keySecret: openGatewaySecret(key_secret_encrypted),
    });
    if (prepared.live) {
      await client.cancelPaymentLink(prepared.live.gateway_link_id).catch(() => undefined);
    }
    const expiresAt = new Date(Date.now() + LINK_DAYS * 86_400_000);
    const created = await client.createPaymentLink({
      amount: prepared.amount,
      description: `Rent ${prepared.invoice_number} at ${prepared.hostel_name}`.slice(0, 2048),
      referenceId: `${prepared.invoice_number}-${Date.now().toString(36)}`.slice(0, 40),
      expireBy: Math.floor(expiresAt.getTime() / 1000),
      customer: {
        name: prepared.resident_name,
        contact: prepared.resident_phone,
        email: prepared.resident_email,
      },
      notes: { invoice_id: prepared.invoice_id, hostel_id: prepared.hostel_id },
      callbackUrl: `${siteUrl()}/pay/thanks`,
    });
    const { error: recordError } = await supabase.rpc("record_payment_link", {
      p_invoice_id: prepared.invoice_id,
      p_amount: prepared.amount,
      p_gateway_link_id: created.id,
      p_short_url: created.short_url,
      p_expires_at: expiresAt.toISOString(),
    });
    if (recordError) return unexpectedFailure("createPaymentLink", recordError);
  } catch (gatewayError) {
    await logUnexpected("createPaymentLink", gatewayError);
    return formFailure(
      gatewayError instanceof GatewayError && gatewayError.status === 401
        ? "Razorpay refused the hostel's keys. The owner can reconnect under Settings → Online payments."
        : "The payment gateway could not be reached. Try again in a minute.",
    );
  }

  revalidatePath(`/fees/${prepared.invoice_id}`);
  return formSuccess("Payment link ready. Share it with the resident.");
}
