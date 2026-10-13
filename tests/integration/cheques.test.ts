import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { todayIst } from "@/lib/validation";

import { daysFromToday, feeFixtures } from "../support/fees";
import { createUserFactory, type TestUser } from "../support/supabase";

/**
 * Cheque payments with clearance status (E13-T11): a cheque holds its part
 * of an invoice while it clears, pays it once cleared, and undoes nothing
 * but itself when it bounces.
 */
const PERMISSION_DENIED = "42501";
const { admin, createUser, createHostel, cleanup } = createUserFactory();
afterAll(cleanup);

let owner: TestUser;
let staff: TestUser;
let staffHostelId: string;
const { resident } = feeFixtures(admin, () => owner);

beforeAll(async () => {
  owner = await createUser();
  staffHostelId = (await createHostel(owner.id)).id;
  staff = await createUser({ profile: { role: "staff", hostel_id: staffHostelId } });
});

async function invoice(hostelId: string, amount: number, dueDaysAgo = 1) {
  const residentId = await resident(hostelId);
  const due = daysFromToday(-dueDaysAgo);
  const { data, error } = await admin
    .from("invoices")
    .insert({
      hostel_id: hostelId,
      resident_id: residentId,
      period_month: `${due.slice(0, 8)}01`,
      amount,
      due_date: due,
    })
    .select("id")
    .single();
  if (error) throw error;
  return { residentId, invoiceId: data.id };
}

async function balanceOf(invoiceId: string) {
  const { data } = await admin
    .from("invoice_balances")
    .select("balance, paid, pending_cheques, due_status")
    .eq("id", invoiceId)
    .single();
  return data!;
}

function recordCheque(user: TestUser, invoiceId: string, amount: number, paidAt = todayIst()) {
  return user.client.rpc("record_cheque", {
    p_invoice_id: invoiceId,
    p_amount: amount,
    p_paid_at: paidAt,
    p_cheque_number: "004512",
    p_bank: "State Bank of India",
  });
}

function clear(user: TestUser, paymentId: string, on = todayIst()) {
  return user.client.from("payments").update({ cleared_on: on }).eq("id", paymentId).select("id");
}

async function collected(hostelId: string) {
  const { data } = await owner.client.rpc("dashboard_money", {
    p_hostel_id: hostelId,
    p_from: daysFromToday(-30),
    p_to: todayIst(),
  });
  return data![0].collected;
}

