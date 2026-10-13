import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { todayIst } from "@/lib/validation";

import { connectToDatabase } from "../support/db";
import { residentRow } from "../support/residents";
import { createUserFactory, type TestUser } from "../support/supabase";

/**
 * Fee rules (E7-T1 to E7-T5), run as real signed-in owners and staff through
 * the same functions and tables the app uses. Every test builds its own
 * hostel, so amounts and counts are exact.
 */
const PERMISSION_DENIED = "42501";
const EXCLUSION_VIOLATION = "23P01";

const { admin, createUser, createHostel, cleanup } = createUserFactory();

afterAll(cleanup);

let owner: TestUser;
let staff: TestUser;
let staffHostelId: string;

beforeAll(async () => {
  owner = await createUser();
  const staffHostel = await createHostel(owner.id);
  staff = await createUser({ profile: { role: "staff", hostel_id: staffHostel.id } });
  staffHostelId = staffHostel.id;
});

// ---------------------------------------------------------------------------
// Dates
// ---------------------------------------------------------------------------

/** First day of the month `offset` months from the current month in India. */
function monthStart(offset = 0): string {
  const [year, month] = todayIst().split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1 + offset, 1));
  return date.toISOString().slice(0, 10);
}

function daysIn(month: string): number {
  const [year, m] = month.split("-").map(Number);
  return new Date(Date.UTC(year, m, 0)).getUTCDate();
}

/** `YYYY-MM-DD` for day `day` of the month starting at `month`. */
function dayOf(month: string, day: number): string {
  return `${month.slice(0, 8)}${String(day).padStart(2, "0")}`;
}

/** Part-month charge as documented: rate x nights / days, to the nearest rupee. */
function prorate(sum: number, days: number): number {
  return Math.round(sum / days / 100) * 100;
}

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

async function hostel(): Promise<string> {
  return (await createHostel(owner.id)).id;
}

async function resident(hostelId: string): Promise<string> {
  const { data, error } = await admin
    .from("residents")
    .insert(residentRow(hostelId))
    .select("id")
    .single();
  if (error) throw error;
  return data.id;
}

let roomCounter = 0;
async function bed(
  hostelId: string,
  sharing: "single" | "double" | "triple" = "single",
): Promise<string> {
  roomCounter += 1;
  const capacity = { single: 1, double: 2, triple: 3 }[sharing];
  const { data, error } = await admin
    .from("rooms")
    .insert({
      hostel_id: hostelId,
      room_number: `F${roomCounter}`,
      floor: 1,
      sharing_type: sharing,
      capacity,
    })
    .select("id")
    .single();
  if (error) throw error;
  const { data: beds } = await admin.from("beds").select("id").eq("room_id", data.id).limit(1);
  return beds![0].id;
}

/** A stay recorded as history (the service role may write past dates). */
async function stay(
  hostelId: string,
  residentId: string,
  bedId: string,
  start: string,
  {
    end = null,
    reason = "moved_out",
    rentOverride = null,
  }: { end?: string | null; reason?: string; rentOverride?: number | null } = {},
): Promise<string> {
  const { data: bedRow } = await admin.from("beds").select("room_id").eq("id", bedId).single();
  const { data, error } = await admin
    .from("allocations")
    .insert({
      hostel_id: hostelId,
      resident_id: residentId,
      bed_id: bedId,
      room_id: bedRow!.room_id,
      start_date: start,
      end_date: end,
      vacate_reason: end ? reason : null,
      rent_override: rentOverride,
      created_by: owner.id,
    })
    .select("id")
    .single();
  if (error) throw error;
  return data.id;
}

function setRate(
  hostelId: string,
  sharing: "single" | "double" | "triple",
  amount: number,
  from: string,
  user: TestUser = owner,
) {
  return user.client.rpc("set_fee_structure", {
    p_hostel_id: hostelId,
    p_sharing_type: sharing,
    p_monthly_amount: amount,
    p_effective_from: from,
  });
}

interface Summary {
  created: number;
  total_amount: number;
  already_invoiced: number;
  unpriced: { resident_id: string; full_name: string }[];
}

async function generate(hostelId: string, month: string, dueDay = 5, user: TestUser = owner) {
  const { data, error } = await user.client.rpc("generate_invoices", {
    p_hostel_id: hostelId,
    p_period_month: month,
    p_due_day: dueDay,
  });
  return { summary: data as unknown as Summary | null, error };
}

async function invoiceFor(residentId: string, month: string) {
  const { data, error } = await admin
    .from("invoice_balances")
    .select("*")
    .eq("resident_id", residentId)
    .eq("period_month", month)
    .eq("status", "issued")
    .maybeSingle();
  if (error) throw error;
  return data;
}

