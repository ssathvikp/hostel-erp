import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { shiftMonth } from "@/lib/money";
import { todayIst } from "@/lib/validation";

import { residentRow } from "../support/residents";
import { createUserFactory, type TestUser } from "../support/supabase";

/** Move-out settlement (ClickUp E13-T8). */
const { admin, createUser, createHostel, cleanup } = createUserFactory();

afterAll(cleanup);

let owner: TestUser;
let staff: TestUser;
let hostelId: string;
const today = todayIst();
const lastMonth = shiftMonth(today, -1);

beforeAll(async () => {
  owner = await createUser();
  hostelId = (await createHostel(owner.id)).id;
  staff = await createUser({ profile: { role: "staff", hostel_id: hostelId } });
  await admin.from("fee_structures").insert({
    hostel_id: hostelId,
    sharing_type: "single",
    monthly_amount: 900000,
    effective_from: "2020-01-01",
  });
});

let roomCount = 0;

/** A resident in their own single room, open-ended from 2020, optionally vacated. */
async function stay({ vacateOn }: { vacateOn?: string } = {}) {
  roomCount += 1;
  const { data: room } = await admin
    .from("rooms")
    .insert({
      hostel_id: hostelId,
      room_number: `S${roomCount}`,
      floor: 1,
      sharing_type: "single",
      capacity: 1,
    })
    .select("id")
    .single();
  const { data: bed } = await admin.from("beds").select("id").eq("room_id", room!.id).single();
  const { data: resident } = await admin
    .from("residents")
    .insert(residentRow(hostelId))
    .select("id")
    .single();
  const { data: allocation, error } = await admin
    .from("allocations")
    .insert({
      hostel_id: hostelId,
      resident_id: resident!.id,
      room_id: room!.id,
      bed_id: bed!.id,
      start_date: "2020-01-01",
      created_by: owner.id,
    })
    .select("id")
    .single();
  if (error) throw error;
  const vacate = async (on: string) => {
    const { error: vacateError } = await owner.client.rpc("vacate_allocation", {
      p_allocation_id: allocation!.id,
      p_move_out_date: on,
      p_reason: "moved_out",
      p_mark_vacated: true,
    });
    if (vacateError) throw vacateError;
  };
  if (vacateOn) await vacate(vacateOn);
  return { residentId: resident!.id, allocationId: allocation!.id, vacate };
}

