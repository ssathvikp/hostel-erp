import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { todayIst } from "@/lib/validation";

import { residentRow } from "../support/residents";
import { anonClient, createUserFactory, type Client, type TestUser } from "../support/supabase";

/**
 * Tenant isolation for fee structures, invoices, payments, the balance
 * views and the fee functions (E7-T1, E9-T1). Owner B and B's staff attack
 * hostel A's rows; anonymous visitors see nothing.
 */
const { admin, createUser, createHostel, cleanup } = createUserFactory();

/** Every fee table and view; each has a hostel_id column. */
const FEE_RELATIONS = [
  "fee_structures",
  "invoices",
  "payments",
  "invoice_balances",
  "resident_balances",
] as const;

// Tables and views have separate overloads; every relation here has hostel_id.
const fromRelation = (client: Client, relation: (typeof FEE_RELATIONS)[number]) =>
  client.from(relation as "invoices");

let ownerA: TestUser;
let ownerB: TestUser;
let staffB: TestUser;
let hostelA: string;
let hostelB: string;
let residentA: string;
let residentB: string;
let structureA: string;
let invoiceA: string;
let invoiceB: string;
let paymentA: string;

afterAll(cleanup);

const month = todayIst().slice(0, 8) + "01";
const monthEnd = (() => {
  const [year, m] = month.split("-").map(Number);
  return new Date(Date.UTC(year, m, 0)).toISOString().slice(0, 10);
})();

async function invoice(hostelId: string, residentId: string) {
  const { data, error } = await admin
    .from("invoices")
    .insert({
      hostel_id: hostelId,
      resident_id: residentId,
      period_month: month,
      amount: 500000,
      due_date: monthEnd,
    })
    .select("id")
    .single();
  if (error) throw error;
  return data.id;
}

beforeAll(async () => {
  [ownerA, ownerB] = await Promise.all([createUser(), createUser()]);
  hostelA = (await createHostel(ownerA.id)).id;
  hostelB = (await createHostel(ownerB.id)).id;
  staffB = await createUser({ profile: { role: "staff", hostel_id: hostelB } });
  residentA = (await admin.from("residents").insert(residentRow(hostelA)).select("id").single())
    .data!.id;
  residentB = (await admin.from("residents").insert(residentRow(hostelB)).select("id").single())
    .data!.id;

  const { data: structure, error } = await ownerA.client.rpc("set_fee_structure", {
    p_hostel_id: hostelA,
    p_sharing_type: "double",
    p_monthly_amount: 800000,
    p_effective_from: "2026-01-01",
  });
  if (error) throw error;
  structureA = structure;
  await ownerB.client.rpc("set_fee_structure", {
    p_hostel_id: hostelB,
    p_sharing_type: "double",
    p_monthly_amount: 700000,
    p_effective_from: "2026-01-01",
  });

  invoiceA = await invoice(hostelA, residentA);
  invoiceB = await invoice(hostelB, residentB);
  const { data: payment, error: paymentError } = await ownerA.client
    .from("payments")
    .insert({
      hostel_id: hostelA,
      invoice_id: invoiceA,
      amount: 100000,
      paid_at: todayIst(),
      mode: "cash",
    })
    .select("id")
    .single();
  if (paymentError) throw paymentError;
  paymentA = payment.id;
});