function pay(
  hostelId: string,
  invoiceId: string,
  amount: number,
  user: TestUser = owner,
  paidAt = todayIst(),
) {
  return user.client.from("payments").insert({
    hostel_id: hostelId,
    invoice_id: invoiceId,
    amount,
    paid_at: paidAt,
    mode: "upi",
    reference: "UTR123",
  });
}

/**
 * An invoice due on the last day of the current month, written directly so
 * its due date is always today or later: not yet overdue on any day.
 */
async function notYetDueInvoice(hostelId: string, residentId: string, amount: number) {
  const month = monthStart(0);
  const { data, error } = await admin
    .from("invoices")
    .insert({
      hostel_id: hostelId,
      resident_id: residentId,
      period_month: month,
      amount,
      due_date: dayOf(month, daysIn(month)),
    })
    .select("id")
    .single();
  if (error) throw error;
  return data.id;
}

// ---------------------------------------------------------------------------
// Rates (E7-T2)
// ---------------------------------------------------------------------------

describe("fee structures", () => {
  it("close the current rate the day before a new one starts", async () => {
    const hostelId = await hostel();
    expect((await setRate(hostelId, "double", 800000, "2026-01-01")).error).toBeNull();
    expect((await setRate(hostelId, "double", 900000, "2026-07-01")).error).toBeNull();

    const { data } = await admin
      .from("fee_structures")
      .select("monthly_amount, effective_from, effective_to")
      .eq("hostel_id", hostelId)
      .order("effective_from");
    expect(data).toEqual([
      { monthly_amount: 800000, effective_from: "2026-01-01", effective_to: "2026-06-30" },
      { monthly_amount: 900000, effective_from: "2026-07-01", effective_to: null },
    ]);
  });

  it("correct the amount when a rate is re-entered with the same start date", async () => {
    const hostelId = await hostel();
    await setRate(hostelId, "single", 1000000, "2026-03-01");
    await setRate(hostelId, "single", 1100000, "2026-03-01");
    const { data } = await admin
      .from("fee_structures")
      .select("monthly_amount")
      .eq("hostel_id", hostelId);
    expect(data).toEqual([{ monthly_amount: 1100000 }]);
  });

  it("refuse a rate that would start before a later one", async () => {
    const hostelId = await hostel();
    await setRate(hostelId, "triple", 600000, "2026-05-01");
    const { error } = await setRate(hostelId, "triple", 500000, "2026-02-01");
    expect(error?.hint).toBe("fee_structure_later_exists");
    expect(error?.message).toContain("1 May 2026");
  });

  it("never overlap for one sharing type, even when written directly", async () => {
    const hostelId = await hostel();
    await setRate(hostelId, "double", 800000, "2026-01-01");
    const { error } = await admin.from("fee_structures").insert({
      hostel_id: hostelId,
      sharing_type: "double",
      monthly_amount: 700000,
      effective_from: "2026-04-01",
    });
    expect(error?.code).toBe(EXCLUSION_VIOLATION);
    // Another sharing type is independent.
    expect((await setRate(hostelId, "single", 1200000, "2026-01-01")).error).toBeNull();
  });

  it("can only be set by owners", async () => {
    const { error } = await setRate(staffHostelId, "single", 900000, "2026-01-01", staff);
    expect(error?.code).toBe(PERMISSION_DENIED);
  });

  it("never change invoices that were already issued", async () => {
    const hostelId = await hostel();
    const month = monthStart(-1);
    await setRate(hostelId, "single", 1000000, monthStart(-6));
    const residentId = await resident(hostelId);
    await stay(hostelId, residentId, await bed(hostelId), monthStart(-3));
    await generate(hostelId, month);

    await setRate(hostelId, "single", 1500000, monthStart(-6));
    expect((await invoiceFor(residentId, month))!.amount).toBe(1000000);
  });
});

// ---------------------------------------------------------------------------
// Generation (E7-T3)
// ---------------------------------------------------------------------------

