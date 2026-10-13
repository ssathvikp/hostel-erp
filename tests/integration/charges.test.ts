import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { todayIst } from "@/lib/validation";

import { connectToDatabase } from "../support/db";
import { daysFromToday, dayOf, feeFixtures, monthStart } from "../support/fees";
import { createUserFactory, type TestUser } from "../support/supabase";

/**
 * One-off charges, discounts and late fees (E13-T2, E13-T5, E13-T6), run
 * as real owners and staff through the tables and functions the app uses.
 */
const PERMISSION_DENIED = "42501";
const { admin, createUser, createHostel, cleanup } = createUserFactory();
afterAll(cleanup);

let owner: TestUser;
let staff: TestUser;
let staffHostelId: string;
const { resident, bed, stay, setRate, generate, invoiceFor, billedResident } = feeFixtures(
  admin,
  () => owner,
);

beforeAll(async () => {
  owner = await createUser();
  staffHostelId = (await createHostel(owner.id)).id;
  staff = await createUser({ profile: { role: "staff", hostel_id: staffHostelId } });
});

async function hostel() {
  return (await createHostel(owner.id)).id;
}

function charge(
  user: TestUser,
  hostelId: string,
  residentId: string,
  amount: number,
  { date = todayIst(), description = "Key replacement" } = {},
) {
  return user.client
    .from("resident_charges")
    .insert({
      hostel_id: hostelId,
      resident_id: residentId,
      description,
      amount,
      charge_date: date,
    })
    .select("id, status")
    .single();
}

async function chargeRow(id: string) {
  const { data } = await admin
    .from("resident_charges")
    .select("status, invoice_id, amount")
    .eq("id", id)
    .single();
  return data!;
}

