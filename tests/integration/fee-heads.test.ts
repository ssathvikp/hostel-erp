import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { dayOf, daysIn, feeFixtures, monthStart, prorate } from "../support/fees";
import { createUserFactory, type TestUser } from "../support/supabase";

/**
 * Charges beyond rent (E13-T1): fee heads, their rates, exemptions, and
 * itemised invoices whose lines always add up to the amount.
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

async function head(
  hostelId: string,
  name: string,
  pricing: "flat" | "per_sharing" = "flat",
  billing: "monthly" | "one_time" = "monthly",
) {
  const { data, error } = await owner.client
    .from("fee_heads")
    .insert({ hostel_id: hostelId, name, pricing, billing })
    .select("id")
    .single();
  if (error) throw error;
  return data.id;
}

function headRate(headId: string, amount: number, from: string, sharing: string | null = null) {
  return owner.client.rpc("set_fee_head_rate", {
    p_fee_head_id: headId,
    p_sharing_type: sharing ?? undefined,
    p_amount: amount,
    p_effective_from: from,
  });
}

describe("fee heads", () => {
  it("bill a full month at the rate and a part month by nights, as lines after rent", async () => {
    const hostelId = await hostel();
    const month = monthStart(-1);
    await setRate(hostelId, "single", 1000000, monthStart(-12));
    const mess = await head(hostelId, "Mess");
    await headRate(mess, 300000, monthStart(-12));

    const fullMonth = await resident(hostelId);
    await stay(hostelId, fullMonth, await bed(hostelId), monthStart(-2));
    const lateArrival = await resident(hostelId);
    await stay(hostelId, lateArrival, await bed(hostelId), dayOf(month, 11));

    await generate(hostelId, month);
    const full = await invoiceFor(fullMonth, month);
    expect(full!.amount).toBe(1300000);
    expect(full!.invoice_lines.map((l) => [l.kind, l.description, l.amount])).toEqual([
      ["rent", "Rent", 1000000],
      ["fee", "Mess", 300000],
    ]);

    const nights = daysIn(month) - 10;
    const part = await invoiceFor(lateArrival, month);
    expect(part!.invoice_lines.map((l) => l.amount)).toEqual([
      prorate(1000000 * nights, daysIn(month)),
      prorate(300000 * nights, daysIn(month)),
    ]);
    expect(part!.amount).toBe(part!.invoice_lines.reduce((sum, l) => sum + l.amount, 0));
  });

  it("price per sharing type, skip a type with no rate, and excuse exempt residents", async () => {
    const hostelId = await hostel();
    const month = monthStart(-1);
    await setRate(hostelId, "single", 1000000, monthStart(-12));
    await setRate(hostelId, "double", 700000, monthStart(-12));
    const ac = await head(hostelId, "Air conditioning", "per_sharing");
    await headRate(ac, 200000, monthStart(-12), "single");

    const inSingle = await resident(hostelId);
    await stay(hostelId, inSingle, await bed(hostelId, "single"), monthStart(-2));
    const inDouble = await resident(hostelId);
    await stay(hostelId, inDouble, await bed(hostelId, "double"), monthStart(-2));
    const exempt = await resident(hostelId);
    await stay(hostelId, exempt, await bed(hostelId, "single"), monthStart(-2));
    await owner.client
      .from("resident_fee_exemptions")
      .insert({ hostel_id: hostelId, resident_id: exempt, fee_head_id: ac });

    await generate(hostelId, month);
    expect((await invoiceFor(inSingle, month))!.amount).toBe(1200000);
    expect((await invoiceFor(inDouble, month))!.amount).toBe(700000);
    expect((await invoiceFor(exempt, month))!.amount).toBe(1000000);
  });

  it("do not bill inactive or one-time heads monthly, and use the rate on the 1st", async () => {
    const hostelId = await hostel();
    const month = monthStart(-1);
    await setRate(hostelId, "single", 1000000, monthStart(-12));
    const laundry = await head(hostelId, "Laundry");
    await headRate(laundry, 50000, monthStart(-12));
    await headRate(laundry, 80000, dayOf(month, 15));
    const wifi = await head(hostelId, "Wi-Fi");
    await headRate(wifi, 30000, monthStart(-12));
    await owner.client.from("fee_heads").update({ active: false }).eq("id", wifi);
    const admission = await head(hostelId, "Admission", "flat", "one_time");
    await headRate(admission, 500000, monthStart(-12));

    const residentId = await resident(hostelId);
    await stay(hostelId, residentId, await bed(hostelId), monthStart(-2));
    await generate(hostelId, month);
    const invoice = await invoiceFor(residentId, month);
    expect(invoice!.invoice_lines.map((l) => [l.description, l.amount])).toEqual([
      ["Rent", 1000000],
      ["Laundry", 50000],
    ]);
  });

  it("keep rate history like rent: later rates block earlier ones, same date corrects", async () => {
    const hostelId = await hostel();
    const mess = await head(hostelId, "Mess");
    expect((await headRate(mess, 300000, "2026-01-01")).error).toBeNull();
    expect((await headRate(mess, 350000, "2026-07-01")).error).toBeNull();
    expect((await headRate(mess, 360000, "2026-07-01")).error).toBeNull();
    expect((await headRate(mess, 200000, "2026-03-01")).error?.hint).toBe("fee_head_later_exists");
    const { data } = await admin
      .from("fee_head_rates")
      .select("amount, effective_from, effective_to")
      .eq("fee_head_id", mess)
      .order("effective_from");
    expect(data).toEqual([
      { amount: 300000, effective_from: "2026-01-01", effective_to: "2026-06-30" },
      { amount: 360000, effective_from: "2026-07-01", effective_to: null },
    ]);

    const ac = await head(hostelId, "AC", "per_sharing");
    expect((await headRate(ac, 100000, "2026-01-01")).error?.hint).toBe(
      "fee_head_sharing_required",
    );
  });

  it("refuse a second head with the same name and a head called rent", async () => {
    const hostelId = await hostel();
    await head(hostelId, "Mess");
    const duplicate = await owner.client
      .from("fee_heads")
      .insert({ hostel_id: hostelId, name: " mess ", pricing: "flat", billing: "monthly" });
    expect(duplicate.error?.code).toBe("23505");
    const rent = await owner.client
      .from("fee_heads")
      .insert({ hostel_id: hostelId, name: "Rent", pricing: "flat", billing: "monthly" });
    expect(rent.error?.code).toBe("23514");
  });

  it("are set by owners only", async () => {
    const staffHead = await staff.client
      .from("fee_heads")
      .insert({ hostel_id: staffHostelId, name: "Mess", pricing: "flat", billing: "monthly" });
    expect(staffHead.error?.code).toBe(PERMISSION_DENIED);

    const ownersHead = await head(staffHostelId, "Maintenance");
    const staffRate = await staff.client.rpc("set_fee_head_rate", {
      p_fee_head_id: ownersHead,
      p_amount: 100000,
      p_effective_from: "2026-01-01",
    });
    expect(staffRate.error?.code).toBe(PERMISSION_DENIED);
    expect(
      (await staff.client.from("fee_heads").select("id").eq("id", ownersHead)).data,
    ).toHaveLength(1);
  });
});

describe("invoice lines", () => {
  it("always add up to the invoice amount", async () => {
    const hostelId = await hostel();
    const residentId = await resident(hostelId);
    const { data: invoice } = await admin
      .from("invoices")
      .insert({
        hostel_id: hostelId,
        resident_id: residentId,
        period_month: monthStart(0),
        amount: 500000,
        due_date: dayOf(monthStart(0), 5),
      })
      .select("id")
      .single();
    // Written without lines: given a single rent line.
    const { data: lines } = await admin
      .from("invoice_lines")
      .select("kind, amount")
      .eq("invoice_id", invoice!.id);
    expect(lines).toEqual([{ kind: "rent", amount: 500000 }]);

    // A line added later would change what the invoice is for.
    const added = await owner.client.from("invoice_lines").insert({
      hostel_id: hostelId,
      invoice_id: invoice!.id,
      position: 2,
      kind: "fee",
      description: "Extra",
      amount: 1000,
    });
    expect(added.error?.hint).toBe("invoice_lines_mismatch");
  });

  it("cannot be changed or removed", async () => {
    const hostelId = await hostel();
    const { billedResident } = feeFixtures(admin, () => owner);
    const residentId = await billedResident(hostelId);
    await generate(hostelId, monthStart(-1));
    const invoice = await invoiceFor(residentId, monthStart(-1));
    await owner.client.from("invoice_lines").update({ amount: 1 }).eq("invoice_id", invoice!.id);
    await owner.client.from("invoice_lines").delete().eq("invoice_id", invoice!.id);
    expect((await invoiceFor(residentId, monthStart(-1)))!.invoice_lines).toHaveLength(1);
  });

  it("are hidden from other hostels", async () => {
    const outsider = await createUser();
    const hostelId = await hostel();
    const { billedResident } = feeFixtures(admin, () => owner);
    await billedResident(hostelId);
    await generate(hostelId, monthStart(-1));
    const { data } = await outsider.client
      .from("invoice_lines")
      .select("id")
      .eq("hostel_id", hostelId);
    expect(data).toEqual([]);
  });
});