describe("invoice generation", () => {
  it("bills a full month at exactly the rate, with the due date in India's calendar", async () => {
    const hostelId = await hostel();
    const month = monthStart(-1);
    await setRate(hostelId, "double", 850000, monthStart(-12));
    const residentId = await resident(hostelId);
    await stay(hostelId, residentId, await bed(hostelId, "double"), monthStart(-2));

    const { summary, error } = await generate(hostelId, month, 7);
    expect(error).toBeNull();
    expect(summary).toMatchObject({ created: 1, total_amount: 850000, already_invoiced: 0 });
    const invoice = await invoiceFor(residentId, month);
    expect(invoice).toMatchObject({ amount: 850000, due_date: dayOf(month, 7) });
  });

  it("is idempotent: a re-run creates nothing and reports what it skipped", async () => {
    const hostelId = await hostel();
    const month = monthStart(-1);
    await setRate(hostelId, "single", 1000000, monthStart(-12));
    for (let i = 0; i < 3; i += 1) {
      await stay(hostelId, await resident(hostelId), await bed(hostelId), monthStart(-2));
    }

    expect((await generate(hostelId, month)).summary).toMatchObject({ created: 3 });
    const again = await generate(hostelId, month);
    expect(again.summary).toMatchObject({ created: 0, total_amount: 0, already_invoiced: 3 });
    const { count } = await admin
      .from("invoices")
      .select("id", { count: "exact", head: true })
      .eq("hostel_id", hostelId);
    expect(count).toBe(3);
  });

  it("skips a part month that rounds to ₹0 without calling it already invoiced", async () => {
    const hostelId = await hostel();
    const month = monthStart(-1);
    await setRate(hostelId, "single", 1000000, monthStart(-12));
    // ₹10 a month for one night rounds to ₹0: nothing is owed.
    const residentId = await resident(hostelId);
    await stay(hostelId, residentId, await bed(hostelId), dayOf(month, daysIn(month)), {
      rentOverride: 1000,
    });
    await stay(hostelId, await resident(hostelId), await bed(hostelId), monthStart(-2));

    const { summary, error } = await generate(hostelId, month);
    expect(error).toBeNull();
    expect(summary).toMatchObject({ created: 1, total_amount: 1000000, already_invoiced: 0 });
    expect(await invoiceFor(residentId, month)).toBeNull();
  });

  it("creates exactly one invoice per resident when runs race", async () => {
    const hostelId = await hostel();
    const month = monthStart(-1);
    await setRate(hostelId, "single", 1000000, monthStart(-12));
    for (let i = 0; i < 4; i += 1) {
      await stay(hostelId, await resident(hostelId), await bed(hostelId), monthStart(-2));
    }

    const runs = await Promise.all(Array.from({ length: 5 }, () => generate(hostelId, month)));
    expect(runs.every((run) => run.error === null)).toBe(true);
    const created = runs.reduce((sum, run) => sum + run.summary!.created, 0);
    expect(created).toBe(4);
    const { count } = await admin
      .from("invoices")
      .select("id", { count: "exact", head: true })
      .eq("hostel_id", hostelId);
    expect(count).toBe(4);
  });

  it("is enforced by the database: a second issued invoice for a month is rejected", async () => {
    const hostelId = await hostel();
    const residentId = await resident(hostelId);
    const row = {
      hostel_id: hostelId,
      resident_id: residentId,
      period_month: monthStart(-1),
      amount: 100,
      due_date: dayOf(monthStart(-1), 5),
    };
    expect((await admin.from("invoices").insert(row)).error).toBeNull();
    expect((await admin.from("invoices").insert(row)).error?.code).toBe("23505");
  });

  it("prorates a mid-month arrival by the nights held", async () => {
    const hostelId = await hostel();
    const month = monthStart(-1);
    const days = daysIn(month);
    await setRate(hostelId, "single", 900000, monthStart(-12));
    const residentId = await resident(hostelId);
    await stay(hostelId, residentId, await bed(hostelId), dayOf(month, 11));

    await generate(hostelId, month);
    const nights = days - 10;
    expect((await invoiceFor(residentId, month))!.amount).toBe(prorate(900000 * nights, days));
  });

  it("gives a mid-month transfer one invoice that charges each bed's rate for its nights", async () => {
    const hostelId = await hostel();
    const month = monthStart(-1);
    const days = daysIn(month);
    await setRate(hostelId, "single", 1200000, monthStart(-12));
    await setRate(hostelId, "triple", 600000, monthStart(-12));
    const residentId = await resident(hostelId);
    await stay(hostelId, residentId, await bed(hostelId, "single"), monthStart(-3), {
      end: dayOf(month, 9),
      reason: "transferred",
    });
    const second = await stay(
      hostelId,
      residentId,
      await bed(hostelId, "triple"),
      dayOf(month, 10),
    );

    const { summary } = await generate(hostelId, month);
    expect(summary).toMatchObject({ created: 1 });
    const invoice = await invoiceFor(residentId, month);
    expect(invoice!.amount).toBe(prorate(1200000 * 9 + 600000 * (days - 9), days));
    expect(invoice!.allocation_id).toBe(second);

    const { data } = await admin
      .from("invoices")
      .select("breakdown")
      .eq("id", invoice!.id!)
      .single();
    expect(data!.breakdown).toEqual([
      expect.objectContaining({ nights: 9, monthly_rate: 1200000, sharing_type: "single" }),
      expect.objectContaining({ nights: days - 9, monthly_rate: 600000, sharing_type: "triple" }),
    ]);
  });

  it("prefers the allocation's rent override to the fee structure", async () => {
    const hostelId = await hostel();
    const month = monthStart(-1);
    await setRate(hostelId, "single", 1000000, monthStart(-12));
    const residentId = await resident(hostelId);
    await stay(hostelId, residentId, await bed(hostelId), monthStart(-2), { rentOverride: 750000 });

    await generate(hostelId, month);
    const invoice = await invoiceFor(residentId, month);
    expect(invoice!.amount).toBe(750000);
  });

  it("uses the rate in force on the 1st of the billing month", async () => {
    const hostelId = await hostel();
    const month = monthStart(-1);
    await setRate(hostelId, "single", 1000000, monthStart(-12));
    await setRate(hostelId, "single", 1300000, dayOf(month, 15));
    const residentId = await resident(hostelId);
    await stay(hostelId, residentId, await bed(hostelId), monthStart(-2));

    await generate(hostelId, month);
    expect((await invoiceFor(residentId, month))!.amount).toBe(1000000);
  });

  it("flags residents with no rate instead of under-billing them", async () => {
    const hostelId = await hostel();
    const month = monthStart(-1);
    await setRate(hostelId, "single", 1000000, monthStart(-12));
    const priced = await resident(hostelId);
    const unpriced = await resident(hostelId);
    await stay(hostelId, priced, await bed(hostelId, "single"), monthStart(-2));
    await stay(hostelId, unpriced, await bed(hostelId, "double"), monthStart(-2));

    const { summary } = await generate(hostelId, month);
    expect(summary!.created).toBe(1);
    expect(summary!.unpriced.map((entry) => entry.resident_id)).toEqual([unpriced]);
    expect(await invoiceFor(unpriced, month)).toBeNull();
  });

  it("only bills residents who held a bed in the month", async () => {
    const hostelId = await hostel();
    const month = monthStart(-1);
    await setRate(hostelId, "single", 1000000, monthStart(-12));
    const left = await resident(hostelId);
    await stay(hostelId, left, await bed(hostelId), monthStart(-4), {
      end: dayOf(monthStart(-2), 20),
    });
    await resident(hostelId); // never allocated

    expect((await generate(hostelId, month)).summary).toMatchObject({ created: 0 });
  });

  it("refuses future months, mid-month dates, bad due days and staff", async () => {
    const hostelId = await hostel();
    expect((await generate(hostelId, monthStart(1))).error?.hint).toBe("billing_month_future");
    expect((await generate(hostelId, dayOf(monthStart(-1), 2))).error?.hint).toBe("billing_month");
    expect((await generate(hostelId, monthStart(-1), 31)).error?.hint).toBe("due_day");

    await setRate(staffHostelId, "single", 1000000, monthStart(-12));
    await stay(
      staffHostelId,
      await resident(staffHostelId),
      await bed(staffHostelId),
      monthStart(-2),
    );
    const byStaff = await generate(staffHostelId, monthStart(-1), 5, staff);
    expect(byStaff.error?.code).toBe(PERMISSION_DENIED);
  });

  it("lets an owner void an invoice with a reason and generate the month again", async () => {
    const hostelId = await hostel();
    const month = monthStart(-1);
    await setRate(hostelId, "single", 1000000, monthStart(-12));
    const residentId = await resident(hostelId);
    await stay(hostelId, residentId, await bed(hostelId), monthStart(-2), { rentOverride: 999900 });
    await generate(hostelId, month);
    const first = await invoiceFor(residentId, month);

    const noReason = await owner.client
      .from("invoices")
      .update({ status: "void" })
      .eq("id", first!.id!);
    expect(noReason.error?.code).toBe("23514");

    const voided = await owner.client
      .from("invoices")
      .update({ status: "void", void_reason: "Wrong rent" })
      .eq("id", first!.id!);
    expect(voided.error).toBeNull();
    const { summary } = await generate(hostelId, month);
    expect(summary).toMatchObject({ created: 1 });

    const { data: rows } = await admin
      .from("invoice_balances")
      .select("status, balance, due_status, voided:void_reason")
      .eq("resident_id", residentId)
      .order("created_at");
    expect(rows).toEqual([
      { status: "void", balance: 0, due_status: null, voided: "Wrong rent" },
      expect.objectContaining({ status: "issued" }),
    ]);
  });

  it("never edits an invoice or un-voids it", async () => {
    const hostelId = await hostel();
    const residentId = await resident(hostelId);
    const invoiceId = await notYetDueInvoice(hostelId, residentId, 5000);

    const edit = await admin.from("invoices").update({ amount: 1 }).eq("id", invoiceId);
    expect(edit.error?.hint).toBe("invoice_immutable");
    await owner.client
      .from("invoices")
      .update({ status: "void", void_reason: "Duplicate" })
      .eq("id", invoiceId);
    const revive = await admin
      .from("invoices")
      .update({ status: "issued", void_reason: null })
      .eq("id", invoiceId);
    expect(revive.error?.hint).toBe("invoice_void");
  });

  it("lets staff void neither invoices nor payments", async () => {
    const residentId = await resident(staffHostelId);
    const invoiceId = await notYetDueInvoice(staffHostelId, residentId, 5000);
    await staff.client
      .from("invoices")
      .update({ status: "void", void_reason: "x" })
      .eq("id", invoiceId);
    const { data } = await admin.from("invoices").select("status").eq("id", invoiceId).single();
    expect(data!.status).toBe("issued");

    await pay(staffHostelId, invoiceId, 1000, staff);
    await staff.client.from("payments").update({ void_reason: "x" }).eq("invoice_id", invoiceId);
    const { data: payment } = await admin
      .from("payments")
      .select("voided_at")
      .eq("invoice_id", invoiceId)
      .single();
    expect(payment!.voided_at).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Payments (E7-T4)
// ---------------------------------------------------------------------------

describe("payments", () => {
  it("derive unpaid, partial and paid from what was received", async () => {
    const hostelId = await hostel();
    const invoiceId = await notYetDueInvoice(hostelId, await resident(hostelId), 900000);
    const status = async () =>
      (
        await admin
          .from("invoice_balances")
          .select("due_status, paid, balance")
          .eq("id", invoiceId)
          .single()
      ).data;

    expect(await status()).toEqual({ due_status: "unpaid", paid: 0, balance: 900000 });
    expect((await pay(hostelId, invoiceId, 400000)).error).toBeNull();
    expect(await status()).toEqual({ due_status: "partial", paid: 400000, balance: 500000 });
    expect((await pay(hostelId, invoiceId, 500000)).error).toBeNull();
    expect(await status()).toEqual({ due_status: "paid", paid: 900000, balance: 0 });
  });

  it("can be recorded by staff, as themselves", async () => {
    const invoiceId = await notYetDueInvoice(staffHostelId, await resident(staffHostelId), 1000);
    expect((await pay(staffHostelId, invoiceId, 1000, staff)).error).toBeNull();
    const { data } = await admin.from("payments").select("recorded_by").eq("invoice_id", invoiceId);
    expect(data).toEqual([{ recorded_by: staff.id }]);

    const spoof = await staff.client.from("payments").insert({
      hostel_id: staffHostelId,
      invoice_id: invoiceId,
      amount: 1,
      paid_at: todayIst(),
      mode: "cash",
      recorded_by: owner.id,
    } as never);
    expect(spoof.error).not.toBeNull();
  });

  it("keep who recorded them readable by every member, without trusting the client", async () => {
    // Staff cannot read the owner's profile, so the name is snapshotted.
    const namedOwner = await createUser({ fullName: "Priya Owner" });
    const hostelId = (await createHostel(namedOwner.id)).id;
    const warden = await createUser({
      fullName: "Ravi Warden",
      profile: { role: "staff", hostel_id: hostelId },
    });
    const invoiceId = await notYetDueInvoice(hostelId, await resident(hostelId), 2000);
    expect((await pay(hostelId, invoiceId, 1000, namedOwner)).error).toBeNull();
    expect((await pay(hostelId, invoiceId, 1000, warden)).error).toBeNull();

    const names = async (user: TestUser) =>
      (
        await user.client
          .from("payments")
          .select("recorded_by_name")
          .eq("invoice_id", invoiceId)
          .order("created_at")
      ).data;
    const expected = [{ recorded_by_name: "Priya Owner" }, { recorded_by_name: "Ravi Warden" }];
    expect(await names(warden)).toEqual(expected);
    expect(await names(namedOwner)).toEqual(expected);

    const forged = await warden.client.from("payments").insert({
      hostel_id: hostelId,
      invoice_id: invoiceId,
      amount: 1,
      paid_at: todayIst(),
      mode: "cash",
      recorded_by_name: "Someone else",
    });
    expect(forged.error?.code).toBe(PERMISSION_DENIED);
  });

  it("block overpayment, naming what is still due", async () => {
    const hostelId = await hostel();
    const invoiceId = await notYetDueInvoice(hostelId, await resident(hostelId), 500000);
    await pay(hostelId, invoiceId, 200000);
    const { error } = await pay(hostelId, invoiceId, 300001);
    expect(error?.hint).toBe("overpayment");
    expect(error?.message).toBe("Only ₹3000.00 is due on this invoice");
  });

  it("cannot overpay between two collectors recording at the same moment", async () => {
    const hostelId = await hostel();
    const invoiceId = await notYetDueInvoice(hostelId, await resident(hostelId), 500000);
    const results = await Promise.all(
      Array.from({ length: 6 }, () => pay(hostelId, invoiceId, 500000)),
    );
    expect(results.filter((result) => result.error === null)).toHaveLength(1);
    expect(results.filter((result) => result.error?.hint === "overpayment")).toHaveLength(5);
  });

  it("never land on an invoice that is voided at the same moment", async () => {
    const hostelId = await hostel();
    for (let round = 0; round < 20; round += 1) {
      const invoiceId = await notYetDueInvoice(hostelId, await resident(hostelId), 500000);
      await Promise.all([
        pay(hostelId, invoiceId, 100000),
        owner.client
          .from("invoices")
          .update({ status: "void", void_reason: "Raised in error" })
          .eq("id", invoiceId),
      ]);
      const [{ data: invoice }, { count: livePayments }] = await Promise.all([
        admin.from("invoices").select("status").eq("id", invoiceId).single(),
        admin
          .from("payments")
          .select("id", { count: "exact", head: true })
          .eq("invoice_id", invoiceId)
          .is("voided_at", null),
      ]);
      // Exactly one of them wins: a paid invoice stays issued, a void one has no money on it.
      expect({ status: invoice!.status, livePayments }).not.toEqual({
        status: "void",
        livePayments: 1,
      });
    }
  });

  it("reject future dates and void invoices", async () => {
    const hostelId = await hostel();
    const residentId = await resident(hostelId);
    const invoiceId = await notYetDueInvoice(hostelId, residentId, 5000);
    const tomorrow = new Date(`${todayIst()}T00:00:00Z`);
    tomorrow.setUTCDate(tomorrow.getUTCDate() + 1);
    const future = await pay(hostelId, invoiceId, 100, owner, tomorrow.toISOString().slice(0, 10));
    expect(future.error?.hint).toBe("payment_future");

    await owner.client
      .from("invoices")
      .update({ status: "void", void_reason: "Raised in error" })
      .eq("id", invoiceId);
    expect((await pay(hostelId, invoiceId, 100)).error?.hint).toBe("invoice_void");
  });

  it("are never edited or deleted; a voided payment drops out of every total", async () => {
    const hostelId = await hostel();
    const residentId = await resident(hostelId);
    const invoiceId = await notYetDueInvoice(hostelId, residentId, 800000);
    await pay(hostelId, invoiceId, 300000);
    const { data: payment } = await admin
      .from("payments")
      .select("id")
      .eq("invoice_id", invoiceId)
      .single();

    const edit = await owner.client
      .from("payments")
      .update({ amount: 1 } as never)
      .eq("id", payment!.id);
    expect(edit.error?.code).toBe(PERMISSION_DENIED);
    const remove = await owner.client.from("payments").delete().eq("id", payment!.id);
    expect(remove.error?.code).toBe(PERMISSION_DENIED);

    // An invoice with a live payment cannot be voided out from under it.
    const voidInvoice = await owner.client
      .from("invoices")
      .update({ status: "void", void_reason: "x" })
      .eq("id", invoiceId);
    expect(voidInvoice.error?.hint).toBe("invoice_has_payments");

    const voided = await owner.client
      .from("payments")
      .update({ void_reason: "Cheque bounced" })
      .eq("id", payment!.id);
    expect(voided.error).toBeNull();
    const again = await owner.client
      .from("payments")
      .update({ void_reason: "twice" })
      .eq("id", payment!.id);
    expect(again.error?.hint).toBe("payment_void");

    const { data: balance } = await admin
      .from("invoice_balances")
      .select("paid, balance, due_status")
      .eq("id", invoiceId)
      .single();
    expect(balance).toEqual({ paid: 0, balance: 800000, due_status: "unpaid" });
    const { data: row } = await admin
      .from("payments")
      .select("voided_at, voided_by")
      .eq("id", payment!.id)
      .single();
    expect(row!.voided_at).not.toBeNull();
    expect(row!.voided_by).toBe(owner.id);
  });
});

// ---------------------------------------------------------------------------
// Balances (E7-T5)
// ---------------------------------------------------------------------------

describe("billed months", () => {
  it("lists every billed month once, beyond the API's 1000-row cap", async () => {
    const hostelId = await hostel();
    const { data: residents, error } = await admin
      .from("residents")
      .insert(Array.from({ length: 92 }, () => residentRow(hostelId)))
      .select("id");
    if (error) throw error;
    const months = Array.from({ length: 12 }, (_, index) => monthStart(-index));
    const rows = months.flatMap((month) =>
      residents.map((row) => ({
        hostel_id: hostelId,
        resident_id: row.id,
        period_month: month,
        amount: 100,
        due_date: dayOf(month, 5),
      })),
    );
    expect(rows.length).toBeGreaterThan(1000);
    const inserted = await admin.from("invoices").insert(rows);
    expect(inserted.error).toBeNull();

    const listed = await owner.client.rpc("billed_months", { p_hostel_id: hostelId });
    expect(listed.error).toBeNull();
    expect(listed.data).toEqual(months);

    const outsider = await createUser();
    expect((await outsider.client.rpc("billed_months", { p_hostel_id: hostelId })).data).toEqual(
      [],
    );
  });
});

describe("outstanding balances", () => {
  it("reconcile exactly with seeded invoices and payments across several months", async () => {
    const hostelId = await hostel();
    await setRate(hostelId, "single", 1000000, monthStart(-12));
    const residentId = await resident(hostelId);
    await stay(hostelId, residentId, await bed(hostelId), monthStart(-4));
    for (const offset of [-3, -2, -1]) await generate(hostelId, monthStart(offset), 5);

    const invoices = await Promise.all(
      [-3, -2, -1].map((o) => invoiceFor(residentId, monthStart(o))),
    );
    await pay(hostelId, invoices[0]!.id!, 1000000); // paid in full
    await pay(hostelId, invoices[1]!.id!, 250000); // partial, now overdue
    // invoices[2] untouched: overdue

    const { data } = await admin
      .from("resident_balances")
      .select("*")
      .eq("resident_id", residentId)
      .single();
    expect(data).toEqual({
      hostel_id: hostelId,
      resident_id: residentId,
      invoiced: 3000000,
      paid: 1250000,
      outstanding: 1750000,
      overdue: 1750000,
      oldest_overdue_due_date: dayOf(monthStart(-2), 5),
      open_invoices: 2,
    });

    const statuses = await admin
      .from("invoice_balances")
      .select("period_month, due_status")
      .eq("resident_id", residentId)
      .order("period_month");
    expect(statuses.data!.map((row) => row.due_status)).toEqual(["paid", "overdue", "overdue"]);
  });

  it("exclude void invoices and never go negative", async () => {
    const hostelId = await hostel();
    const residentId = await resident(hostelId);
    const paidOff = await notYetDueInvoice(hostelId, residentId, 400000);
    await pay(hostelId, paidOff, 400000);
    const voidedId = (
      await admin
        .from("invoices")
        .insert({
          hostel_id: hostelId,
          resident_id: residentId,
          period_month: monthStart(-1),
          amount: 999999,
          due_date: dayOf(monthStart(-1), 5),
        })
        .select("id")
        .single()
    ).data!.id;
    await owner.client
      .from("invoices")
      .update({ status: "void", void_reason: "Duplicate" })
      .eq("id", voidedId);

    const { data } = await admin
      .from("resident_balances")
      .select("invoiced, paid, outstanding, overdue, open_invoices")
      .eq("resident_id", residentId)
      .single();
    expect(data).toEqual({
      invoiced: 400000,
      paid: 400000,
      outstanding: 0,
      overdue: 0,
      open_invoices: 0,
    });
  });

  it("total each due-status bucket for the fee list", async () => {
    const hostelId = await hostel();
    await setRate(hostelId, "single", 1000000, monthStart(-12));
    const a = await resident(hostelId);
    const b = await resident(hostelId);
    await stay(hostelId, a, await bed(hostelId), monthStart(-3));
    await stay(hostelId, b, await bed(hostelId), monthStart(-3));
    await generate(hostelId, monthStart(-1));
    await pay(hostelId, (await invoiceFor(a, monthStart(-1)))!.id!, 1000000);

    const { data, error } = await owner.client.rpc("fee_status_totals", {
      p_hostel_id: hostelId,
      p_period_month: monthStart(-1),
    });
    expect(error).toBeNull();
    const byStatus = Object.fromEntries(data!.map((row) => [row.due_status, row]));
    expect(byStatus.paid).toMatchObject({
      invoices: 1,
      amount: 1000000,
      paid: 1000000,
      balance: 0,
    });
    expect(byStatus.overdue).toMatchObject({
      invoices: 1,
      amount: 1000000,
      paid: 0,
      balance: 1000000,
    });
  });
});

// ---------------------------------------------------------------------------
// Document numbers (E13-T9)
// ---------------------------------------------------------------------------

describe("invoice and receipt numbers", () => {
  const fy = (() => {
    const [year, month] = todayIst().split("-").map(Number);
    const start = month < 4 ? year - 1 : year;
    return `${String(start % 100).padStart(2, "0")}-${String((start + 1) % 100).padStart(2, "0")}`;
  })();

  async function numbersOf(table: "invoices" | "payments", hostelId: string) {
    const { data } = await admin
      .from(table)
      .select("number")
      .eq("hostel_id", hostelId)
      .order("number");
    return (data ?? []).map((row) => row.number);
  }

  it("run consecutively per hostel, with no gaps even when runs race", async () => {
    const hostelId = await hostel();
    const otherHostelId = await hostel();
    const month = monthStart(-1);
    await setRate(hostelId, "single", 1000000, monthStart(-12));
    await setRate(otherHostelId, "single", 1000000, monthStart(-12));
    for (let i = 0; i < 4; i += 1) {
      await stay(hostelId, await resident(hostelId), await bed(hostelId), monthStart(-2));
    }
    await stay(
      otherHostelId,
      await resident(otherHostelId),
      await bed(otherHostelId),
      monthStart(-2),
    );

    await Promise.all(Array.from({ length: 5 }, () => generate(hostelId, month)));
    await generate(otherHostelId, month);

    expect(await numbersOf("invoices", hostelId)).toEqual(
      [1, 2, 3, 4].map((n) => `INV/${fy}/${String(n).padStart(5, "0")}`),
    );
    expect(await numbersOf("invoices", otherHostelId)).toEqual([`INV/${fy}/00001`]);
  });

  it("keep a void invoice's number and give the regenerated one the next", async () => {
    const hostelId = await hostel();
    const month = monthStart(-1);
    await setRate(hostelId, "single", 1000000, monthStart(-12));
    const residentId = await resident(hostelId);
    await stay(hostelId, residentId, await bed(hostelId), monthStart(-2));
    await generate(hostelId, month);
    const first = await invoiceFor(residentId, month);
    await owner.client
      .from("invoices")
      .update({ status: "void", void_reason: "Wrong month" })
      .eq("id", first!.id!);
    await generate(hostelId, month);

    expect(await numbersOf("invoices", hostelId)).toEqual([`INV/${fy}/00001`, `INV/${fy}/00002`]);
    expect((await invoiceFor(residentId, month))!.number).toBe(`INV/${fy}/00002`);
  });

  it("number receipts in order, ignore a number sent by the client, and skip refused payments", async () => {
    const hostelId = await hostel();
    const invoiceId = await notYetDueInvoice(hostelId, await resident(hostelId), 500000);

    expect((await pay(hostelId, invoiceId, 100000)).error).toBeNull();
    // Over the balance: refused, so it must not use up a number.
    expect((await pay(hostelId, invoiceId, 900000)).error?.hint).toBe("overpayment");
    const forged = await owner.client.from("payments").insert({
      hostel_id: hostelId,
      invoice_id: invoiceId,
      amount: 100000,
      paid_at: todayIst(),
      mode: "cash",
      number: "RCT/99-00/99999",
    });
    expect(forged.error?.code).toBe(PERMISSION_DENIED);
    expect((await pay(hostelId, invoiceId, 100000)).error).toBeNull();

    expect(await numbersOf("payments", hostelId)).toEqual([`RCT/${fy}/00001`, `RCT/${fy}/00002`]);
  });

  it("use India's April-to-March financial year", async () => {
    const sql = connectToDatabase();
    try {
      const [row] = await sql`
        select private.financial_year('2027-03-31') as march,
               private.financial_year('2027-04-01') as april,
               private.financial_year('2099-06-01') as century`;
      expect(row).toEqual({ march: "26-27", april: "27-28", century: "99-00" });
    } finally {
      await sql.end();
    }
  });
});
