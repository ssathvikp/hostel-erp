import { randomUUID } from "node:crypto";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { feeFixtures, monthStart } from "../support/fees";
import { createUserFactory, type TestUser } from "../support/supabase";

/**
 * Online rent collection through the hostel's own gateway (E13-T10): the
 * account and its secrets, payment links, the webhook recording money once,
 * extra money as credit, refunds mirrored, settlements and reconciliation.
 */
const RAISED = "P0001";
const PERMISSION_DENIED = "42501";

const { admin, createUser, createHostel, cleanup } = createUserFactory();
let owner: TestUser;
let staff: TestUser;
let hostelId: string;
const fees = feeFixtures(admin, () => owner);

afterAll(cleanup);

const SEALED = "v1.aXY.dGFn.Ym9keQ";

beforeAll(async () => {
  owner = await createUser({ fullName: "Online Owner" });
  hostelId = (await createHostel(owner.id)).id;
  staff = await createUser({ profile: { role: "staff", hostel_id: hostelId } });
});

/** A resident with an issued invoice for last month of `rent` paise. */
async function invoice(rent = 850000) {
  const residentId = await fees.billedResident(hostelId, rent);
  await fees.generate(hostelId, monthStart(-1));
  const row = await fees.invoiceFor(residentId, monthStart(-1));
  return { residentId, invoiceId: row!.id, number: row!.number };
}

async function link(invoiceId: string, amount: number) {
  const gatewayLinkId = `plink_${randomUUID().slice(0, 12)}`;
  const { error } = await staff.client.rpc("record_payment_link", {
    p_invoice_id: invoiceId,
    p_amount: amount,
    p_gateway_link_id: gatewayLinkId,
    p_short_url: `https://rzp.io/i/${gatewayLinkId}`,
    p_expires_at: new Date(Date.now() + 7 * 86_400_000).toISOString(),
  });
  expect(error).toBeNull();
  return gatewayLinkId;
}

function event(kind: string, data: Record<string, unknown>, eventId = `evt_${randomUUID()}`) {
  return admin.rpc("collect_gateway_event", {
    p_hostel_id: hostelId,
    p_event_id: eventId,
    p_event_type: kind,
    p_kind: kind,
    p_data: data as never,
  });
}

function paid(linkId: string, amount: number, paymentId = `pay_${randomUUID().slice(0, 12)}`) {
  return {
    link_id: linkId,
    payment: { id: paymentId, amount, fee: Math.round(amount * 0.02), tax: 300, method: "upi" },
  };
}

async function balance(invoiceId: string) {
  const { data } = await admin
    .from("invoice_balances")
    .select("balance")
    .eq("id", invoiceId)
    .single();
  return data!.balance;
}

describe("the gateway account", () => {
  it("cannot make links before the hostel connects a gateway", async () => {
    const { invoiceId } = await invoice();
    const { error } = await owner.client.rpc("prepare_payment_link", { p_invoice_id: invoiceId });
    expect(error?.code).toBe(RAISED);
    expect(error?.hint).toBe("gateway_not_connected");
  });

  it("lets only the owner connect, and nobody signed in read the secrets", async () => {
    const row = {
      hostel_id: hostelId,
      key_id: "rzp_test_ABCDEF123456",
      key_secret_encrypted: SEALED,
      webhook_secret_encrypted: SEALED,
      webhook_token: randomUUID().replaceAll("-", ""),
    };
    const byStaff = await staff.client.from("payment_gateway_accounts").insert(row);
    expect(byStaff.error).not.toBeNull();

    const byOwner = await owner.client.from("payment_gateway_accounts").insert(row);
    expect(byOwner.error).toBeNull();

    const visible = await staff.client
      .from("payment_gateway_accounts")
      .select("key_id, enabled")
      .eq("hostel_id", hostelId)
      .single();
    expect(visible.data).toEqual({ key_id: "rzp_test_ABCDEF123456", enabled: true });

    for (const user of [owner, staff]) {
      const secret = await user.client
        .from("payment_gateway_accounts")
        .select("key_secret_encrypted")
        .eq("hostel_id", hostelId);
      expect(secret.error?.code).toBe(PERMISSION_DENIED);
    }
  });

  it("keeps the webhook and key lookups away from signed-in users", async () => {
    const { error } = await owner.client.rpc("gateway_keys", { p_hostel_id: hostelId });
    expect(error?.code).toBe(PERMISSION_DENIED);
    const collect = await owner.client.rpc("collect_gateway_event", {
      p_hostel_id: hostelId,
      p_event_id: "evt_forged",
      p_event_type: "payment_link.paid",
      p_kind: "link_paid",
      p_data: {},
    });
    expect(collect.error?.code).toBe(PERMISSION_DENIED);
  });
});

