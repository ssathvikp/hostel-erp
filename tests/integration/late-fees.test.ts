import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { todayIst } from "@/lib/validation";

import { residentRow } from "../support/residents";
import { createUserFactory, type TestUser } from "../support/supabase";

/**
 * Late fees (ClickUp E13-T6): a per-hostel rule, charged as separate
 * late-fee invoices, once per rent invoice, waived by voiding with a reason.
 */
const PERMISSION_DENIED = "42501";

const { admin, createUser, createHostel, cleanup } = createUserFactory();

afterAll(cleanup);

let owner: TestUser;
let staff: TestUser;
let staffHostelId: string;

function addDays(date: string, days: number): string {
  const value = new Date(`${date}T00:00:00Z`);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}

const today = todayIst();

beforeAll(async () => {
  owner = await createUser();
  staffHostelId = (await createHostel(owner.id)).id;
  staff = await createUser({ profile: { role: "staff", hostel_id: staffHostelId } });
});

type Rule = {
  late_fee_mode: "off" | "fixed" | "per_day";
  late_fee_amount?: number | null;
  late_fee_cap?: number | null;
  late_fee_grace_days?: number;
};

/** A hostel with the rule switched on long ago, so every test invoice counts. */
async function hostelWith(rule: Rule, since = "2020-01-01"): Promise<string> {
  const id = (await createHostel(owner.id)).id;
  const { error } = await admin
    .from("hostels")
    .update({ late_fee_grace_days: 3, ...rule, late_fee_since: since })
    .eq("id", id);
  if (error) throw error;
  return id;
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

/** A rent invoice due on `dueDate`, for a new resident. */
async function rentInvoice(hostelId: string, dueDate: string, amount = 800000) {
  const residentId = await resident(hostelId);
  const { data, error } = await admin
    .from("invoices")
    .insert({
      hostel_id: hostelId,
      resident_id: residentId,
      period_month: `${dueDate.slice(0, 7)}-01`,
      amount,
      due_date: dueDate,
      breakdown: [],
    })
    .select("id")
    .single();
  if (error) throw error;
  return { invoiceId: data.id, residentId };
}

async function pay(hostelId: string, invoiceId: string, amount: number, paidAt: string) {
  const { error } = await admin.from("payments").insert({
    hostel_id: hostelId,
    invoice_id: invoiceId,
    amount,
    paid_at: paidAt,
    mode: "cash",
    recorded_by: owner.id,
  });
  if (error) throw error;
}

async function apply(hostelId: string, client = owner.client) {
  return client.rpc("apply_late_fees", { p_hostel_id: hostelId });
}

async function lateFees(hostelId: string) {
  const { data, error } = await admin
    .from("invoices")
    .select("id, amount, due_date, period_month, late_fee_for, status, resident_id, breakdown")
    .eq("hostel_id", hostelId)
    .eq("kind", "late_fee");
  if (error) throw error;
  return data;
}

describe("the rule", () => {
  it("is set by the owner, stamped with today's date, and cleared when switched off", async () => {
    const id = (await createHostel(owner.id)).id;
    const on = await owner.client
      .from("hostels")
      .update({ late_fee_mode: "fixed", late_fee_amount: 20000, late_fee_grace_days: 2 })
      .eq("id", id)
      .select("late_fee_since")
      .single();
    expect(on.error).toBeNull();
    expect(on.data?.late_fee_since).toBe(today);

    // An owner can never backdate the rule.
    const backdate = await owner.client
      .from("hostels")
      .update({ late_fee_since: "2020-01-01" })
      .eq("id", id);
    expect(backdate.error?.code).toBe(PERMISSION_DENIED);

    const off = await owner.client
      .from("hostels")
      .update({ late_fee_mode: "off" })
      .eq("id", id)
      .select("late_fee_amount, late_fee_since")
      .single();
    expect(off.data).toEqual({ late_fee_amount: null, late_fee_since: null });
  });

  it("refuses a per-day fee without a cap, or a cap below the daily fee", async () => {
    const id = (await createHostel(owner.id)).id;
    for (const change of [
      { late_fee_mode: "per_day", late_fee_amount: 5000 },
      { late_fee_mode: "per_day", late_fee_amount: 5000, late_fee_cap: 4000 },
      { late_fee_mode: "fixed", late_fee_amount: 0 },
    ]) {
      const { error } = await owner.client.from("hostels").update(change).eq("id", id);
      expect(error?.code).toBe("23514");
    }
  });

  it("cannot be changed by staff", async () => {
    const { data } = await staff.client
      .from("hostels")
      .update({ late_fee_mode: "fixed", late_fee_amount: 100 })
      .eq("id", staffHostelId)
      .select("id");
    expect(data ?? []).toEqual([]);
  });
});

describe("a fixed late fee", () => {
  it("is charged once for rent still owed after the grace days, however often it runs", async () => {
    const hostelId = await hostelWith({ late_fee_mode: "fixed", late_fee_amount: 25000 });
    const { invoiceId, residentId } = await rentInvoice(hostelId, addDays(today, -10));

    const first = await apply(hostelId);
    expect(first.error).toBeNull();
    expect(first.data).toEqual({ applied: 1, total_amount: 25000, waiting: 0 });

    // Again, and many times at once: nothing new.
    const again = await Promise.all([1, 2, 3, 4].map(() => apply(hostelId)));
    for (const run of again) expect(run.data).toMatchObject({ applied: 0 });

    const fees = await lateFees(hostelId);
    expect(fees).toHaveLength(1);
    expect(fees[0]).toMatchObject({
      amount: 25000,
      due_date: today,
      late_fee_for: invoiceId,
      resident_id: residentId,
      status: "issued",
    });
    expect(fees[0].breakdown).toEqual([
      expect.objectContaining({ type: "late_fee", rule: "fixed", days_late: 7, grace_days: 3 }),
    ]);

    // It is owed like any other invoice.
    const { data: balance } = await owner.client
      .from("resident_balances")
      .select("outstanding")
      .eq("resident_id", residentId)
      .single();
    expect(balance?.outstanding).toBe(800000 + 25000);
  });

  it("is not charged within the grace days, or when rent was paid on time", async () => {
    const hostelId = await hostelWith({ late_fee_mode: "fixed", late_fee_amount: 25000 });
    await rentInvoice(hostelId, addDays(today, -3)); // last grace day is today
    const onTime = await rentInvoice(hostelId, addDays(today, -20));
    await pay(hostelId, onTime.invoiceId, 800000, addDays(today, -19));

    const { data } = await apply(hostelId);
    expect(data).toEqual({ applied: 0, total_amount: 0, waiting: 0 });
  });

  it("is charged when rent was paid in full, but late", async () => {
    const hostelId = await hostelWith({ late_fee_mode: "fixed", late_fee_amount: 25000 });
    const { invoiceId } = await rentInvoice(hostelId, addDays(today, -20));
    await pay(hostelId, invoiceId, 300000, addDays(today, -19));
    await pay(hostelId, invoiceId, 500000, addDays(today, -12));

    const { data } = await apply(hostelId);
    expect(data).toMatchObject({ applied: 1 });
    const [fee] = await lateFees(hostelId);
    expect(fee.breakdown).toEqual([
      expect.objectContaining({ settled_on: addDays(today, -12), days_late: 5 }),
    ]);
  });

  it("ignores rent due before the rule was switched on", async () => {
    const hostelId = await hostelWith(
      { late_fee_mode: "fixed", late_fee_amount: 25000 },
      addDays(today, -5),
    );
    await rentInvoice(hostelId, addDays(today, -25));
    const { data } = await apply(hostelId);
    expect(data).toMatchObject({ applied: 0 });
  });
});

describe("a per-day late fee", () => {
  it("waits while rent is owed and under the cap, then charges once it is paid", async () => {
    const hostelId = await hostelWith({
      late_fee_mode: "per_day",
      late_fee_amount: 5000,
      late_fee_cap: 100000,
    });
    const { invoiceId } = await rentInvoice(hostelId, addDays(today, -8)); // 5 days late

    const waiting = await apply(hostelId);
    expect(waiting.data).toEqual({ applied: 0, total_amount: 0, waiting: 1 });

    await pay(hostelId, invoiceId, 800000, addDays(today, -1)); // 4 days late
    const paid = await apply(hostelId);
    expect(paid.data).toEqual({ applied: 1, total_amount: 20000, waiting: 0 });
  });

  it("stops at the cap, and is charged as soon as the cap is reached", async () => {
    const hostelId = await hostelWith({
      late_fee_mode: "per_day",
      late_fee_amount: 5000,
      late_fee_cap: 30000,
    });
    await rentInvoice(hostelId, addDays(today, -20)); // 17 days late, cap at 6
    const { data } = await apply(hostelId);
    expect(data).toEqual({ applied: 1, total_amount: 30000, waiting: 0 });
  });
});

describe("waiving and voiding", () => {
  it("lets the owner waive a late fee, which is then never charged again", async () => {
    const hostelId = await hostelWith({ late_fee_mode: "fixed", late_fee_amount: 25000 });
    const { invoiceId } = await rentInvoice(hostelId, addDays(today, -10));
    await apply(hostelId);
    const [fee] = await lateFees(hostelId);

    // The rent cannot be voided while its late fee stands.
    const blocked = await owner.client
      .from("invoices")
      .update({ status: "void", void_reason: "Issued in error" })
      .eq("id", invoiceId);
    expect(blocked.error?.hint).toBe("invoice_has_late_fee");

    const waive = await owner.client
      .from("invoices")
      .update({ status: "void", void_reason: "First time, let off" })
      .eq("id", fee.id);
    expect(waive.error).toBeNull();

    const { data } = await apply(hostelId);
    expect(data).toMatchObject({ applied: 0 });
    expect(await lateFees(hostelId)).toHaveLength(1);

    // With the fee waived, the rent can be voided again.
    const voided = await owner.client
      .from("invoices")
      .update({ status: "void", void_reason: "Issued in error" })
      .eq("id", invoiceId);
    expect(voided.error).toBeNull();
  });

  it("takes payments like any invoice", async () => {
    const hostelId = await hostelWith({ late_fee_mode: "fixed", late_fee_amount: 25000 });
    await rentInvoice(hostelId, addDays(today, -10));
    await apply(hostelId);
    const [fee] = await lateFees(hostelId);
    const { error } = await staff.client.from("payments").insert({
      hostel_id: hostelId,
      invoice_id: fee.id,
      amount: 25000,
      paid_at: today,
      mode: "upi",
    });
    // Staff of another hostel cannot; the fee belongs to hostelId.
    expect(error).not.toBeNull();
    const own = await owner.client.from("payments").insert({
      hostel_id: hostelId,
      invoice_id: fee.id,
      amount: 25000,
      paid_at: today,
      mode: "upi",
    });
    expect(own.error).toBeNull();
  });
});

describe("access", () => {
  it("lets only the owner charge late fees", async () => {
    const hostelId = await hostelWith({ late_fee_mode: "fixed", late_fee_amount: 25000 });
    const { error: staffError } = await apply(staffHostelId, staff.client);
    expect(staffError?.code).toBe(PERMISSION_DENIED);

    const stranger = await createUser();
    const { error: strangerError } = await apply(hostelId, stranger.client);
    expect(strangerError?.code).toBe(PERMISSION_DENIED);
  });

  it("refuses when the rule is off", async () => {
    const id = (await createHostel(owner.id)).id;
    const { error } = await apply(id);
    expect(error?.hint).toBe("late_fees_off");
  });

  it("never lets a user write a late fee directly", async () => {
    const hostelId = await hostelWith({ late_fee_mode: "fixed", late_fee_amount: 25000 });
    const { invoiceId, residentId } = await rentInvoice(hostelId, addDays(today, -10));
    const { error } = await owner.client.from("invoices").insert({
      hostel_id: hostelId,
      resident_id: residentId,
      period_month: `${today.slice(0, 7)}-01`,
      amount: 100,
      due_date: today,
      kind: "late_fee",
      late_fee_for: invoiceId,
    });
    expect(error?.code).toBe(PERMISSION_DENIED);
  });
});
