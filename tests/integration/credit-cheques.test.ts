import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { todayIst } from "@/lib/validation";

import { residentRow } from "../support/residents";
import { createUserFactory, type TestUser } from "../support/supabase";

/**
 * Deposit rates (ClickUp E13-T4), advances and credit (E13-T7), and cheques
 * with clearance (E13-T11).
 */
const PERMISSION_DENIED = "42501";

const { admin, createUser, createHostel, cleanup } = createUserFactory();

afterAll(cleanup);

let owner: TestUser;
let staff: TestUser;
let hostelId: string;
const today = todayIst();
const monthStart = `${today.slice(0, 7)}-01`;

beforeAll(async () => {
  owner = await createUser();
  hostelId = (await createHostel(owner.id)).id;
  staff = await createUser({ profile: { role: "staff", hostel_id: hostelId } });
});

async function resident() {
  const { data, error } = await admin
    .from("residents")
    .insert(residentRow(hostelId))
    .select("id")
    .single();
  if (error) throw error;
  return data.id;
}

async function invoice(residentId: string, amount = 500000, period = monthStart) {
  const { data, error } = await owner.client
    .from("invoices")
    .insert({
      hostel_id: hostelId,
      resident_id: residentId,
      period_month: period,
      amount,
      due_date: period,
    })
    .select("id")
    .single();
  if (error) throw error;
  return data.id;
}

async function balanceOf(invoiceId: string) {
  const { data } = await owner.client
    .from("invoice_balances")
    .select("paid, balance, pending_cheques")
    .eq("id", invoiceId)
    .single();
  return data;
}

async function held(residentId: string) {
  const { data } = await owner.client
    .from("credit_balances")
    .select("held")
    .eq("resident_id", residentId)
    .maybeSingle();
  return data?.held ?? 0;
}

const pay = (client: TestUser["client"], invoiceId: string, amount: number, extra: object = {}) =>
  client.rpc("record_payment", {
    p_invoice_id: invoiceId,
    p_amount: amount,
    p_paid_at: today,
    p_mode: "cash",
    ...extra,
  });

describe("deposit rates", () => {
  it("are set by owners and read by staff", async () => {
    const set = await owner.client
      .from("deposit_rates")
      .insert({ hostel_id: hostelId, sharing_type: "double", amount: 1000000 });
    expect(set.error).toBeNull();
    expect((await staff.client.from("deposit_rates").select("amount")).data).toEqual([
      { amount: 1000000 },
    ]);
    const byStaff = await staff.client
      .from("deposit_rates")
      .insert({ hostel_id: hostelId, sharing_type: "single", amount: 500000 });
    expect(byStaff.error?.code).toBe(PERMISSION_DENIED);
  });
});

describe("paying more than is due", () => {
  it("records the balance as a payment and the rest as advance credit", async () => {
    const residentId = await resident();
    const invoiceId = await invoice(residentId);
    const { data, error } = await pay(staff.client, invoiceId, 700000);
    expect(error).toBeNull();
    expect(data).toMatchObject({ paid: 500000, credit: 200000 });
    expect(await balanceOf(invoiceId)).toMatchObject({ paid: 500000, balance: 0 });
    expect(await held(residentId)).toBe(200000);
  });

  it("applies held credit to the next invoice as soon as it is issued", async () => {
    const residentId = await resident();
    const first = await invoice(residentId, 300000, "2026-01-01");
    await pay(owner.client, first, 800000);
    expect(await held(residentId)).toBe(500000);

    const second = await invoice(residentId, 400000, "2026-02-01");
    expect(await balanceOf(second)).toMatchObject({ paid: 400000, balance: 0 });
    expect(await held(residentId)).toBe(100000);

    // Voiding the credit payment gives the credit back.
    const { data: creditPayment } = await admin
      .from("payments")
      .select("id, mode, receipt_number")
      .eq("invoice_id", second)
      .single();
    expect(creditPayment?.mode).toBe("credit");
    await owner.client
      .from("payments")
      .update({ void_reason: "Wrong month" })
      .eq("id", creditPayment!.id);
    expect(await held(residentId)).toBe(500000);
  });

  it("never lets a cheque overpay", async () => {
    const residentId = await resident();
    const invoiceId = await invoice(residentId);
    const { error } = await pay(owner.client, invoiceId, 600000, {
      p_mode: "cheque",
      p_cheque_number: "000123",
      p_cheque_bank: "SBI",
    });
    expect(error?.hint).toBe("overpayment");
  });
});

