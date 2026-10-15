import "server-only";

/**
 * A minimal Razorpay REST client (https://razorpay.com/docs/api/). Used for
 * Hostel ERP's own subscription billing (EP-14) with the platform's keys,
 * and for resident rent links (E13-T10) with each owner's own keys.
 *
 * No card or UPI details ever pass through it: customers pay on Razorpay's
 * hosted pages. Errors carry Razorpay's code and description, never the
 * keys.
 */

const API = "https://api.razorpay.com/v1";
const TIMEOUT_MS = 15_000;

export interface RazorpayKeys {
  keyId: string;
  keySecret: string;
}

export class GatewayError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code?: string,
  ) {
    super(message);
    this.name = "GatewayError";
  }
}

export interface RazorpayPlan {
  id: string;
}

export interface RazorpaySubscription {
  id: string;
  status: string;
  short_url?: string;
  customer_id?: string | null;
}

export interface RazorpayPaymentLink {
  id: string;
  short_url: string;
  status: string;
}

export function createRazorpayClient({ keyId, keySecret }: RazorpayKeys) {
  const authorization = `Basic ${Buffer.from(`${keyId}:${keySecret}`).toString("base64")}`;

  async function call<T>(
    method: "GET" | "POST" | "PATCH",
    path: string,
    body?: unknown,
  ): Promise<T> {
    let response: Response;
    try {
      response = await fetch(`${API}${path}`, {
        method,
        headers: { authorization, "content-type": "application/json" },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(TIMEOUT_MS),
        cache: "no-store",
      });
    } catch (error) {
      throw new GatewayError(
        error instanceof Error && error.name === "TimeoutError"
          ? "The payment gateway did not answer in time"
          : "The payment gateway could not be reached",
        0,
      );
    }
    const json = (await response.json().catch(() => null)) as
      (T & { error?: { code?: string; description?: string } }) | null;
    if (!response.ok || !json) {
      throw new GatewayError(
        json?.error?.description ?? `Payment gateway error ${response.status}`,
        response.status,
        json?.error?.code,
      );
    }
    return json;
  }

  return {
    /** A plan charges a fixed amount (paise, GST included) every period. */
    createPlan(input: {
      period: "monthly" | "yearly";
      amount: number;
      name: string;
      description: string;
      notes?: Record<string, string>;
    }) {
      return call<RazorpayPlan>("POST", "/plans", {
        period: input.period,
        interval: 1,
        item: {
          name: input.name,
          amount: input.amount,
          currency: "INR",
          description: input.description,
        },
        notes: input.notes,
      });
    },

    /**
     * A subscription the customer authorises on Razorpay's hosted page
     * (`short_url`). Cards and UPI AutoPay mandates follow RBI's e-mandate
     * rules there, including pre-debit notifications.
     */
    createSubscription(input: {
      planId: string;
      totalCount: number;
      offerId?: string | null;
      notes?: Record<string, string>;
      notifyEmail?: string;
      notifyPhone?: string | null;
    }) {
      return call<RazorpaySubscription>("POST", "/subscriptions", {
        plan_id: input.planId,
        total_count: input.totalCount,
        quantity: 1,
        customer_notify: 1,
        offer_id: input.offerId ?? undefined,
        notes: input.notes,
        notify_info: input.notifyEmail
          ? { notify_email: input.notifyEmail, notify_phone: input.notifyPhone ?? undefined }
          : undefined,
      });
    },

    /** Moves a subscription to another plan now or at the end of the cycle. */
    updateSubscription(id: string, input: { planId: string; when: "now" | "cycle_end" }) {
      return call<RazorpaySubscription>("PATCH", `/subscriptions/${encodeURIComponent(id)}`, {
        plan_id: input.planId,
        schedule_change_at: input.when,
      });
    },

    cancelSubscription(id: string, { atCycleEnd }: { atCycleEnd: boolean }) {
      return call<RazorpaySubscription>("POST", `/subscriptions/${encodeURIComponent(id)}/cancel`, {
        cancel_at_cycle_end: atCycleEnd ? 1 : 0,
      });
    },

    fetchSubscription(id: string) {
      return call<RazorpaySubscription>("GET", `/subscriptions/${encodeURIComponent(id)}`);
    },

    /** A one-off link for an amount (E13-T10); UPI, cards and netbanking. */
    createPaymentLink(input: {
      amount: number;
      description: string;
      referenceId: string;
      expireBy: number;
      customer: { name: string; contact?: string | null; email?: string | null };
      notes?: Record<string, string>;
      callbackUrl?: string;
    }) {
      return call<RazorpayPaymentLink>("POST", "/payment_links", {
        amount: input.amount,
        currency: "INR",
        accept_partial: false,
        description: input.description,
        reference_id: input.referenceId,
        expire_by: input.expireBy,
        customer: {
          name: input.customer.name,
          contact: input.customer.contact ? `+91${input.customer.contact}` : undefined,
          email: input.customer.email ?? undefined,
        },
        notify: { sms: false, email: false },
        reminder_enable: false,
        notes: input.notes,
        callback_url: input.callbackUrl,
        callback_method: input.callbackUrl ? "get" : undefined,
      });
    },

    cancelPaymentLink(id: string) {
      return call<RazorpayPaymentLink>("POST", `/payment_links/${encodeURIComponent(id)}/cancel`);
    },
  };
}

export type RazorpayClient = ReturnType<typeof createRazorpayClient>;
