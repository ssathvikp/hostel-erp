import { describe, expect, it } from "vitest";

import {
  isGatewayEventId,
  normaliseSubscriptionEvent,
  signRazorpayBody,
  verifyRazorpaySignature,
} from "@/lib/billing/razorpay-webhook";

const SECRET = "whsec_test_only";

function charged(overrides: Record<string, unknown> = {}) {
  return {
    entity: "event",
    event: "subscription.charged",
    payload: {
      subscription: {
        entity: {
          id: "sub_00000000000001",
          customer_id: "cust_1",
          status: "active",
          current_start: 1_790_000_000,
          current_end: 1_792_592_000,
        },
      },
      payment: { entity: { id: "pay_1", amount: 117882, status: "captured" } },
    },
    ...overrides,
  };
}

describe("webhook signatures", () => {
  const body = JSON.stringify(charged());

  it("accepts a signature made with the secret over the exact body", () => {
    expect(verifyRazorpaySignature(body, signRazorpayBody(body, SECRET), SECRET)).toBe(true);
  });

  it("rejects a forged, missing or malformed signature", () => {
    expect(verifyRazorpaySignature(body, signRazorpayBody(body, "other"), SECRET)).toBe(false);
    expect(verifyRazorpaySignature(body, null, SECRET)).toBe(false);
    expect(verifyRazorpaySignature(body, "zz", SECRET)).toBe(false);
    expect(verifyRazorpaySignature(body, "a".repeat(64), SECRET)).toBe(false);
  });

  it("rejects a body changed after signing, even by whitespace", () => {
    const signature = signRazorpayBody(body, SECRET);
    expect(verifyRazorpaySignature(`${body} `, signature, SECRET)).toBe(false);
    expect(verifyRazorpaySignature(body.replace("117882", "1"), signature, SECRET)).toBe(false);
  });

  it("never verifies without a secret", () => {
    expect(verifyRazorpaySignature(body, signRazorpayBody(body, ""), "")).toBe(false);
  });
});

describe("normalising events", () => {
  it("reads a charge: subscription, period and payment", () => {
    expect(normaliseSubscriptionEvent(charged())).toEqual({
      eventType: "subscription.charged",
      kind: "charged",
      data: {
        subscription_id: "sub_00000000000001",
        customer_id: "cust_1",
        status: "active",
        current_start: new Date(1_790_000_000_000).toISOString(),
        current_end: new Date(1_792_592_000_000).toISOString(),
        payment: { id: "pay_1", amount: 117882 },
        refund: null,
      },
    });
  });

  it("drops a failed payment's amount", () => {
    const failed = charged();
    failed.payload.payment.entity.status = "failed";
    expect(normaliseSubscriptionEvent(failed)?.data.payment).toBeNull();
  });

  it("reads a refund without a subscription", () => {
    const refund = normaliseSubscriptionEvent({
      event: "refund.processed",
      payload: { refund: { entity: { id: "rfnd_1", payment_id: "pay_1", amount: 5000 } } },
    });
    expect(refund?.kind).toBe("refunded");
    expect(refund?.data.refund).toEqual({ id: "rfnd_1", payment_id: "pay_1", amount: 5000 });
  });

  it("ignores events it does not act on and malformed bodies", () => {
    expect(normaliseSubscriptionEvent({ event: "order.paid", payload: {} })).toBeNull();
    expect(normaliseSubscriptionEvent(charged({ payload: {} }))).toBeNull();
    expect(normaliseSubscriptionEvent("not json")).toBeNull();
    expect(normaliseSubscriptionEvent(null)).toBeNull();
  });

  it("refuses amounts that are not whole paise", () => {
    const odd = charged();
    (odd.payload.payment.entity as { amount: unknown }).amount = 10.5;
    expect(normaliseSubscriptionEvent(odd)?.data.payment).toBeNull();
  });
});

describe("event ids", () => {
  it("accepts gateway-shaped ids only", () => {
    expect(isGatewayEventId("KqQ0aBcDeFgHiJ")).toBe(true);
    expect(isGatewayEventId("")).toBe(false);
    expect(isGatewayEventId(null)).toBe(false);
    expect(isGatewayEventId("x'; drop table")).toBe(false);
  });
});