describe("charges", () => {
  it("are added by staff, billed once on the next monthly invoice, after rent", async () => {
    const residentId = await billedResident(staffHostelId);
    const month = monthStart(-1);
    const { data: added, error } = await charge(staff, staffHostelId, residentId, 50000, {
      date: dayOf(month, 20),
    });
    expect(error).toBeNull();
    expect(added!.status).toBe("pending");
    // Dated after the month being billed: waits for a later invoice.
    const { data: later } = await charge(owner, staffHostelId, residentId, 20000, {
      date: todayIst() > dayOf(monthStart(0), 1) ? todayIst() : dayOf(monthStart(0), 1),
      description: "Laundry",
    });

    await generate(staffHostelId, month);
    const invoice = await invoiceFor(residentId, month);
    expect(invoice!.invoice_lines.map((l) => [l.kind, l.amount])).toEqual([
      ["rent", 1000000],
      ["charge", 50000],
    ]);
    expect(invoice!.amount).toBe(1050000);
    expect(await chargeRow(added!.id)).toMatchObject({
      status: "invoiced",
      invoice_id: invoice!.id,
    });
    expect((await chargeRow(later!.id)).status).toBe("pending");
  });

  it("go back to pending when their invoice is voided, and are billed again", async () => {
    const hostelId = await hostel();
    const month = monthStart(-1);
    const residentId = await billedResident(hostelId);
    const { data: added } = await charge(owner, hostelId, residentId, 30000, {
      date: dayOf(month, 3),
    });
    await generate(hostelId, month);
    const first = await invoiceFor(residentId, month);
    await owner.client
      .from("invoices")
      .update({ status: "void", void_reason: "Wrong rent" })
      .eq("id", first!.id);
    expect(await chargeRow(added!.id)).toMatchObject({ status: "pending", invoice_id: null });

    await generate(hostelId, month);
    const second = await invoiceFor(residentId, month);
    expect(second!.amount).toBe(1030000);
    expect((await chargeRow(added!.id)).invoice_id).toBe(second!.id);
  });

  it("are voided only while pending, only by owners, and never forged as billed", async () => {
    const residentId = await resident(staffHostelId);
    const { data: added } = await charge(staff, staffHostelId, residentId, 10000);

    const byStaff = await staff.client
      .from("resident_charges")
      .update({ status: "void", void_reason: "Mistake" })
      .eq("id", added!.id)
      .select("id");
    expect(byStaff.data).toEqual([]);
    const byOwner = await owner.client
      .from("resident_charges")
      .update({ status: "void", void_reason: "Mistake" })
      .eq("id", added!.id);
    expect(byOwner.error).toBeNull();
    expect((await chargeRow(added!.id)).status).toBe("void");
    const again = await owner.client
      .from("resident_charges")
      .update({ status: "pending", void_reason: null })
      .eq("id", added!.id);
    expect(again.error?.hint).toBe("charge_not_pending");

    const forged = await owner.client.from("resident_charges").insert({
      hostel_id: staffHostelId,
      resident_id: residentId,
      description: "Fake late fee",
      amount: 10000,
      charge_date: todayIst(),
      kind: "late_fee",
    });
    expect(forged.error).not.toBeNull();
  });

  it("can be billed now on an invoice of their own", async () => {
    const hostelId = await hostel();
    const residentId = await resident(hostelId);
    expect(
      (await owner.client.rpc("bill_pending_charges", { p_resident_id: residentId })).data,
    ).toBeNull();
    await charge(owner, hostelId, residentId, 40000, { description: "Damage" });
    await charge(owner, hostelId, residentId, 10000, { description: "Key" });

    const { data: invoiceId, error } = await owner.client.rpc("bill_pending_charges", {
      p_resident_id: residentId,
    });
    expect(error).toBeNull();
    const { data: invoice } = await admin
      .from("invoices")
      .select("kind, amount, due_date, number, invoice_lines(kind, amount)")
      .eq("id", invoiceId!)
      .single();
    expect(invoice).toMatchObject({ kind: "charges", amount: 50000, due_date: todayIst() });
    expect(invoice!.number).toMatch(/^INV\//);
    expect(invoice!.invoice_lines).toHaveLength(2);

    // Staff record charges but only owners issue invoices.
    const staffResident = await resident(staffHostelId);
    await charge(staff, staffHostelId, staffResident, 10000);
    const byStaff = await staff.client.rpc("bill_pending_charges", {
      p_resident_id: staffResident,
    });
    expect(byStaff.error?.code).toBe(PERMISSION_DENIED);
  });

  it("add an admission fee on a resident's first stay only", async () => {
    const hostelId = await hostel();
    const { data: head } = await owner.client
      .from("fee_heads")
      .insert({
        hostel_id: hostelId,
        name: "Admission",
        billing: "one_time",
        pricing: "flat",
        charge_on_first_stay: true,
      })
      .select("id")
      .single();
    await owner.client.rpc("set_fee_head_rate", {
      p_fee_head_id: head!.id,
      p_amount: 200000,
      p_effective_from: monthStart(-12),
    });
    const residentId = await resident(hostelId);
    await stay(hostelId, residentId, await bed(hostelId), monthStart(-2), {
      end: dayOf(monthStart(-2), 10),
    });
    await stay(hostelId, residentId, await bed(hostelId), dayOf(monthStart(-1), 1));

    const { data } = await admin
      .from("resident_charges")
      .select("description, amount, charge_date")
      .eq("resident_id", residentId);
    expect(data).toEqual([
      { description: "Admission", amount: 200000, charge_date: monthStart(-2) },
    ]);
  });
});

describe("discounts", () => {
  async function discount(
    user: TestUser,
    hostelId: string,
    residentId: string,
    fields: {
      fee_head_id?: string;
      percent?: number;
      amount?: number;
      from_month?: string;
      to_month?: string;
    },
  ) {
    return user.client.from("discounts").insert({
      hostel_id: hostelId,
      resident_id: residentId,
      reason: "Sibling",
      from_month: monthStart(-6),
      ...fields,
    });
  }

  it("come off the line they name, as negative lines, never below zero", async () => {
    const hostelId = await hostel();
    const month = monthStart(-1);
    await setRate(hostelId, "single", 1000000, monthStart(-12));
    const { data: head } = await owner.client
      .from("fee_heads")
      .insert({ hostel_id: hostelId, name: "Mess", billing: "monthly", pricing: "flat" })
      .select("id")
      .single();
    await owner.client.rpc("set_fee_head_rate", {
      p_fee_head_id: head!.id,
      p_amount: 300000,
      p_effective_from: monthStart(-12),
    });
    const residentId = await resident(hostelId);
    await stay(hostelId, residentId, await bed(hostelId), monthStart(-2));

    expect((await discount(owner, hostelId, residentId, { percent: 10 })).error).toBeNull();
    await discount(owner, hostelId, residentId, { fee_head_id: head!.id, amount: 500000 });
    // Ended before the month billed: not applied.
    await discount(owner, hostelId, residentId, {
      amount: 100,
      from_month: monthStart(-6),
      to_month: monthStart(-3),
    });

    await generate(hostelId, month);
    const invoice = await invoiceFor(residentId, month);
    expect(invoice!.invoice_lines.map((l) => [l.kind, l.amount])).toEqual([
      ["rent", 1000000],
      ["fee", 300000],
      ["discount", -100000],
      ["discount", -300000],
    ]);
    expect(invoice!.amount).toBe(900000);
  });

  it("are given by owners only and can only be ended", async () => {
    const residentId = await resident(staffHostelId);
    const byStaff = await discount(staff, staffHostelId, residentId, { percent: 5 });
    expect(byStaff.error?.code).toBe(PERMISSION_DENIED);

    const { data } = await owner.client
      .from("discounts")
      .insert({
        hostel_id: staffHostelId,
        resident_id: residentId,
        reason: "Long stay",
        percent: 5,
        from_month: monthStart(-1),
      })
      .select("id")
      .single();
    const ended = await owner.client
      .from("discounts")
      .update({ to_month: monthStart(0) })
      .eq("id", data!.id);
    expect(ended.error).toBeNull();
    const extended = await owner.client
      .from("discounts")
      .update({ to_month: monthStart(2) })
      .eq("id", data!.id);
    expect(extended.error?.hint).toBe("discount_end_only");
    const both = await discount(owner, staffHostelId, residentId, { percent: 5, amount: 100 });
    expect(both.error?.code).toBe("23514");
  });
});

describe("late fees", () => {
  async function overdueInvoice(hostelId: string, dueDaysAgo: number, amount = 500000) {
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
      .select("id, number")
      .single();
    if (error) throw error;
    return { residentId, invoiceId: data.id, number: data.number };
  }

  async function lateFeeOn(invoiceId: string) {
    const { data } = await admin
      .from("resident_charges")
      .select("id, amount, status, description")
      .eq("for_invoice_id", invoiceId);
    return data ?? [];
  }

  it("apply a fixed fee once the grace days pass, and only once", async () => {
    const hostelId = await hostel();
    await owner.client
      .from("late_fee_rules")
      .insert({ hostel_id: hostelId, grace_days: 3, kind: "fixed", amount: 20000 });
    const late = await overdueInvoice(hostelId, 5);
    const withinGrace = await overdueInvoice(hostelId, 2);

    expect((await owner.client.rpc("apply_late_fees", { p_hostel_id: hostelId })).data).toBe(1);
    expect((await owner.client.rpc("apply_late_fees", { p_hostel_id: hostelId })).data).toBe(0);
    expect(await lateFeeOn(late.invoiceId)).toMatchObject([
      { amount: 20000, status: "pending", description: `Late fee on ${late.number}` },
    ]);
    expect(await lateFeeOn(withinGrace.invoiceId)).toEqual([]);
  });

  it("grow by the day up to the cap while unpaid, and stop once billed", async () => {
    const hostelId = await hostel();
    await owner.client.from("late_fee_rules").insert({
      hostel_id: hostelId,
      grace_days: 0,
      kind: "per_day",
      amount: 1000,
      cap: 15000,
    });
    const { invoiceId } = await overdueInvoice(hostelId, 10);
    await owner.client.rpc("apply_late_fees", { p_hostel_id: hostelId });
    expect((await lateFeeOn(invoiceId))[0].amount).toBe(10000);

    const capped = await overdueInvoice(hostelId, 40);
    await owner.client.rpc("apply_late_fees", { p_hostel_id: hostelId });
    expect((await lateFeeOn(capped.invoiceId))[0].amount).toBe(15000);

    // Billed: a later run never changes it.
    const fee = (await lateFeeOn(invoiceId))[0];
    await owner.client.rpc("bill_pending_charges", {
      p_resident_id: (
        await admin.from("invoices").select("resident_id").eq("id", invoiceId).single()
      ).data!.resident_id,
    });
    expect((await chargeRow(fee.id)).status).toBe("invoiced");
  });

  it("skip paid invoices and never come back once waived", async () => {
    const hostelId = await hostel();
    await owner.client
      .from("late_fee_rules")
      .insert({ hostel_id: hostelId, grace_days: 0, kind: "fixed", amount: 20000 });
    const paid = await overdueInvoice(hostelId, 5, 100000);
    await owner.client.from("payments").insert({
      hostel_id: hostelId,
      invoice_id: paid.invoiceId,
      amount: 100000,
      paid_at: todayIst(),
      mode: "cash",
    });
    const waived = await overdueInvoice(hostelId, 5);
    await owner.client.rpc("apply_late_fees", { p_hostel_id: hostelId });
    expect(await lateFeeOn(paid.invoiceId)).toEqual([]);

    const fee = (await lateFeeOn(waived.invoiceId))[0];
    await owner.client
      .from("resident_charges")
      .update({ status: "void", void_reason: "First time, waived" })
      .eq("id", fee.id);
    await owner.client.rpc("apply_late_fees", { p_hostel_id: hostelId });
    expect(await lateFeeOn(waived.invoiceId)).toMatchObject([{ status: "void" }]);
  });

  it("are applied only by the owner, or by the daily job", async () => {
    await owner.client
      .from("late_fee_rules")
      .insert({ hostel_id: staffHostelId, grace_days: 0, kind: "fixed", amount: 10000 });
    const byStaff = await staff.client.rpc("apply_late_fees", { p_hostel_id: staffHostelId });
    expect(byStaff.error?.code).toBe(PERMISSION_DENIED);
    const outsider = await createUser();
    const byOutsider = await outsider.client.rpc("apply_late_fees", { p_hostel_id: staffHostelId });
    expect(byOutsider.error?.code).toBe(PERMISSION_DENIED);

    const sql = connectToDatabase();
    try {
      const jobs =
        await sql`select schedule, command from cron.job where jobname = 'apply-late-fees'`;
      expect(jobs).toEqual([
        { schedule: "0 19 * * *", command: "select private.apply_all_late_fees()" },
      ]);
    } finally {
      await sql.end();
    }
  });
});