describe("cheques", () => {
  it("do not reduce the balance or count as collected until cleared", async () => {
    const hostelId = (await createHostel(owner.id)).id;
    const { invoiceId } = await invoice(hostelId, 500000);

    // Staff work in their own hostel only.
    const elsewhere = await recordCheque(staff, invoiceId, 300000);
    expect(elsewhere.error?.hint).toBe("invoice_not_found");

    const recorded = await recordCheque(owner, invoiceId, 300000);
    expect(recorded.error).toBeNull();
    const { data: row } = await admin
      .from("payments")
      .select("mode, reference, cheque_bank, cleared_on, number")
      .eq("id", recorded.data!)
      .single();
    expect(row).toMatchObject({
      mode: "cheque",
      reference: "004512",
      cheque_bank: "State Bank of India",
      cleared_on: null,
    });
    expect(row!.number).toMatch(/^RCT\//);

    expect(await balanceOf(invoiceId)).toMatchObject({
      balance: 500000,
      paid: 0,
      pending_cheques: 300000,
      due_status: "overdue",
    });
    expect(await collected(hostelId)).toBe(0);

    const cleared = await clear(owner, recorded.data!);
    expect(cleared.error).toBeNull();
    expect(await balanceOf(invoiceId)).toMatchObject({
      balance: 200000,
      paid: 300000,
      pending_cheques: 0,
    });
    expect(await collected(hostelId)).toBe(300000);
  });

  it("hold their share of the invoice while pending, so nothing pays it twice", async () => {
    const hostelId = (await createHostel(owner.id)).id;
    const { residentId, invoiceId } = await invoice(hostelId, 500000);
    expect((await recordCheque(owner, invoiceId, 400000)).error).toBeNull();

    const tooMuchCheque = await recordCheque(owner, invoiceId, 200000);
    expect(tooMuchCheque.error?.hint).toBe("overpayment");

    // A cash payment pays only the 1000 not held, and the rest becomes credit.
    const cash = await owner.client.rpc("record_payment", {
      p_invoice_id: invoiceId,
      p_amount: 300000,
      p_paid_at: todayIst(),
      p_mode: "cash",
    });
    expect(cash.error).toBeNull();
    expect(cash.data).toMatchObject({ to_invoice: 100000, extra: 200000 });
    const { data: creditRow } = await admin
      .from("resident_credit_balances")
      .select("balance")
      .eq("resident_id", residentId)
      .single();
    expect(creditRow!.balance).toBe(200000);
    expect(await balanceOf(invoiceId)).toMatchObject({ balance: 400000, pending_cheques: 400000 });
  });

  it("clear once, on a date between receipt and today, by owners only", async () => {
    const { invoiceId } = await invoice(staffHostelId, 500000);
    const { data: chequeId } = await recordCheque(staff, invoiceId, 100000, daysFromToday(-3));

    const byStaff = await clear(staff, chequeId!);
    expect(byStaff.data).toEqual([]);

    expect((await clear(owner, chequeId!, daysFromToday(-5))).error?.hint).toBe(
      "cheque_cleared_date",
    );
    expect((await clear(owner, chequeId!, daysFromToday(1))).error?.hint).toBe(
      "cheque_cleared_date",
    );
    expect((await clear(owner, chequeId!, daysFromToday(-1))).error).toBeNull();
    expect((await clear(owner, chequeId!)).error?.hint).toBe("cheque_not_pending");

    const bounceCleared = await owner.client.rpc("bounce_cheque", {
      p_payment_id: chequeId!,
      p_reason: "Returned",
    });
    expect(bounceCleared.error?.hint).toBe("cheque_not_pending");
  });

  it("bounce: voided with the reason, the balance is back, and a bounce charge is added", async () => {
    const hostelId = (await createHostel(owner.id)).id;
    const { residentId, invoiceId } = await invoice(hostelId, 500000);
    const { data: chequeId } = await recordCheque(owner, invoiceId, 500000);

    const byStaffHostelOwnerOnly = await staff.client.rpc("bounce_cheque", {
      p_payment_id: chequeId!,
      p_reason: "Insufficient funds",
    });
    expect(byStaffHostelOwnerOnly.error?.code).toBe(PERMISSION_DENIED);
    expect(
      (await owner.client.rpc("bounce_cheque", { p_payment_id: chequeId!, p_reason: " " })).error
        ?.hint,
    ).toBe("reason_required");

    const bounced = await owner.client.rpc("bounce_cheque", {
      p_payment_id: chequeId!,
      p_reason: "Insufficient funds",
      p_charge: 50000,
    });
    expect(bounced.error).toBeNull();

    const { data: row } = await admin
      .from("payments")
      .select("bounced, void_reason, voided_at")
      .eq("id", chequeId!)
      .single();
    expect(row).toMatchObject({ bounced: true, void_reason: "Insufficient funds" });
    expect(row!.voided_at).not.toBeNull();
    expect(await balanceOf(invoiceId)).toMatchObject({ balance: 500000, pending_cheques: 0 });

    const { data: charges } = await admin
      .from("resident_charges")
      .select("id, amount, status, description")
      .eq("resident_id", residentId);
    expect(charges).toEqual([
      expect.objectContaining({
        id: bounced.data,
        amount: 50000,
        status: "pending",
        description: "Cheque bounce charge (cheque 004512)",
      }),
    ]);
  });

  it("cannot bounce a payment that is not a cheque", async () => {
    const hostelId = (await createHostel(owner.id)).id;
    const { invoiceId } = await invoice(hostelId, 500000);
    const { data } = await owner.client.rpc("record_payment", {
      p_invoice_id: invoiceId,
      p_amount: 100000,
      p_paid_at: todayIst(),
      p_mode: "upi",
      p_reference: "UTR9",
    });
    const paymentId = (data as { payment_id: string }).payment_id;
    const bounced = await owner.client.rpc("bounce_cheque", {
      p_payment_id: paymentId,
      p_reason: "No",
    });
    expect(bounced.error?.hint).toBe("cheque_not_pending");
    expect((await clear(owner, paymentId)).error?.hint).toBe("payment_immutable");
  });

  it("need a number and a bank, and go through record_cheque", async () => {
    const hostelId = (await createHostel(owner.id)).id;
    const { invoiceId } = await invoice(hostelId, 500000);
    const noBank = await owner.client.rpc("record_cheque", {
      p_invoice_id: invoiceId,
      p_amount: 1000,
      p_paid_at: todayIst(),
      p_cheque_number: "1",
      p_bank: "",
    });
    expect(noBank.error?.hint).toBe("cheque_details");
    const viaPayment = await owner.client.rpc("record_payment", {
      p_invoice_id: invoiceId,
      p_amount: 1000,
      p_paid_at: todayIst(),
      p_mode: "cheque",
      p_reference: "1",
    });
    expect(viaPayment.error?.hint).toBe("cheque_details");
    const direct = await owner.client.from("payments").insert({
      hostel_id: hostelId,
      invoice_id: invoiceId,
      amount: 1000,
      paid_at: todayIst(),
      mode: "cheque",
      reference: "1",
    });
    expect(direct.error).not.toBeNull();
  });

  it("are listed while pending, and keep late fees and settlement waiting", async () => {
    const hostelId = (await createHostel(owner.id)).id;
    const { residentId, invoiceId } = await invoice(hostelId, 500000, 10);
    const { data: chequeId } = await recordCheque(owner, invoiceId, 500000);

    const { data: listed } = await owner.client
      .from("pending_cheques")
      .select("id, cheque_number, cheque_bank, resident_name")
      .eq("hostel_id", hostelId);
    expect(listed).toEqual([expect.objectContaining({ id: chequeId, cheque_number: "004512" })]);

    await owner.client
      .from("late_fee_rules")
      .insert({ hostel_id: hostelId, grace_days: 1, kind: "fixed", amount: 20000 });
    expect((await owner.client.rpc("apply_late_fees", { p_hostel_id: hostelId })).data).toBe(0);

    const settle = await owner.client.rpc("settle_resident", { p_resident_id: residentId });
    expect(settle.error?.hint).toBe("settle_cheque_pending");

    await owner.client.rpc("bounce_cheque", { p_payment_id: chequeId!, p_reason: "Returned" });
    expect((await owner.client.rpc("apply_late_fees", { p_hostel_id: hostelId })).data).toBe(1);
    const { data: after } = await owner.client
      .from("pending_cheques")
      .select("id")
      .eq("hostel_id", hostelId);
    expect(after).toEqual([]);
  });
});