describe.each([
  ["owner of another hostel", () => ownerB],
  ["staff of another hostel", () => staffB],
])("as the %s", (_label, attacker) => {
  it("cannot read hostel A's rates, invoices, payments or balances", async () => {
    const client = attacker().client;
    for (const table of FEE_RELATIONS) {
      const { data, error } = await fromRelation(client, table)
        .select("hostel_id")
        .eq("hostel_id", hostelA);
      expect(error).toBeNull();
      expect(data, table).toEqual([]);
    }
    const totals = await client.rpc("fee_status_totals", { p_hostel_id: hostelA });
    expect(totals.data).toEqual([]);
  });

  it("cannot change hostel A's rates, void its invoices or void its payments", async () => {
    const client = attacker().client;
    await client.from("fee_structures").update({ monthly_amount: 1 }).eq("id", structureA);
    await client
      .from("invoices")
      .update({ status: "void", void_reason: "attack" })
      .eq("id", invoiceA);
    await client.from("payments").update({ void_reason: "attack" }).eq("id", paymentA);

    const [{ data: structure }, { data: inv }, { data: payment }] = await Promise.all([
      admin.from("fee_structures").select("monthly_amount").eq("id", structureA).single(),
      admin.from("invoices").select("status").eq("id", invoiceA).single(),
      admin.from("payments").select("voided_at").eq("id", paymentA).single(),
    ]);
    expect(structure!.monthly_amount).toBe(800000);
    expect(inv!.status).toBe("issued");
    expect(payment!.voided_at).toBeNull();
  });

  it("cannot delete anything in hostel A", async () => {
    const client = attacker().client;
    for (const [table, id] of [
      ["payments", paymentA],
      ["invoices", invoiceA],
      ["fee_structures", structureA],
    ] as const) {
      await client.from(table).delete().eq("id", id);
      const { count } = await admin
        .from(table)
        .select("id", { count: "exact", head: true })
        .eq("id", id);
      expect(count, table).toBe(1);
    }
  });

  it("cannot record a payment into hostel A, directly or by pointing at A's invoice", async () => {
    const client = attacker().client;
    const intoA = await client.from("payments").insert({
      hostel_id: hostelA,
      invoice_id: invoiceA,
      amount: 100,
      paid_at: todayIst(),
      mode: "cash",
    });
    // The payment guard cannot even see A's invoice, so it stops first.
    expect(intoA.error?.hint).toBe("invoice_not_found");
    // Own hostel id, but A's invoice: the composite key refuses it.
    const crossed = await client.from("payments").insert({
      hostel_id: hostelB,
      invoice_id: invoiceA,
      amount: 100,
      paid_at: todayIst(),
      mode: "cash",
    });
    expect(crossed.error).not.toBeNull();
  });

  it("cannot set rates or generate invoices for hostel A", async () => {
    const client = attacker().client;
    const rate = await client.rpc("set_fee_structure", {
      p_hostel_id: hostelA,
      p_sharing_type: "single",
      p_monthly_amount: 100,
      p_effective_from: "2026-01-01",
    });
    expect(rate.error?.code).toBe("42501");
    const generate = await client.rpc("generate_invoices", {
      p_hostel_id: hostelA,
      p_period_month: month,
    });
    expect(generate.error?.hint).toBe("hostel_not_found");
  });
});

describe("cross-hostel references", () => {
  it("reject an invoice in my hostel for another hostel's resident", async () => {
    const { error } = await ownerB.client.from("invoices").insert({
      hostel_id: hostelB,
      resident_id: residentA,
      period_month: month,
      amount: 100,
      due_date: monthEnd,
    });
    expect(error).not.toBeNull();
    // ...even for the service role, because the composite key is in the schema.
    // (A different month, so the one-invoice-per-month rule is not what stops it.)
    const asAdmin = await admin.from("invoices").insert({
      hostel_id: hostelB,
      resident_id: residentA,
      period_month: "2026-01-01",
      amount: 100,
      due_date: "2026-01-05",
    });
    expect(asAdmin.error?.code).toBe("23503");
  });

  it("reject a payment row whose invoice belongs to another hostel, even for the service role", async () => {
    const { error } = await admin.from("payments").insert({
      hostel_id: hostelB,
      invoice_id: invoiceA,
      amount: 100,
      paid_at: todayIst(),
      mode: "cash",
      recorded_by: ownerB.id,
    });
    expect(error?.code).toBe("23503");
  });

  it("let each owner see only their own rows", async () => {
    const mine = await ownerA.client.from("invoice_balances").select("id");
    expect(mine.data).toEqual([{ id: invoiceA }]);
    const theirs = await ownerB.client.from("invoice_balances").select("id");
    expect(theirs.data).toEqual([{ id: invoiceB }]);
  });
});

describe("anonymous visitors", () => {
  it("see no fee data and cannot call the fee functions", async () => {
    const anon = anonClient();
    for (const table of FEE_RELATIONS) {
      const { data } = await fromRelation(anon, table).select("hostel_id");
      expect(data ?? [], table).toEqual([]);
    }
    const generate = await anon.rpc("generate_invoices", {
      p_hostel_id: hostelA,
      p_period_month: month,
    });
    expect(generate.error?.code).toBe("42501");
    const rate = await anon.rpc("set_fee_structure", {
      p_hostel_id: hostelA,
      p_sharing_type: "single",
      p_monthly_amount: 100,
      p_effective_from: "2026-01-01",
    });
    expect(rate.error?.code).toBe("42501");
  });
});
