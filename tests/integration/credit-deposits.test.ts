import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { todayIst } from "@/lib/validation";

import { daysFromToday, dayOf, daysIn, feeFixtures, monthStart, prorate } from "../support/fees";
import { createUserFactory, type TestUser } from "../support/supabase";

/**
 * Resident credit, security deposits and move-out settlement (E13-T7,
 * E13-T4, E13-T8), through the same functions the app calls.
 */
const PERMISSION_DENIED = "42501";
const { admin, createUser, createHostel, cleanup } = createUserFactory();
afterAll(cleanup);

let owner: TestUser;
let staff: TestUser;
let staffHostelId: string;
const { resident, bed, stay, setRate, generate, invoiceFor } = feeFixtures(admin, () => owner);

beforeAll(async () => {
  owner = await createUser();
  staffHostelId = (await createHostel(owner.id)).id;
  staff = await createUser({ profile: { role: "staff", hostel_id: staffHostelId } });
});

async function hostel() {
  return (await createHostel(owner.id)).id;
}

/** An issued invoice written directly, due `dueDaysAgo` days ago. */
async function invoice(hostelId: string, residentId: string, amount: number, dueDaysAgo = 1) {
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
  return data.id;
}

async function balanceOf(invoiceId: string) {
  const { data } = await admin
    .from("invoice_balances")
    .select("balance, paid")
    .eq("id", invoiceId)
    .single();
  return data!;
}

async function credit(residentId: string) {
  const { data } = await admin
    .from("resident_credit_balances")
    .select("balance")
    .eq("resident_id", residentId)
    .maybeSingle();
  return data?.balance ?? 0;
}

async function deposit(residentId: string) {
  const { data } = await admin
    .from("resident_deposits")
    .select("due, received, deducted, applied, refunded, held, outstanding")
    .eq("resident_id", residentId)
    .maybeSingle();
  return data;
}

function recordPayment(user: TestUser, invoiceId: string, amount: number) {
  return user.client.rpc("record_payment", {
    p_invoice_id: invoiceId,
    p_amount: amount,
    p_paid_at: todayIst(),
    p_mode: "upi",
    p_reference: "UTR1",
  });
}