describe("payment links and payments", () => {
  it("offers the open balance and replaces a live link with a new one", async () => {
    const { invoiceId } = await invoice();
    const { data } = await staff.client.rpc("prepare_payment_link", { p_invoice_id: invoiceId });
    expect(data).toMatchObject({ amount: 850000, invoice_id: invoiceId, live: null });

    const first = await link(invoiceId, 850000);
    const again = await staff.client.rpc("prepare_payment_link", { p_invoice_id: invoiceId });
    expect(again.data).toMatchObject({ live: { amount: 850000, reusable: true } });

    await link(invoiceId, 850000);
    const { data: links } = await admin
      .from("payment_links")
      .select("gateway_link_id, status")
      .eq("invoice_id", invoiceId);
    expect(links?.find((l) => l.gateway_link_id === first)?.status).toBe("cancelled");
    expect(links?.filter((l) => l.status === "created")).toHaveLength(1);
  });

  it("records a paid link once, as an online payment with a receipt number", async () => {
    const { invoiceId } = await invoice();
    const linkId = await link(invoiceId, 850000);
    const body = paid(linkId, 850000);
    const eventId = `evt_${randomUUID()}`;

    expect((await event("link_paid", body, eventId)).data).toBe("applied");
    expect((await event("link_paid", body, eventId)).data).toBe("duplicate");
    expect((await event("link_paid", body)).data).toBe("duplicate");

    const { data: payments } = await admin
      .from("payments")
      .select("amount, mode, reference, number, recorded_by")
      .eq("invoice_id", invoiceId);
    expect(payments).toHaveLength(1);
    expect(payments![0]).toMatchObject({
      amount: 850000,
      mode: "online",
      reference: body.payment.id,
      recorded_by: owner.id,
    });
    expect(payments![0].number).toMatch(/^RCT\//);
    expect(await balance(invoiceId)).toBe(0);
    const { data: linkRow } = await admin
      .from("payment_links")
      .select("status, gateway_payment_id")
      .eq("gateway_link_id", linkId)
      .single();
    expect(linkRow).toEqual({ status: "paid", gateway_payment_id: body.payment.id });
  });

  it("keeps money beyond what is still due as the resident's credit", async () => {
    const { invoiceId, residentId } = await invoice();
    const linkId = await link(invoiceId, 850000);
    // Part of it was paid in cash after the link went out.
    const cash = await owner.client.rpc("record_payment", {
      p_invoice_id: invoiceId,
      p_amount: 300000,
      p_paid_at: monthStart(0),
      p_mode: "cash",
    });
    expect(cash.error).toBeNull();

    expect((await event("link_paid", paid(linkId, 850000))).data).toBe("applied");
    expect(await balance(invoiceId)).toBe(0);
    const { data: credit } = await admin
      .from("resident_credit")
      .select("kind, amount, mode, number")
      .eq("resident_id", residentId);
    expect(credit).toEqual([
      expect.objectContaining({ kind: "received", amount: 300000, mode: "online" }),
    ]);
  });

  it("does not let anyone signed in record an online payment by hand", async () => {
    const { invoiceId } = await invoice();
    const { error } = await owner.client.rpc("record_payment", {
      p_invoice_id: invoiceId,
      p_amount: 1000,
      p_paid_at: monthStart(0),
      p_mode: "online",
    });
    expect(error?.hint).toBe("payment_mode_online");
  });

  it("records a failed payment for visibility, without money", async () => {
    const paymentId = `pay_${randomUUID().slice(0, 12)}`;
    await event("payment_failed", {
      payment: { id: paymentId, amount: 850000, method: "card", error: "Card declined" },
    });
    const { data } = await admin
      .from("gateway_payments")
      .select("status, note, payment_id")
      .eq("gateway_payment_id", paymentId)
      .single();
    expect(data).toEqual({ status: "failed", note: "Card declined", payment_id: null });
  });
});

describe("refunds", () => {
  it("voids a fully refunded payment, once", async () => {
    const { invoiceId } = await invoice();
    const body = paid(await link(invoiceId, 850000), 850000);
    await event("link_paid", body);
    const refund = {
      refund: {
        id: `rfnd_${randomUUID().slice(0, 10)}`,
        payment_id: body.payment.id,
        amount: 850000,
      },
    };
    expect((await event("refunded", refund)).data).toBe("applied");
    expect((await event("refunded", refund)).data).toBe("duplicate");

    const { data } = await admin
      .from("payments")
      .select("voided_at, void_reason")
      .eq("invoice_id", invoiceId);
    expect(data).toHaveLength(1);
    expect(data![0].void_reason).toBe(`Refunded online (${refund.refund.id})`);
    expect(await balance(invoiceId)).toBe(850000);
  });

  it("re-records what was kept after a partial refund", async () => {
    const { invoiceId } = await invoice();
    const body = paid(await link(invoiceId, 850000), 850000);
    await event("link_paid", body);
    await event("refunded", {
      refund: {
        id: `rfnd_${randomUUID().slice(0, 10)}`,
        payment_id: body.payment.id,
        amount: 50000,
      },
    });
    const { data } = await admin
      .from("payments")
      .select("amount, voided_at")
      .eq("invoice_id", invoiceId)
      .is("voided_at", null);
    expect(data).toEqual([{ amount: 800000, voided_at: null }]);
    expect(await balance(invoiceId)).toBe(50000);
  });

  it("takes a refund of the extra from credit, and says what it could not take back", async () => {
    const { invoiceId, residentId } = await invoice();
    const linkId = await link(invoiceId, 850000);
    await owner.client.rpc("record_payment", {
      p_invoice_id: invoiceId,
      p_amount: 850000,
      p_paid_at: monthStart(0),
      p_mode: "cash",
    });
    const body = paid(linkId, 850000);
    await event("link_paid", body);

    const refundId = `rfnd_${randomUUID().slice(0, 10)}`;
    expect(
      (
        await event("refunded", {
          refund: { id: refundId, payment_id: body.payment.id, amount: 850000 },
        })
      ).data,
    ).toBe("applied");
    const { data: credit } = await admin
      .from("resident_credit")
      .select("kind, amount")
      .eq("resident_id", residentId)
      .order("created_at");
    expect(credit).toEqual([
      { kind: "received", amount: 850000 },
      { kind: "refund", amount: 850000 },
    ]);
    const { data: refund } = await admin
      .from("gateway_refunds")
      .select("mirrored")
      .eq("gateway_refund_id", refundId)
      .single();
    expect(refund?.mirrored).toBe("credit");

    const unknown = `rfnd_${randomUUID().slice(0, 10)}`;
    expect(
      (
        await event("refunded", {
          refund: { id: unknown, payment_id: "pay_elsewhere", amount: 100 },
        })
      ).data,
    ).toBe("unrecorded");
  });
});

describe("settlements and reconciliation", () => {
  it("lists payments with fees against settlements for the period", async () => {
    await event("settled", {
      settlement: {
        id: `setl_${randomUUID().slice(0, 10)}`,
        amount: 830000,
        fees: 17000,
        tax: 3060,
        utr: "UTR0001",
        settled_at: new Date().toISOString(),
      },
    });
    const { data, error } = await staff.client.rpc("gateway_reconciliation", {
      p_hostel_id: hostelId,
      p_from: monthStart(-1),
      p_to: monthStart(1),
    });
    expect(error).toBeNull();
    const report = data as {
      totals: { captured: number; fees: number; settled: number; failed: number };
      payments: { receipt_number: string | null; resident_name: string }[];
      settlements: { utr: string }[];
    };
    expect(report.totals.captured).toBeGreaterThan(0);
    expect(report.totals.fees).toBeGreaterThan(0);
    expect(report.totals.settled).toBe(830000);
    expect(report.totals.failed).toBe(1);
    expect(report.settlements[0].utr).toBe("UTR0001");
    expect(report.payments.some((p) => p.receipt_number?.startsWith("RCT/"))).toBe(true);
  });

  it("refuses another hostel's reconciliation", async () => {
    const stranger = await createUser();
    const { error } = await stranger.client.rpc("gateway_reconciliation", {
      p_hostel_id: hostelId,
      p_from: monthStart(-1),
      p_to: monthStart(1),
    });
    expect(error?.code).toBe(PERMISSION_DENIED);
  });
});

describe("a suspended hostel", () => {
  it("keeps the gateway payment on record without recording money", async () => {
    const { invoiceId } = await invoice();
    const linkId = await link(invoiceId, 850000);
    await admin.from("hostels").update({ status: "suspended" }).eq("id", hostelId);
    try {
      const body = paid(linkId, 850000);
      expect((await event("link_paid", body)).data).toBe("unrecorded");
      const { data } = await admin
        .from("gateway_payments")
        .select("payment_id, note")
        .eq("gateway_payment_id", body.payment.id)
        .single();
      expect(data?.payment_id).toBeNull();
      expect(data?.note).toMatch(/^Not recorded: This hostel is suspended/);
    } finally {
      await admin.from("hostels").update({ status: "active" }).eq("id", hostelId);
    }
  });
});
