import "server-only";

import { createRazorpayClient, type RazorpayClient } from "./razorpay";

/**
 * Hostel ERP's own Razorpay account, for subscription billing (EP-14).
 *
 * These are optional: until the business has a Razorpay account (and the
 * values are set in the environment), the billing page explains that online
 * payment is not set up and admins can still apply plans by hand (E10-T7).
 * See docs/billing.md for where each value comes from.
 */
export interface BillingGateway {
  client: RazorpayClient;
  webhookSecret: string;
}

export function billingGateway(): BillingGateway | null {
  const keyId = process.env.RAZORPAY_KEY_ID;
  const keySecret = process.env.RAZORPAY_KEY_SECRET;
  const webhookSecret = process.env.RAZORPAY_WEBHOOK_SECRET;
  if (!keyId || !keySecret || !webhookSecret) return null;
  return { client: createRazorpayClient({ keyId, keySecret }), webhookSecret };
}

/** The webhook secret alone: verifying needs no API keys. */
export function billingWebhookSecret(): string | null {
  return process.env.RAZORPAY_WEBHOOK_SECRET || null;
}
