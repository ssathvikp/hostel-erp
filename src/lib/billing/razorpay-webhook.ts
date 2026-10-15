import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Razorpay webhooks (E14-T5, E13-T10). Pure functions, so the rules that keep
 * forged and replayed events out are unit-tested without a gateway.
 *
 * Razorpay signs the raw request body with the webhook secret
 * (HMAC-SHA256, hex) in `X-Razorpay-Signature`, and names each event in
 * `X-Razorpay-Event-Id`. The body must be verified exactly as received:
 * parsing and re-serialising it would change the bytes.
 */

/** True only for a signature made with `secret` over exactly `body`. */
export function verifyRazorpaySignature(
  body: string,
  signature: string | null | undefined,
  secret: string,
): boolean {
  if (!signature || !secret || !/^[0-9a-f]{64}$/i.test(signature)) return false;
  const expected = createHmac("sha256", secret).update(body, "utf8").digest();
  const given = Buffer.from(signature, "hex");
  return given.length === expected.length && timingSafeEqual(given, expected);
}

/** Signs `body` as Razorpay would; for tests and local webhook replays. */
export function signRazorpayBody(body: string, secret: string): string {
  return createHmac("sha256", secret).update(body, "utf8").digest("hex");
}

/** What the database needs to know about a subscription event. */
export type SubscriptionEventKind =
  | "authenticated"
  | "activated"
  | "charged"
  | "pending"
  | "halted"
  | "cancelled"
  | "completed"
  | "refunded";

const SUBSCRIPTION_EVENTS: Record<string, SubscriptionEventKind> = {
  "subscription.authenticated": "authenticated",
  "subscription.activated": "activated",
  "subscription.charged": "charged",
  "subscription.pending": "pending",
  "subscription.halted": "halted",
  "subscription.cancelled": "cancelled",
  "subscription.completed": "completed",
  "refund.processed": "refunded",
};

export interface NormalisedSubscriptionEvent {
  eventType: string;
  kind: SubscriptionEventKind;
  data: {
    subscription_id: string | null;
    customer_id: string | null;
    status: string | null;
    current_start: string | null;
    current_end: string | null;
    payment: { id: string; amount: number } | null;
    refund: { id: string; payment_id: string; amount: number } | null;
  };
}

type Json = Record<string, unknown>;

function entity(payload: Json, name: string): Json | null {
  const wrapper = payload[name];
  if (!wrapper || typeof wrapper !== "object") return null;
  const inner = (wrapper as Json).entity;
  return inner && typeof inner === "object" ? (inner as Json) : null;
}

function text(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 && value.length <= 100 ? value : null;
}

function paise(value: unknown): number | null {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : null;
}

/** Razorpay sends Unix seconds; the database wants ISO instants. */
function instant(value: unknown): string | null {
  return typeof value === "number" && Number.isFinite(value) && value > 0
    ? new Date(value * 1000).toISOString()
    : null;
}

/**
 * The subscription event a webhook body describes, or null for events the
 * platform does not act on (they are acknowledged and dropped).
 */
export function normaliseSubscriptionEvent(body: unknown): NormalisedSubscriptionEvent | null {
  if (!body || typeof body !== "object") return null;
  const event = (body as Json).event;
  const payload = (body as Json).payload;
  if (typeof event !== "string" || !payload || typeof payload !== "object") return null;
  const kind = SUBSCRIPTION_EVENTS[event];
  if (!kind) return null;

  const subscription = entity(payload as Json, "subscription");
  const payment = entity(payload as Json, "payment");
  const refund = entity(payload as Json, "refund");

  const paymentId = text(payment?.id);
  const paymentAmount = paise(payment?.amount);
  const refundId = text(refund?.id);
  const refundPayment = text(refund?.payment_id);
  const refundAmount = paise(refund?.amount);

  const data: NormalisedSubscriptionEvent["data"] = {
    subscription_id: text(subscription?.id),
    customer_id: text(subscription?.customer_id),
    status: text(subscription?.status),
    current_start: instant(subscription?.current_start),
    current_end: instant(subscription?.current_end),
    payment:
      paymentId && paymentAmount !== null && payment?.status !== "failed"
        ? { id: paymentId, amount: paymentAmount }
        : null,
    refund:
      refundId && refundPayment && refundAmount !== null
        ? { id: refundId, payment_id: refundPayment, amount: refundAmount }
        : null,
  };

  if (kind === "refunded" ? !data.refund : !data.subscription_id) return null;
  return { eventType: event, kind, data };
}

