import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { shiftMonth } from "@/lib/money";
import { todayIst } from "@/lib/validation";

import { residentRow } from "../support/residents";
import { createUserFactory, type TestUser } from "../support/supabase";

/**
 * Itemised fees (ClickUp E13-T1 to E13-T3, E13-T5): fee heads, invoice
 * lines, charges, admission fees, discounts and metered electricity.
 */
const PERMISSION_DENIED = "42501";

const { admin, createUser, createHostel, cleanup } = createUserFactory();

afterAll(cleanup);

let owner: TestUser;

beforeAll(async () => {
  owner = await createUser();
});

// Last month: always billable, every day of it in the past.
const lastMonth = shiftMonth(todayIst(), -1);
const lastMonthEnd = (() => {
  const [y, m] = lastMonth.split("-").map(Number);
  return new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
})();
const daysInLastMonth = Number(lastMonthEnd.slice(8));

interface Setup {
  hostelId: string;
  roomId: string;
  bedIds: string[];
}

/** A hostel with one double room priced at ₹6,000. */
async function hostel(): Promise<Setup> {
  const hostelId = (await createHostel(owner.id)).id;
  const { data: room, error } = await admin
    .from("rooms")
    .insert({
      hostel_id: hostelId,
      room_number: "101",
      floor: 1,
      sharing_type: "double",
      capacity: 2,
    })
    .select("id")
    .single();
  if (error) throw error;
  const { data: beds } = await admin
    .from("beds")
    .select("id")
    .eq("room_id", room.id)
    .order("bed_label");
  await admin.from("fee_structures").insert({
    hostel_id: hostelId,
    sharing_type: "double",
    monthly_amount: 600000,
    effective_from: "2020-01-01",
  });
  return { hostelId, roomId: room.id, bedIds: beds!.map((bed) => bed.id) };
}

async function residentIn(setup: Setup, bed = 0, start = "2026-01-01", end: string | null = null) {
  const { data: resident, error } = await admin
    .from("residents")
    .insert(residentRow(setup.hostelId))
    .select("id")
    .single();
  if (error) throw error;
  const { data: stay, error: stayError } = await admin
    .from("allocations")
    .insert({
      hostel_id: setup.hostelId,
      resident_id: resident.id,
      room_id: setup.roomId,
      bed_id: setup.bedIds[bed],
      start_date: start,
      end_date: end,
      vacate_reason: end ? "moved_out" : null,
      created_by: owner.id,
    })
    .select("id")
    .single();
  if (stayError) throw stayError;
  return { residentId: resident.id, allocationId: stay.id };
}

async function head(
  hostelId: string,
  name: string,
  kind: "monthly" | "one_time",
  firstStay = false,
) {
  const { data, error } = await owner.client
    .from("fee_heads")
    .insert({ hostel_id: hostelId, name, kind, on_first_allocation: firstStay })
    .select("id")
    .single();
  if (error) throw error;
  return data.id;
}

async function price(headId: string, amount: number, sharingType: string | null = null) {
  const { error } = await owner.client.rpc("set_fee_head_price", {
    p_head_id: headId,
    p_sharing_type: sharingType ?? undefined,
    p_amount: amount,
    p_effective_from: "2020-01-01",
  });
  if (error) throw error;
}

async function generate(hostelId: string) {
  const { data, error } = await owner.client.rpc("generate_invoices", {
    p_hostel_id: hostelId,
    p_period_month: lastMonth,
  });
  if (error) throw error;
  return data as Record<string, unknown>;
}

async function invoiceOf(residentId: string) {
  const { data } = await admin
    .from("invoices")
    .select("id, amount, kind, invoice_lines(kind, description, amount, position)")
    .eq("resident_id", residentId)
    .eq("status", "issued")
    .order("created_at");
  return (data ?? []).map((invoice) => ({
    ...invoice,
    invoice_lines: [...invoice.invoice_lines].sort((a, b) => a.position - b.position),
  }));
}

