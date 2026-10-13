import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { todayIst } from "@/lib/validation";

import { daysFromToday, feeFixtures, monthStart } from "../support/fees";
import { createUserFactory, type TestUser } from "../support/supabase";

/**
 * Collection reports and exports (E13-T12): the same money the dashboard
 * counts, dues by age, and CSV exports that are never cut at 1000 rows.
 */
const PERMISSION_DENIED = "42501";
const { admin, createUser, createHostel, cleanup } = createUserFactory();
afterAll(cleanup);

let owner: TestUser;
let staff: TestUser;
let hostelId: string;
const { resident } = feeFixtures(admin, () => owner);

beforeAll(async () => {
  owner = await createUser({ fullName: "Owner Olga" });
  hostelId = (await createHostel(owner.id)).id;
  staff = await createUser({
    fullName: "Staff Sam",
    profile: { role: "staff", hostel_id: hostelId },
  });
});

async function invoice(target: string, residentId: string, amount: number, dueDaysAgo: number) {
  const due = daysFromToday(-dueDaysAgo);
  const { data, error } = await admin
    .from("invoices")
    .insert({
      hostel_id: target,
      resident_id: residentId,
      period_month: `${due.slice(0, 8)}01`,
      amount,
      due_date: due,
      kind: "charges",
    })
    .select("id")
    .single();
  if (error) throw error;
  return data.id;
}

function pay(user: TestUser, invoiceId: string, amount: number, mode: string, paidAt = todayIst()) {
  return user.client.rpc("record_payment", {
    p_invoice_id: invoiceId,
    p_amount: amount,
    p_paid_at: paidAt,
    p_mode: mode,
    p_reference: mode === "cash" ? undefined : "=HYPERLINK(1)",
  });
}

describe("collections", () => {
  it("count what the dashboard counts, by mode and collector, with deposits beside it", async () => {
    const residentId = await resident(hostelId, { full_name: 'Ann, "The" Tenant' });
    const first = await invoice(hostelId, residentId, 500000, 3);
    const second = await invoice(hostelId, residentId, 300000, 2);

    expect((await pay(owner, first, 200000, "cash")).error).toBeNull();
    expect((await pay(staff, first, 100000, "upi")).error).toBeNull();
    // Beyond the invoice: 200000 pays the rest, 100000 pays the next one.
    expect((await pay(staff, first, 300000, "cash")).error).toBeNull();
    // A cleared cheque counts; a pending one does not.
    const { data: cleared } = await owner.client.rpc("record_cheque", {
      p_invoice_id: second,
      p_amount: 100000,
      p_paid_at: todayIst(),
      p_cheque_number: "1",
      p_bank: "SBI",
    });
    await owner.client.from("payments").update({ cleared_on: todayIst() }).eq("id", cleared!);
    await owner.client.rpc("record_cheque", {
      p_invoice_id: second,
      p_amount: 50000,
      p_paid_at: todayIst(),
      p_cheque_number: "2",
      p_bank: "SBI",
    });
    await staff.client.rpc("record_deposit", {
      p_resident_id: residentId,
      p_amount: 900000,
      p_paid_at: todayIst(),
      p_mode: "cash",
    });

    const range = { p_hostel_id: hostelId, p_from: daysFromToday(-5), p_to: todayIst() };
    const { data: report, error } = await staff.client.rpc("collections_report", range);
    expect(error).toBeNull();
    const { data: dashboard } = await owner.client.rpc("dashboard_money", range);
    const money = report as {
      total: number;
      count: number;
      by_mode: { mode: string; amount: number }[];
      by_collector: { collector: string; amount: number }[];
      days: unknown[];
      deposits: { amount: number; count: number };
    };
    expect(money.total).toBe(dashboard![0].collected);
    expect(money.total).toBe(200000 + 100000 + 300000 + 100000);
    expect(money.count).toBe(dashboard![0].payments);
    expect(money.by_mode).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ mode: "cash", amount: 500000 }),
        expect.objectContaining({ mode: "upi", amount: 100000 }),
        expect.objectContaining({ mode: "cheque", amount: 100000 }),
      ]),
    );
    expect(money.by_collector).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ collector: "Owner Olga", amount: 300000 }),
        expect.objectContaining({ collector: "Staff Sam", amount: 400000 }),
      ]),
    );
    expect(money.deposits).toEqual({ amount: 900000, count: 1 });

    const { data: csv } = await owner.client.rpc("collections_csv", range);
    const lines = (csv as string).trim().split("\n");
    expect(lines[0]).toBe("Date,Receipt,Resident,Mode,Reference,Collected by,Amount (INR),For");
    expect(lines).toHaveLength(1 + money.count);
    // Quotes doubled; a formula is defused.
    expect(csv).toContain('"Ann, ""The"" Tenant"');
    expect(csv).toContain(`"'=HYPERLINK(1)"`);
    expect(csv).toContain(",2000.00,");
  });

  it("are refused outside the caller's hostels", async () => {
    const outsider = await createUser();
    for (const call of [
      outsider.client.rpc("collections_report", {
        p_hostel_id: hostelId,
        p_from: todayIst(),
        p_to: todayIst(),
      }),
      outsider.client.rpc("collections_csv", {
        p_hostel_id: hostelId,
        p_from: todayIst(),
        p_to: todayIst(),
      }),
      outsider.client.rpc("dues_ageing", { p_hostel_id: hostelId }),
      outsider.client.rpc("fee_register_csv", { p_hostel_id: hostelId, p_month: monthStart() }),
    ]) {
      expect((await call).error?.code).toBe(PERMISSION_DENIED);
    }
  });
});

