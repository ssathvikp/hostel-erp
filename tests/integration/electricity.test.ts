import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { dayOf, daysIn, feeFixtures, monthStart } from "../support/fees";
import { createUserFactory, type TestUser } from "../support/supabase";

/**
 * Metered electricity per room (E13-T3): readings never go backwards, the
 * room's units are split by nights held, and missing readings are listed.
 */
const PERMISSION_DENIED = "42501";
const { admin, createUser, createHostel, cleanup } = createUserFactory();
afterAll(cleanup);

let owner: TestUser;
let staff: TestUser;
let staffHostelId: string;
const { resident, stay, setRate, generate, invoiceFor } = feeFixtures(admin, () => owner);

beforeAll(async () => {
  owner = await createUser();
  staffHostelId = (await createHostel(owner.id)).id;
  staff = await createUser({ profile: { role: "staff", hostel_id: staffHostelId } });
});

/** A double room and its two beds. */
async function room(hostelId: string, roomNumber: string) {
  const { data, error } = await admin
    .from("rooms")
    .insert({
      hostel_id: hostelId,
      room_number: roomNumber,
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
    .eq("room_id", data.id)
    .order("bed_label");
  return { roomId: data.id, beds: beds!.map((bed) => bed.id) };
}

async function rate(hostelId: string, unitRate = 800) {
  const { error } = await owner.client
    .from("electricity_rates")
    .insert({ hostel_id: hostelId, unit_rate: unitRate });
  if (error?.code === "23505") {
    await owner.client
      .from("electricity_rates")
      .update({ unit_rate: unitRate })
      .eq("hostel_id", hostelId);
  } else if (error) throw error;
}

function reading(user: TestUser, roomId: string, month: string, opening: number, closing: number) {
  return user.client.rpc("record_meter_reading", {
    p_room_id: roomId,
    p_period_month: month,
    p_opening: opening,
    p_closing: closing,
  });
}

async function chargesFor(residentId: string) {
  const { data } = await admin
    .from("resident_charges")
    .select("amount, description, status, charge_date")
    .eq("resident_id", residentId)
    .order("created_at");
  return data ?? [];
}

describe("electricity", () => {
  it("splits a room's units by nights held and adds each share as a charge", async () => {
    const hostelId = (await createHostel(owner.id)).id;
    await rate(hostelId, 800);
    const month = monthStart(-1);
    const days = daysIn(month);
    const { roomId, beds } = await room(hostelId, "E1");
    const full = await resident(hostelId);
    const half = await resident(hostelId);
    await stay(hostelId, full, beds[0], monthStart(-3));
    // From the 16th: the rest of the month.
    await stay(hostelId, half, beds[1], dayOf(month, 16));
    const halfNights = days - 15;

    const { data, error } = await reading(owner, roomId, month, 1000, 1123.5);
    expect(error).toBeNull();
    expect(data).toMatchObject({ units: 123.5, amount: 98800, nights: days + halfNights });

    const fullShare = Math.round((98800 * days) / (days + halfNights));
    expect(await chargesFor(full)).toEqual([
      expect.objectContaining({
        amount: fullShare,
        status: "pending",
        charge_date: dayOf(month, days),
      }),
    ]);
    const [halfCharge] = await chargesFor(half);
    expect(halfCharge.amount).toBe(98800 - fullShare);
    expect(halfCharge.description).toMatch(
      new RegExp(
        `^Electricity, room E1, .*: 123\\.5 units × ₹8\\.00, your share for ${halfNights} of ${days + halfNights} nights$`,
      ),
    );
  });

  it("puts the share on the next invoice as its own line", async () => {
    const hostelId = (await createHostel(owner.id)).id;
    await rate(hostelId, 1000);
    await setRate(hostelId, "double", 500000, monthStart(-12));
    const { roomId, beds } = await room(hostelId, "E2");
    const residentId = await resident(hostelId);
    await stay(hostelId, residentId, beds[0], monthStart(-3));

    expect((await reading(owner, roomId, monthStart(-2), 0, 50)).error).toBeNull();
    await generate(hostelId, monthStart(-1));
    const invoice = await invoiceFor(residentId, monthStart(-1));
    expect(invoice!.amount).toBe(500000 + 50000);
    expect(invoice!.invoice_lines).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: "charge",
          amount: 50000,
          description: expect.stringMatching(/^Electricity, room E2, .*: 50\.0 units × ₹10\.00$/),
        }),
      ]),
    );
  });

  it("refuses readings that go backwards, repeat a month, or come before a rate", async () => {
    const hostelId = (await createHostel(owner.id)).id;
    const { roomId } = await room(hostelId, "E3");
    expect((await reading(owner, roomId, monthStart(-3), 0, 10)).error?.hint).toBe(
      "electricity_rate_missing",
    );
    await rate(hostelId);

    expect((await reading(owner, roomId, monthStart(-3), 100, 150)).error).toBeNull();
    expect((await reading(owner, roomId, monthStart(-3), 150, 160)).error?.hint).toBe(
      "meter_reading_exists",
    );
    expect((await reading(owner, roomId, monthStart(-2), 140, 160)).error?.hint).toBe(
      "meter_reading_lower",
    );
    expect((await reading(owner, roomId, monthStart(-2), 160, 155)).error?.hint).toBe(
      "meter_reading_lower",
    );
    expect((await reading(owner, roomId, monthStart(-1), 200, 260)).error).toBeNull();
    // Filling the gap may not overrun the later month's opening.
    expect((await reading(owner, roomId, monthStart(-2), 150, 210)).error?.hint).toBe(
      "meter_reading_higher",
    );
    expect((await reading(owner, roomId, monthStart(-2), 150, 200)).error).toBeNull();
    expect((await reading(owner, roomId, monthStart(1), 260, 270)).error?.hint).toBe("meter_month");
  });

  it("are recorded by staff in their hostel only, and voided by owners only", async () => {
    await rate(staffHostelId);
    const { roomId, beds } = await room(staffHostelId, "E4");
    const residentId = await resident(staffHostelId);
    await stay(staffHostelId, residentId, beds[0], monthStart(-3));

    const elsewhere = (await createHostel(owner.id)).id;
    await rate(elsewhere);
    const other = await room(elsewhere, "E5");
    expect((await reading(staff, other.roomId, monthStart(-1), 0, 1)).error?.hint).toBe(
      "room_not_found",
    );

    const { data } = await reading(staff, roomId, monthStart(-1), 0, 30);
    const readingId = (data as { reading_id: string }).reading_id;
    // Readings are written only through the functions.
    const direct = await owner.client
      .from("meter_readings")
      .update({ closing: 1 })
      .eq("id", readingId)
      .select("id");
    expect(direct.error?.code).toBe(PERMISSION_DENIED);

    const byStaff = await staff.client.rpc("void_meter_reading", {
      p_reading_id: readingId,
      p_reason: "Misread",
    });
    expect(byStaff.error?.code).toBe(PERMISSION_DENIED);

    const voided = await owner.client.rpc("void_meter_reading", {
      p_reading_id: readingId,
      p_reason: "Misread",
    });
    expect(voided.error).toBeNull();
    expect(await chargesFor(residentId)).toEqual([expect.objectContaining({ status: "void" })]);
    // The month can be read again.
    expect((await reading(staff, roomId, monthStart(-1), 0, 3)).error).toBeNull();
  });

  it("cannot void a reading whose charges are on an invoice", async () => {
    const hostelId = (await createHostel(owner.id)).id;
    await rate(hostelId);
    await setRate(hostelId, "double", 500000, monthStart(-12));
    const { roomId, beds } = await room(hostelId, "E6");
    const residentId = await resident(hostelId);
    await stay(hostelId, residentId, beds[0], monthStart(-3));
    const { data } = await reading(owner, roomId, monthStart(-2), 0, 10);
    await generate(hostelId, monthStart(-1));

    const voided = await owner.client.rpc("void_meter_reading", {
      p_reading_id: (data as { reading_id: string }).reading_id,
      p_reason: "Late",
    });
    expect(voided.error?.hint).toBe("meter_reading_billed");
  });

  it("lists occupied rooms with no reading, only when electricity is billed", async () => {
    const hostelId = (await createHostel(owner.id)).id;
    const occupied = await room(hostelId, "E7");
    const read = await room(hostelId, "E8");
    await room(hostelId, "E9");
    for (const target of [occupied, read]) {
      await stay(hostelId, await resident(hostelId), target.beds[0], monthStart(-3));
    }
    const month = monthStart(-1);
    const missing = () =>
      owner.client.rpc("missing_meter_readings", { p_hostel_id: hostelId, p_period_month: month });

    expect((await missing()).data).toEqual([]);
    await rate(hostelId);
    await reading(owner, read.roomId, month, 0, 5);
    expect((await missing()).data).toEqual([{ room_id: occupied.roomId, room_number: "E7" }]);

    const outsider = await createUser();
    const { data: forOutsider } = await outsider.client.rpc("missing_meter_readings", {
      p_hostel_id: hostelId,
      p_period_month: month,
    });
    expect(forOutsider).toEqual([]);
  });
});