describe("fee heads", () => {
  it("bill a monthly head per sharing type alongside rent, as one itemised invoice", async () => {
    const setup = await hostel();
    const mess = await head(setup.hostelId, "Mess", "monthly");
    await price(mess, 300000, "double");
    const cleaning = await head(setup.hostelId, "Cleaning", "monthly");
    await price(cleaning, 50000);
    const { residentId } = await residentIn(setup);

    const summary = await generate(setup.hostelId);
    expect(summary).toMatchObject({ created: 1, total_amount: 950000, extras_amount: 350000 });
    const [invoice] = await invoiceOf(residentId);
    expect(invoice.amount).toBe(950000);
    expect(invoice.invoice_lines.map((line) => [line.kind, line.description, line.amount])).toEqual(
      [
        ["rent", expect.stringMatching(/^Rent for /), 600000],
        ["fee_head", "Mess", 300000],
        ["fee_head", "Cleaning", 50000],
      ],
    );
  });

  it("prorate a head by nights like rent, and skip stays that opted out", async () => {
    const setup = await hostel();
    const mess = await head(setup.hostelId, "Mess", "monthly");
    await price(mess, 310000);
    // Moved in on the 11th of last month.
    const part = await residentIn(setup, 0, `${lastMonth.slice(0, 8)}11`);
    const optedOut = await residentIn(setup, 1);
    await owner.client
      .from("allocation_fee_opt_outs")
      .insert({ hostel_id: setup.hostelId, allocation_id: optedOut.allocationId, head_id: mess });

    await generate(setup.hostelId);
    const nights = daysInLastMonth - 10;
    const expected = (n: number, monthly: number) =>
      Math.round((monthly * n) / daysInLastMonth / 100) * 100;
    const [partInvoice] = await invoiceOf(part.residentId);
    expect(partInvoice.invoice_lines.map((line) => line.amount)).toEqual([
      expected(nights, 600000),
      expected(nights, 310000),
    ]);
    const [optedOutInvoice] = await invoiceOf(optedOut.residentId);
    expect(optedOutInvoice.invoice_lines.map((line) => line.kind)).toEqual(["rent"]);
  });

  it("refuse duplicate names and staff changes", async () => {
    const setup = await hostel();
    await head(setup.hostelId, "Mess", "monthly");
    const duplicate = await owner.client
      .from("fee_heads")
      .insert({ hostel_id: setup.hostelId, name: " mess ", kind: "monthly" });
    expect(duplicate.error?.code).toBe("23505");
    const staff = await createUser({ profile: { role: "staff", hostel_id: setup.hostelId } });
    const byStaff = await staff.client
      .from("fee_heads")
      .insert({ hostel_id: setup.hostelId, name: "Laundry", kind: "monthly" });
    expect(byStaff.error?.code).toBe(PERMISSION_DENIED);
  });
});

describe("invoice lines", () => {
  it("must add up to the invoice amount, checked at commit", async () => {
    const setup = await hostel();
    const { residentId } = await residentIn(setup);
    await generate(setup.hostelId);
    const [invoice] = await invoiceOf(residentId);
    // The service role adds a stray line: the commit-time check refuses it.
    const stray = await admin.from("invoice_lines").insert({
      hostel_id: setup.hostelId,
      invoice_id: invoice.id,
      position: 99,
      kind: "charge",
      description: "Stray",
      amount: 100,
    });
    expect(stray.error?.hint).toBe("invoice_lines_total");
    const edit = await owner.client
      .from("invoice_lines")
      .update({ amount: 1 })
      .eq("invoice_id", invoice.id);
    expect(edit.error?.code).toBe(PERMISSION_DENIED);
  });
});