async function invoice(residentId: string, amount: number, period = "2026-01-01") {
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

async function deposit(residentId: string, amount: number) {
  const { error } = await owner.client.from("deposit_entries").insert({
    hostel_id: hostelId,
    resident_id: residentId,
    kind: "collected",
    amount,
    entry_date: "2020-01-01",
    mode: "cash",
  });
  if (error) throw error;
}

async function depositHeld(residentId: string) {
  const { data } = await owner.client
    .from("deposit_balances")
    .select("held")
    .eq("resident_id", residentId)
    .maybeSingle();
  return data?.held ?? 0;
}

describe("settling a move-out", () => {
  it("takes deductions from the deposit and refunds the rest", async () => {
    const { residentId, allocationId } = await stay({ vacateOn: today });
    await deposit(residentId, 1000000);
    const { data: id, error } = await owner.client.rpc("settle_move_out", {
      p_allocation_id: allocationId,
      p_deductions: [{ amount: 200000, reason: "Broken chair" }],
      p_refund_mode: "upi",
      p_refund_reference: "UPI 123",
    });
    expect(error).toBeNull();
    const { data: settlement } = await owner.client
      .from("settlements")
      .select("net_amount, statement")
      .eq("id", id!)
      .single();
    expect(settlement?.net_amount).toBe(-800000);
    expect(settlement?.statement).toMatchObject({ deducted: 200000, deposit_refund: 800000 });
    expect(await depositHeld(residentId)).toBe(0);
  });

  it("lets the deposit pay dues, leaving what is still owed", async () => {
    const { residentId, allocationId } = await stay({ vacateOn: today });
    await deposit(residentId, 300000);
    const invoiceId = await invoice(residentId, 500000);
    const { data: id, error } = await owner.client.rpc("settle_move_out", {
      p_allocation_id: allocationId,
    });
    expect(error).toBeNull();
    const { data: settlement } = await owner.client
      .from("settlements")
      .select("net_amount")
      .eq("id", id!)
      .single();
    expect(settlement?.net_amount).toBe(200000);

    const { data: payment } = await owner.client
      .from("payments")
      .select("id, mode, amount")
      .eq("invoice_id", invoiceId)
      .single();
    expect(payment).toMatchObject({ mode: "deposit", amount: 300000 });
    // Voiding that payment gives the deposit back.
    const voided = await owner.client
      .from("payments")
      .update({ void_reason: "Mistake" })
      .eq("id", payment!.id);
    expect(voided.error).toBeNull();
    expect(await depositHeld(residentId)).toBe(300000);
  });

  it("uses advance credit first, and refunds credit left over", async () => {
    const { residentId, allocationId } = await stay({ vacateOn: today });
    await owner.client.from("resident_credit_entries").insert({
      hostel_id: hostelId,
      resident_id: residentId,
      kind: "advance",
      amount: 400000,
      entry_date: today,
      mode: "cash",
    });
    await invoice(residentId, 100000);
    const { data: id, error } = await owner.client.rpc("settle_move_out", {
      p_allocation_id: allocationId,
      p_refund_mode: "cash",
    });
    expect(error).toBeNull();
    const { data } = await owner.client
      .from("settlements")
      .select("net_amount, statement")
      .eq("id", id!)
      .single();
    expect(data?.statement).toMatchObject({ credit_refund: 300000, still_owed: 0 });
    expect(data?.net_amount).toBe(-300000);
  });

  it("re-bills the final month for the nights held", async () => {
    const { residentId, allocationId, vacate } = await stay();
    const { error: generateError } = await owner.client.rpc("generate_invoices", {
      p_hostel_id: hostelId,
      p_period_month: lastMonth,
      p_due_day: 5,
    });
    expect(generateError).toBeNull();
    const moveOut = `${lastMonth.slice(0, 7)}-11`;
    await vacate(moveOut);

    const { data: preview } = await owner.client.rpc("settlement_preview", {
      p_allocation_id: allocationId,
    });
    const days = new Date(Date.UTC(+lastMonth.slice(0, 4), +lastMonth.slice(5, 7), 0)).getUTCDate();
    const expected = Math.round((900000 * 10) / days / 100) * 100;
    expect(preview).toMatchObject({
      final_month: { billed_rent: 900000, rent_for_nights: expected, nights: 10, can_rebill: true },
    });

    const { error } = await owner.client.rpc("settle_move_out", {
      p_allocation_id: allocationId,
      p_use_deposit: false,
    });
    expect(error).toBeNull();
    const { data: invoices } = await owner.client
      .from("invoices")
      .select("amount, status")
      .eq("resident_id", residentId)
      .eq("period_month", lastMonth)
      .order("created_at");
    expect(invoices).toEqual([
      { amount: 900000, status: "void" },
      { amount: expected, status: "issued" },
    ]);
  });
});

describe("settlement rules", () => {
  it("needs a closed stay, an owner, a refund mode, and happens once", async () => {
    const open = await stay();
    expect(
      (await owner.client.rpc("settle_move_out", { p_allocation_id: open.allocationId })).error
        ?.hint,
    ).toBe("allocation_open");

    const { residentId, allocationId } = await stay({ vacateOn: today });
    await deposit(residentId, 100000);
    expect(
      (await staff.client.rpc("settle_move_out", { p_allocation_id: allocationId })).error?.code,
    ).toBe("42501");
    expect(
      (await owner.client.rpc("settle_move_out", { p_allocation_id: allocationId })).error?.hint,
    ).toBe("refund_mode");
    expect(
      (
        await owner.client.rpc("settle_move_out", {
          p_allocation_id: allocationId,
          p_refund_mode: "cash",
        })
      ).error,
    ).toBeNull();
    expect(
      (
        await owner.client.rpc("settle_move_out", {
          p_allocation_id: allocationId,
          p_refund_mode: "cash",
        })
      ).error?.hint,
    ).toBe("already_settled");
  });

  it("never takes deposit payments by hand", async () => {
    const { residentId } = await stay();
    const invoiceId = await invoice(residentId, 100000);
    const { error } = await owner.client.from("payments").insert({
      hostel_id: hostelId,
      invoice_id: invoiceId,
      amount: 100000,
      paid_at: today,
      mode: "deposit",
    });
    expect(error?.hint).toBe("deposit_payment_manual");
  });
});