describe("credit", () => {
  it("is refunded by owners only, never beyond what is held", async () => {
    const residentId = await resident();
    await owner.client.from("resident_credit_entries").insert({
      hostel_id: hostelId,
      resident_id: residentId,
      kind: "advance",
      amount: 300000,
      entry_date: today,
      mode: "upi",
    });
    const refund = (client: TestUser["client"], amount: number) =>
      client.from("resident_credit_entries").insert({
        hostel_id: hostelId,
        resident_id: residentId,
        kind: "refund",
        amount,
        entry_date: today,
        mode: "cash",
      });
    expect((await refund(staff.client, 100000)).error?.code).toBe(PERMISSION_DENIED);
    expect((await refund(owner.client, 400000)).error?.hint).toBe("credit_insufficient");
    expect((await refund(owner.client, 300000)).error).toBeNull();
    expect(await held(residentId)).toBe(0);
  });

  it("cannot be applied by hand, and a used advance cannot be voided", async () => {
    const residentId = await resident();
    const invoiceId = await invoice(residentId, 200000);
    const manual = await owner.client.from("payments").insert({
      hostel_id: hostelId,
      invoice_id: invoiceId,
      amount: 100,
      paid_at: today,
      mode: "credit",
    });
    expect(manual.error?.hint).toBe("credit_payment_manual");

    const { data: advance } = await owner.client
      .from("resident_credit_entries")
      .insert({
        hostel_id: hostelId,
        resident_id: residentId,
        kind: "advance",
        amount: 150000,
        entry_date: today,
        mode: "cash",
      })
      .select("id")
      .single();
    expect((await owner.client.rpc("apply_credit", { p_resident_id: residentId })).data).toBe(
      150000,
    );
    expect(await balanceOf(invoiceId)).toMatchObject({ paid: 150000, balance: 50000 });
    const voidUsed = await owner.client
      .from("resident_credit_entries")
      .update({ void_reason: "Mistake" })
      .eq("id", advance!.id);
    expect(voidUsed.error?.hint).toBe("credit_used");
  });

  it("must be refunded or used before a resident is erased", async () => {
    const { data } = await admin
      .from("residents")
      .insert(residentRow(hostelId, { status: "vacated" }))
      .select("id")
      .single();
    await owner.client.from("resident_credit_entries").insert({
      hostel_id: hostelId,
      resident_id: data!.id,
      kind: "advance",
      amount: 10000,
      entry_date: today,
      mode: "cash",
    });
    const { error } = await owner.client.rpc("erase_resident", {
      p_resident_id: data!.id,
      p_reason: "Asked",
    });
    expect(error?.hint).toBe("erase_credit_held");
  });
});

describe("cheques", () => {
  it("count as paid only once cleared, but stop anyone collecting twice", async () => {
    const residentId = await resident();
    const invoiceId = await invoice(residentId);
    const { data } = await pay(staff.client, invoiceId, 500000, {
      p_mode: "cheque",
      p_cheque_number: "445566",
      p_cheque_bank: "HDFC Bank",
    });
    expect(await balanceOf(invoiceId)).toEqual({
      paid: 0,
      balance: 500000,
      pending_cheques: 500000,
    });
    // Cash on top of the pending cheque would overpay.
    const again = await owner.client.from("payments").insert({
      hostel_id: hostelId,
      invoice_id: invoiceId,
      amount: 100000,
      paid_at: today,
      mode: "cash",
    });
    expect(again.error?.hint).toBe("overpayment");

    const { data: money } = await owner.client.rpc("dashboard_money", {
      p_hostel_id: hostelId,
      p_from: today,
      p_to: today,
    });
    const before = money?.[0]?.collected ?? 0;

    const cleared = await staff.client.rpc("clear_cheque", {
      p_payment_id: (data as { payment_id: string }).payment_id,
    });
    expect(cleared.error).toBeNull();
    expect(await balanceOf(invoiceId)).toEqual({ paid: 500000, balance: 0, pending_cheques: 0 });
    const { data: after } = await owner.client.rpc("dashboard_money", {
      p_hostel_id: hostelId,
      p_from: today,
      p_to: today,
    });
    expect(after?.[0]?.collected).toBe(before + 500000);
  });

  it("need a cheque number, and a bounced one is voided like any payment", async () => {
    const residentId = await resident();
    const invoiceId = await invoice(residentId);
    const noNumber = await pay(owner.client, invoiceId, 100000, { p_mode: "cheque" });
    expect(noNumber.error?.code).toBe("23514");

    const { data } = await pay(owner.client, invoiceId, 100000, {
      p_mode: "cheque",
      p_cheque_number: "777",
      p_cheque_bank: "Axis",
    });
    const bounced = await owner.client
      .from("payments")
      .update({ void_reason: "Bounced: insufficient funds" })
      .eq("id", (data as { payment_id: string }).payment_id);
    expect(bounced.error).toBeNull();
    expect(await balanceOf(invoiceId)).toMatchObject({ balance: 500000, pending_cheques: 0 });
    // Cash cannot be "cleared".
    const { data: cash } = await pay(owner.client, invoiceId, 100000);
    const clearCash = await owner.client.rpc("clear_cheque", {
      p_payment_id: (cash as { payment_id: string }).payment_id,
    });
    expect(clearCash.error?.hint).toBe("payment_immutable");
  });
});
