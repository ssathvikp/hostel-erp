import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { todayIst } from "@/lib/validation";

import { residentRow } from "../support/residents";
import { createUserFactory, type TestUser } from "../support/supabase";

/** Sequential invoice and receipt numbers per hostel per financial year (ClickUp E13-T9). */
const { admin, createUser, createHostel, cleanup } = createUserFactory();

afterAll(cleanup);

let owner: TestUser;

beforeAll(async () => {
  owner = await createUser();
});

function fiscalYear(day: string): string {
  const [year, month] = day.split("-").map(Number);
  const start = month < 4 ? year - 1 : year;
  return `${String(start % 100).padStart(2, "0")}-${String((start + 1) % 100).padStart(2, "0")}`;
}

const fy = fiscalYear(todayIst());
const monthStart = `${todayIst().slice(0, 7)}-01`;

async function residentIn(hostelId: string) {
  const { data, error } = await admin
    .from("residents")
    .insert(residentRow(hostelId))
    .select("id")
    .single();
  if (error) throw error;
  return data.id;
}

async function invoiceFor(hostelId: string, client = owner.client) {
  const residentId = await residentIn(hostelId);
  return client
    .from("invoices")
    .insert({
      hostel_id: hostelId,
      resident_id: residentId,
      period_month: monthStart,
      amount: 500000,
      due_date: monthStart,
    })
    .select("id, invoice_number")
    .single();
}

describe("invoice numbers", () => {
  it("run from 1 in each hostel's series for the financial year", async () => {
    const first = (await createHostel(owner.id)).id;
    const second = (await createHostel(owner.id)).id;
    const a1 = await invoiceFor(first);
    const a2 = await invoiceFor(first);
    const b1 = await invoiceFor(second);
    expect(a1.data?.invoice_number).toBe(`INV/${fy}/00001`);
    expect(a2.data?.invoice_number).toBe(`INV/${fy}/00002`);
    expect(b1.data?.invoice_number).toBe(`INV/${fy}/00001`);
  });

  it("never repeat or skip under concurrent inserts", async () => {
    const hostelId = (await createHostel(owner.id)).id;
    const residents = await Promise.all(Array.from({ length: 12 }, () => residentIn(hostelId)));
    const results = await Promise.all(
      residents.map((residentId) =>
        owner.client
          .from("invoices")
          .insert({
            hostel_id: hostelId,
            resident_id: residentId,
            period_month: monthStart,
            amount: 100000,
            due_date: monthStart,
          })
          .select("invoice_number")
          .single(),
      ),
    );
    const numbers = results.map((result) => result.data!.invoice_number).sort();
    expect(numbers).toEqual(
      Array.from({ length: 12 }, (_, i) => `INV/${fy}/${String(i + 1).padStart(5, "0")}`),
    );
  });

  it("are kept when an invoice is voided, and cannot be chosen or changed", async () => {
    const hostelId = (await createHostel(owner.id)).id;
    const { data } = await invoiceFor(hostelId);
    await owner.client
      .from("invoices")
      .update({ status: "void", void_reason: "Wrong resident" })
      .eq("id", data!.id);
    const { data: after } = await admin
      .from("invoices")
      .select("invoice_number, status")
      .eq("id", data!.id)
      .single();
    expect(after).toEqual({ invoice_number: data!.invoice_number, status: "void" });

    const chosen = await admin
      .from("invoices")
      .insert({
        hostel_id: hostelId,
        resident_id: await residentIn(hostelId),
        period_month: monthStart,
        amount: 100,
        due_date: monthStart,
        invoice_number: "INV/00-01/99999",
      })
      .select("invoice_number")
      .single();
    expect(chosen.data?.invoice_number).toBe(`INV/${fy}/00002`);
  });

  it("are given to invoices from generate_invoices too", async () => {
    const hostelId = (await createHostel(owner.id)).id;
    const { data: room } = await admin
      .from("rooms")
      .insert({
        hostel_id: hostelId,
        room_number: "1",
        floor: 1,
        sharing_type: "single",
        capacity: 1,
      })
      .select("id")
      .single();
    const { data: bed } = await admin.from("beds").select("id").eq("room_id", room!.id).single();
    const residentId = await residentIn(hostelId);
    await admin.from("allocations").insert({
      hostel_id: hostelId,
      resident_id: residentId,
      room_id: room!.id,
      bed_id: bed!.id,
      start_date: "2026-01-01",
      rent_override: 400000,
      created_by: owner.id,
    });
    await owner.client.rpc("generate_invoices", {
      p_hostel_id: hostelId,
      p_period_month: monthStart,
    });
    const { data } = await admin
      .from("invoices")
      .select("invoice_number")
      .eq("hostel_id", hostelId);
    expect(data).toEqual([{ invoice_number: `INV/${fy}/00001` }]);
  });
});

describe("receipt numbers", () => {
  it("number each payment in the hostel's receipt series, refused payments taking none", async () => {
    const hostelId = (await createHostel(owner.id)).id;
    const { data: invoice } = await invoiceFor(hostelId);
    const pay = (amount: number) =>
      owner.client
        .from("payments")
        .insert({
          hostel_id: hostelId,
          invoice_id: invoice!.id,
          amount,
          paid_at: todayIst(),
          mode: "cash",
        })
        .select("receipt_number")
        .single();
    expect((await pay(200000)).data?.receipt_number).toBe(`RCT/${fy}/00001`);
    // More than is due: refused, and no number used up.
    expect((await pay(900000)).error?.hint).toBe("overpayment");
    expect((await pay(300000)).data?.receipt_number).toBe(`RCT/${fy}/00002`);
  });
});