describe("charges", () => {
  it("wait as pending, go on the next invoice once, and come back if it is voided", async () => {
    const setup = await hostel();
    const { residentId } = await residentIn(setup);
    const staff = await createUser({ profile: { role: "staff", hostel_id: setup.hostelId } });
    const { error } = await staff.client.from("resident_charges").insert({
      hostel_id: setup.hostelId,
      resident_id: residentId,
      description: "Broken chair",
      amount: 75000,
      charge_date: lastMonth,
    });
    expect(error).toBeNull();

    await generate(setup.hostelId);
    const [invoice] = await invoiceOf(residentId);
    expect(invoice.amount).toBe(675000);
    expect(invoice.invoice_lines.at(-1)).toMatchObject({
      kind: "charge",
      description: "Broken chair",
    });

    // A billed charge can no longer be voided on its own.
    const { data: charge } = await admin
      .from("resident_charges")
      .select("id, invoice_id")
      .eq("resident_id", residentId)
      .single();
    expect(charge?.invoice_id).toBe(invoice.id);
    const voidBilled = await owner.client
      .from("resident_charges")
      .update({ void_reason: "x" })
      .eq("id", charge!.id);
    expect(voidBilled.error?.hint).toBe("charge_invoiced");

    // Voiding the invoice frees the charge for the next one.
    await owner.client
      .from("invoices")
      .update({ status: "void", void_reason: "Redo" })
      .eq("id", invoice.id);
    const { data: freed } = await admin
      .from("resident_charges")
      .select("invoice_id")
      .eq("id", charge!.id)
      .single();
    expect(freed?.invoice_id).toBeNull();
    await generate(setup.hostelId);
    const [again] = await invoiceOf(residentId);
    expect(again.amount).toBe(675000);
  });

  it("can be billed now on their own, by the owner only", async () => {
    const setup = await hostel();
    const { residentId } = await residentIn(setup);
    await admin.from("resident_charges").insert({
      hostel_id: setup.hostelId,
      resident_id: residentId,
      description: "Key replacement",
      amount: 30000,
      charge_date: todayIst(),
    });
    const staff = await createUser({ profile: { role: "staff", hostel_id: setup.hostelId } });
    expect(
      (await staff.client.rpc("bill_charges_now", { p_resident_id: residentId })).error?.code,
    ).toBe(PERMISSION_DENIED);
    const billed = await owner.client.rpc("bill_charges_now", { p_resident_id: residentId });
    expect(billed.error).toBeNull();
    const [invoice] = await invoiceOf(residentId);
    expect(invoice).toMatchObject({ kind: "charges", amount: 30000 });
    const nothing = await owner.client.rpc("bill_charges_now", { p_resident_id: residentId });
    expect(nothing.error?.hint).toBe("no_pending_charges");
  });

  it("include an admission fee on a resident's first stay only", async () => {
    const setup = await hostel();
    const admission = await head(setup.hostelId, "Admission", "one_time", true);
    await price(admission, 200000);
    const { residentId, allocationId } = await residentIn(setup, 0, "2026-01-01", "2026-01-31");
    // A second stay for the same resident adds nothing.
    await admin.from("allocations").insert({
      hostel_id: setup.hostelId,
      resident_id: residentId,
      room_id: setup.roomId,
      bed_id: setup.bedIds[1],
      start_date: "2026-02-01",
      created_by: owner.id,
    });
    const { data } = await admin
      .from("resident_charges")
      .select("category, description, amount")
      .eq("resident_id", residentId);
    expect(data).toEqual([{ category: "admission", description: "Admission", amount: 200000 }]);
    expect(allocationId).toBeTruthy();
  });
});

describe("discounts", () => {
  it("take percentage and fixed amounts off rent or a head, never below zero", async () => {
    const setup = await hostel();
    const mess = await head(setup.hostelId, "Mess", "monthly");
    await price(mess, 300000);
    const { residentId } = await residentIn(setup);
    const add = (row: Record<string, unknown>) =>
      owner.client.from("resident_discounts").insert({
        hostel_id: setup.hostelId,
        resident_id: residentId,
        from_month: "2020-01-01",
        reason: "Sibling discount",
        ...row,
      } as never);
    expect((await add({ kind: "percent", value: 10 })).error).toBeNull();
    expect((await add({ kind: "fixed", value: 500000, head_id: mess })).error).toBeNull();

    await generate(setup.hostelId);
    const [invoice] = await invoiceOf(residentId);
    expect(invoice.invoice_lines.map((line) => [line.kind, line.amount])).toEqual([
      ["rent", 600000],
      ["fee_head", 300000],
      ["discount", -60000],
      ["discount", -300000],
    ]);
    expect(invoice.amount).toBe(540000);
  });

  it("are given by owners only, and end by voiding with a reason", async () => {
    const setup = await hostel();
    const { residentId } = await residentIn(setup);
    const staff = await createUser({ profile: { role: "staff", hostel_id: setup.hostelId } });
    const row = {
      hostel_id: setup.hostelId,
      resident_id: residentId,
      kind: "percent",
      value: 50,
      from_month: "2020-01-01",
      reason: "Festival offer",
    };
    expect((await staff.client.from("resident_discounts").insert(row)).error?.code).toBe(
      PERMISSION_DENIED,
    );
    const { data } = await owner.client
      .from("resident_discounts")
      .insert(row)
      .select("id")
      .single();
    await owner.client
      .from("resident_discounts")
      .update({ void_reason: "Ended early" })
      .eq("id", data!.id);
    await generate(setup.hostelId);
    const [invoice] = await invoiceOf(residentId);
    expect(invoice.amount).toBe(600000);
  });
});