describe("dues ageing", () => {
  it("puts each open balance in its bucket by days past due", async () => {
    const target = (await createHostel(owner.id)).id;
    const residentId = await resident(target, { full_name: "Bala" });
    await invoice(target, residentId, 100, -5);
    await invoice(target, residentId, 200, 0);
    await invoice(target, residentId, 300, 30);
    await invoice(target, residentId, 400, 31);
    await invoice(target, residentId, 500, 61);
    await invoice(target, residentId, 600, 91);
    const paid = await invoice(target, residentId, 700, 120);
    await pay(owner, paid, 700, "cash");

    const { data } = await owner.client.rpc("dues_ageing", { p_hostel_id: target });
    expect(data).toMatchObject({
      buckets: { not_due: 300, d30: 300, d60: 400, d90: 500, over90: 600 },
      total: 2100,
      residents: [{ name: "Bala", total: 2100, over90: 600 }],
    });
  });
});

describe("fee register", () => {
  it("lists the month's invoices, lines and money, past 1000 rows", async () => {
    const target = (await createHostel(owner.id)).id;
    const residentId = await resident(target, { full_name: "Chitra" });
    const month = monthStart(0);
    const rows = Array.from({ length: 1100 }, () => ({
      hostel_id: target,
      resident_id: residentId,
      period_month: month,
      amount: 100,
      due_date: todayIst(),
      kind: "charges",
    }));
    const { data: invoices, error } = await admin.from("invoices").insert(rows).select("id");
    if (error) throw error;
    const { error: paymentError } = await admin.from("payments").insert(
      invoices.map((row) => ({
        hostel_id: target,
        invoice_id: row.id,
        amount: 100,
        paid_at: todayIst(),
        mode: "cash",
        recorded_by: owner.id,
      })),
    );
    if (paymentError) throw paymentError;

    const { data: csv, error: csvError } = await owner.client.rpc("fee_register_csv", {
      p_hostel_id: target,
      p_month: month,
    });
    expect(csvError).toBeNull();
    const lines = (csv as string).trim().split("\n");
    expect(lines[0]).toBe(
      "Record,Date,Number,Resident,Description,Mode,Reference,Amount (INR),Status,Invoice",
    );
    expect(lines.filter((line) => line.startsWith('"Invoice",'))).toHaveLength(1100);
    expect(lines.filter((line) => line.startsWith('"Payment",'))).toHaveLength(1100);

    const { data: collected } = await owner.client.rpc("collections_csv", {
      p_hostel_id: target,
      p_from: month,
      p_to: todayIst(),
    });
    expect((collected as string).trim().split("\n")).toHaveLength(1101);
  }, 60_000);
});