/** Event ids are opaque gateway strings; anything odd is not worth storing. */
export function isGatewayEventId(value: string | null): value is string {
  return typeof value === "string" && /^[A-Za-z0-9_-]{6,100}$/.test(value);
}

/** What the database needs to know about a rent payment event (E13-T10). */
export type RentEventKind = "link_paid" | "payment_failed" | "refunded" | "settled";

const RENT_EVENTS: Record<string, RentEventKind> = {
  "payment_link.paid": "link_paid",
  "payment.failed": "payment_failed",
  "refund.processed": "refunded",
  "settlement.processed": "settled",
};

export interface NormalisedRentEvent {
  eventType: string;
  kind: RentEventKind;
  data: {
    link_id?: string;
    payment?: {
      id: string;
      amount: number;
      fee: number | null;
      tax: number | null;
      method: string | null;
      error?: string | null;
    };
    refund?: { id: string; payment_id: string; amount: number };
    settlement?: {
      id: string;
      amount: number;
      fees: number;
      tax: number;
      utr: string | null;
      settled_at: string | null;
    };
  };
}

/**
 * The rent event a webhook body from an owner's own Razorpay account
 * describes, or null for anything the app does not act on.
 */
export function normaliseRentEvent(body: unknown): NormalisedRentEvent | null {
  if (!body || typeof body !== "object") return null;
  const event = (body as Json).event;
  const payload = (body as Json).payload;
  if (typeof event !== "string" || !payload || typeof payload !== "object") return null;
  const kind = RENT_EVENTS[event];
  if (!kind) return null;

  const payment = entity(payload as Json, "payment");
  const paymentData = () => {
    const id = text(payment?.id);
    const amount = paise(payment?.amount);
    if (!id || amount === null) return null;
    return {
      id,
      amount,
      fee: paise(payment?.fee),
      tax: paise(payment?.tax),
      method: text(payment?.method),
    };
  };

  if (kind === "link_paid") {
    const link = entity(payload as Json, "payment_link");
    const linkId = text(link?.id);
    const paid = paymentData();
    if (!linkId || !paid || payment?.status === "failed") return null;
    return { eventType: event, kind, data: { link_id: linkId, payment: paid } };
  }
  if (kind === "payment_failed") {
    const failed = paymentData();
    if (!failed) return null;
    const error = text(payment?.error_description) ?? text(payment?.error_reason);
    return { eventType: event, kind, data: { payment: { ...failed, error } } };
  }
  if (kind === "refunded") {
    const refund = entity(payload as Json, "refund");
    const id = text(refund?.id);
    const paymentId = text(refund?.payment_id);
    const amount = paise(refund?.amount);
    if (!id || !paymentId || !amount) return null;
    return { eventType: event, kind, data: { refund: { id, payment_id: paymentId, amount } } };
  }
  const settlement = entity(payload as Json, "settlement");
  const id = text(settlement?.id);
  const amount = paise(settlement?.amount);
  if (!id || amount === null) return null;
  return {
    eventType: event,
    kind,
    data: {
      settlement: {
        id,
        amount,
        fees: paise(settlement?.fees) ?? 0,
        tax: paise(settlement?.tax) ?? 0,
        utr: text(settlement?.utr),
        settled_at: instant(settlement?.created_at),
      },
    },
  };
}