describe("electricity", () => {
  async function reading(setup: Setup, month: string, value: number) {
    return owner.client.from("room_meter_readings").insert({
      hostel_id: setup.hostelId,
      room_id: setup.roomId,
      reading_month: month,
      reading: value,
    });
  }

  it("splits a room's units among its residents by nights, once per month", async () => {
    const setup = await hostel();
    await owner.client
      .from("hostels")
      .update({ electricity_unit_rate: 800 })
      .eq("id", setup.hostelId);
    const full = await residentIn(setup, 0);
    // The second resident left after 10 nights.
    const short = await residentIn(setup, 1, "2026-01-01", `${lastMonth.slice(0, 8)}10`);
    expect((await reading(setup, shiftMonth(lastMonth, -1), 1000)).error).toBeNull();
    expect((await reading(setup, lastMonth, 1100)).error).toBeNull();

    const { data, error } = await owner.client.rpc("bill_electricity", {
      p_hostel_id: setup.hostelId,
      p_period_month: lastMonth,
    });
    expect(error).toBeNull();
    expect(data).toMatchObject({
      rooms_billed: 1,
      charges: 2,
      total_amount: 80000,
      missing_readings: [],
    });
    const { data: charges } = await admin
      .from("resident_charges")
      .select("resident_id, amount")
      .eq("category", "electricity")
      .in("resident_id", [full.residentId, short.residentId]);
    const share = (charges ?? []).reduce<Record<string, number>>(
      (all, row) => ({ ...all, [row.resident_id]: row.amount }),
      {},
    );
    const nights = daysInLastMonth + 10;
    expect(share[short.residentId]).toBe(
      Math.trunc((80000 * 10) / nights) || share[short.residentId],
    );
    expect(share[full.residentId] + share[short.residentId]).toBe(80000);

    const again = await owner.client.rpc("bill_electricity", {
      p_hostel_id: setup.hostelId,
      p_period_month: lastMonth,
    });
    expect(again.data).toMatchObject({ rooms_billed: 0, already_billed: 1 });
    // A billed reading is final.
    const fix = await owner.client
      .from("room_meter_readings")
      .update({ reading: 1200 })
      .eq("room_id", setup.roomId)
      .eq("reading_month", lastMonth);
    expect(fix.error?.hint).toBe("reading_billed");
  });

  it("refuses a reading lower than the last, and lists occupied rooms with none", async () => {
    const setup = await hostel();
    await owner.client
      .from("hostels")
      .update({ electricity_unit_rate: 800 })
      .eq("id", setup.hostelId);
    await residentIn(setup);
    await reading(setup, shiftMonth(lastMonth, -1), 500);
    expect((await reading(setup, lastMonth, 400)).error?.hint).toBe("reading_lower");

    const { data } = await owner.client.rpc("bill_electricity", {
      p_hostel_id: setup.hostelId,
      p_period_month: lastMonth,
    });
    expect(data).toMatchObject({
      rooms_billed: 0,
      missing_readings: [{ room_id: setup.roomId, room_number: "101" }],
    });
  });

  it("is refused while no unit price is set", async () => {
    const setup = await hostel();
    const { error } = await owner.client.rpc("bill_electricity", {
      p_hostel_id: setup.hostelId,
      p_period_month: lastMonth,
    });
    expect(error?.hint).toBe("electricity_off");
  });
});

describe("erasing a resident", () => {
  it("waits until their pending charges are billed or voided", async () => {
    const setup = await hostel();
    const { data: resident } = await admin
      .from("residents")
      .insert(residentRow(setup.hostelId, { status: "vacated" }))
      .select("id")
      .single();
    const { data: charge } = await admin
      .from("resident_charges")
      .insert({
        hostel_id: setup.hostelId,
        resident_id: resident!.id,
        description: "Damage",
        amount: 10000,
        charge_date: "2026-01-01",
      })
      .select("id")
      .single();
    const refused = await owner.client.rpc("erase_resident", {
      p_resident_id: resident!.id,
      p_reason: "Asked",
    });
    expect(refused.error?.hint).toBe("erase_pending_charges");
    await owner.client
      .from("resident_charges")
      .update({ void_reason: "Waived" })
      .eq("id", charge!.id);
    const erased = await owner.client.rpc("erase_resident", {
      p_resident_id: resident!.id,
      p_reason: "Asked",
    });
    expect(erased.error).toBeNull();
  });
});