describe("credit", () => {
  it("takes money beyond an invoice to the next open invoice, then keeps it", async () => {
    const hostelId = await hostel();
    const residentId = await resident(hostelId);
    const older = await invoice(hostelId, residentId, 300000, 40);
    const newer = await invoice(hostelId, residentId, 500000, 5);

    const { data, error } = await recordPayment(owner, newer, 1000000);
    expect(error).toBeNull();
    expect(data).toMatchObject({ to_invoice: 500000, extra: 500000 });
    expect(await balanceOf(newer)).toMatchObject({ balance: 0 });
    expect(await balanceOf(older)).toMatchObject({ balance: 0 });
    expect(await credit(residentId)).toBe(200000);

    const { data: entries } = await admin
      .from("resident_credit")
      .select("kind, amount, number")
      .eq("resident_id", residentId)
      .order("created_at");
    expect(entries![0]).toMatchObject({ kind: "received", amount: 500000 });
    expect(entries![0].number).toMatch(/^RCT\//);
    expect(entries![1]).toMatchObject({ kind: "applied", amount: 300000, number: null });
    const { data: fromCredit } = await admin
      .from("payments")
      .select("mode, number")
      .eq("invoice_id", older)
      .single();
    expect(fromCredit).toEqual({ mode: "credit", number: null });
  });

  it("is used up by the next invoice issued", async () => {
    const hostelId = await hostel();
    const month = monthStart(-1);
    await setRate(hostelId, "single", 1000000, monthStart(-12));
    const residentId = await resident(hostelId);
    await stay(hostelId, residentId, await bed(hostelId), monthStart(-2));
    const advance = await owner.client.rpc("record_advance", {
      p_resident_id: residentId,
      p_amount: 400000,
      p_paid_at: todayIst(),
      p_mode: "cash",
    });
    expect(advance.error).toBeNull();
    expect(await credit(residentId)).toBe(400000);

    await generate(hostelId, month);
    const issued = await invoiceFor(residentId, month);
    expect(await balanceOf(issued!.id)).toMatchObject({ paid: 400000, balance: 600000 });
    expect(await credit(residentId)).toBe(0);
  });

  it("is refunded by owners only, never beyond what is held", async () => {
    const residentId = await resident(staffHostelId);
    await staff.client.rpc("record_advance", {
      p_resident_id: residentId,
      p_amount: 100000,
      p_paid_at: todayIst(),
      p_mode: "cash",
    });
    const byStaff = await staff.client.rpc("refund_credit", {
      p_resident_id: residentId,
      p_amount: 100000,
      p_mode: "cash",
    });
    expect(byStaff.error?.code).toBe(PERMISSION_DENIED);
    const tooMuch = await owner.client.rpc("refund_credit", {
      p_resident_id: residentId,
      p_amount: 100001,
      p_mode: "cash",
    });
    expect(tooMuch.error?.hint).toBe("balance_too_low");
    expect(
      (
        await owner.client.rpc("refund_credit", {
          p_resident_id: residentId,
          p_amount: 100000,
          p_mode: "upi",
          p_reference: "UTR9",
        })
      ).error,
    ).toBeNull();
    expect(await credit(residentId)).toBe(0);
  });

  it("cannot be spent by writing a credit payment directly", async () => {
    const hostelId = await hostel();
    const residentId = await resident(hostelId);
    const invoiceId = await invoice(hostelId, residentId, 100000);
    const { error } = await owner.client.from("payments").insert({
      hostel_id: hostelId,
      invoice_id: invoiceId,
      amount: 100000,
      paid_at: todayIst(),
      mode: "credit",
    });
    expect(error?.hint).toBe("payment_mode_internal");
  });

  it("counts money once on the dashboard, when it arrives", async () => {
    const hostelId = await hostel();
    const residentId = await resident(hostelId);
    const invoiceId = await invoice(hostelId, residentId, 300000);
    await recordPayment(owner, invoiceId, 500000);
    await invoice(hostelId, residentId, 100000, 40);
    const { data } = await owner.client.rpc("dashboard_money", {
      p_hostel_id: hostelId,
      p_from: todayIst(),
      p_to: todayIst(),
    });
    // 3,000 paid the first invoice, 2,000 arrived as credit; 1,000 of it
    // then paid the second invoice, which is not new money.
    expect(data![0]).toMatchObject({ collected: 500000, payments: 2 });
  });
});

describe("deposits", () => {
  it("are asked for on a resident's first stay, at the amount for the room", async () => {
    const hostelId = await hostel();
    await owner.client
      .from("deposit_amounts")
      .insert({ hostel_id: hostelId, sharing_type: "double", amount: 1500000 });
    const residentId = await resident(hostelId);
    await stay(hostelId, residentId, await bed(hostelId, "double"), monthStart(-2), {
      end: dayOf(monthStart(-2), 10),
    });
    await stay(hostelId, residentId, await bed(hostelId, "double"), dayOf(monthStart(-1), 1));
    expect(await deposit(residentId)).toMatchObject({
      due: 1500000,
      held: 0,
      outstanding: 1500000,
    });
  });

  it("are received by any member, kept or refunded only by owners, never below zero", async () => {
    const residentId = await resident(staffHostelId);
    const received = await staff.client.rpc("record_deposit", {
      p_resident_id: residentId,
      p_amount: 1000000,
      p_paid_at: todayIst(),
      p_mode: "bank_transfer",
      p_reference: "NEFT1",
    });
    expect(received.error).toBeNull();
    const { data: entry } = await admin
      .from("deposit_ledger")
      .select("number")
      .eq("id", received.data!)
      .single();
    expect(entry!.number).toMatch(/^RCT\//);

    const byStaff = await staff.client.rpc("deduct_deposit", {
      p_resident_id: residentId,
      p_amount: 100000,
      p_reason: "Broken chair",
    });
    expect(byStaff.error?.code).toBe(PERMISSION_DENIED);
    const noReason = await owner.client.rpc("deduct_deposit", {
      p_resident_id: residentId,
      p_amount: 100000,
      p_reason: " ",
    });
    expect(noReason.error?.hint).toBe("reason_required");
    await owner.client.rpc("deduct_deposit", {
      p_resident_id: residentId,
      p_amount: 100000,
      p_reason: "Broken chair",
    });
    const tooMuch = await owner.client.rpc("refund_deposit", {
      p_resident_id: residentId,
      p_amount: 900001,
      p_mode: "cash",
    });
    expect(tooMuch.error?.hint).toBe("balance_too_low");
    await owner.client.rpc("refund_deposit", {
      p_resident_id: residentId,
      p_amount: 900000,
      p_mode: "cash",
    });
    expect(await deposit(residentId)).toMatchObject({
      received: 1000000,
      deducted: 100000,
      refunded: 900000,
      held: 0,
    });
  });

  it("are held, not collected, on the dashboard", async () => {
    const hostelId = await hostel();
    const residentId = await resident(hostelId);
    await owner.client.rpc("record_deposit", {
      p_resident_id: residentId,
      p_amount: 700000,
      p_paid_at: todayIst(),
      p_mode: "cash",
    });
    const { data } = await owner.client.rpc("dashboard_money", {
      p_hostel_id: hostelId,
      p_from: todayIst(),
      p_to: todayIst(),
    });
    expect(data![0]).toMatchObject({ collected: 0, deposits_held: 700000 });
  });
});

describe("settlement", () => {
  it("credits unused nights, pays dues from credit and deposit, and refunds the rest", async () => {
    const hostelId = await hostel();
    const month = monthStart(-1);
    const days = daysIn(month);
    await setRate(hostelId, "single", 1000000, monthStart(-12));
    const residentId = await resident(hostelId);
    const allocationId = await stay(hostelId, residentId, await bed(hostelId), monthStart(-3));
    await owner.client.rpc("record_deposit", {
      p_resident_id: residentId,
      p_amount: 2000000,
      p_paid_at: todayIst(),
      p_mode: "cash",
    });
    // Billed the whole of last month in advance...
    await generate(hostelId, month);
    // ...but left after the 10th night, and owes a 500 key charge.
    await admin
      .from("allocations")
      .update({ end_date: dayOf(month, 10), vacate_reason: "moved_out" })
      .eq("id", allocationId);
    await owner.client.from("resident_charges").insert({
      hostel_id: hostelId,
      resident_id: residentId,
      description: "Key",
      amount: 50000,
      charge_date: dayOf(month, 10),
    });

    const stayed = prorate(1000000 * 10, days);
    const { data: preview } = await owner.client.rpc("settlement_preview", {
      p_resident_id: residentId,
    });
    expect(preview).toMatchObject({
      unused_credit: 1000000 - stayed,
      pending_charges: 50000,
      dues: 1000000,
      deposit_held: 2000000,
      net: 2000000 + (1000000 - stayed) - 1000000 - 50000,
    });

    const { data: settled, error } = await owner.client.rpc("settle_resident", {
      p_resident_id: residentId,
      p_deductions: [{ amount: 20000, reason: "Cleaning" }],
      p_use_deposit: true,
      p_refund_mode: "upi",
      p_refund_reference: "UTR-REFUND",
    });
    expect(error).toBeNull();
    expect(settled).toMatchObject({
      dues: 0,
      pending_charges: 0,
      credit: 0,
      deposit_held: 0,
      net: 0,
    });
    expect(await deposit(residentId)).toMatchObject({
      received: 2000000,
      deducted: 20000,
      applied: stayed + 50000,
      refunded: 2000000 - 20000 - stayed - 50000,
    });
  });

  it("waits until the resident has left their bed, and is for owners only", async () => {
    const hostelId = await hostel();
    const residentId = await resident(hostelId);
    await stay(hostelId, residentId, await bed(hostelId), monthStart(-1));
    const early = await owner.client.rpc("settle_resident", { p_resident_id: residentId });
    expect(early.error?.hint).toBe("settle_has_bed");

    const staffResident = await resident(staffHostelId);
    const byStaff = await staff.client.rpc("settle_resident", { p_resident_id: staffResident });
    expect(byStaff.error?.code).toBe(PERMISSION_DENIED);
  });
});
