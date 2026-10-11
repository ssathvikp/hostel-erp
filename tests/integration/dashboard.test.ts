import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { todayIst } from "@/lib/validation";

import { residentRow } from "../support/residents";
import { anonClient, createUserFactory, type TestUser } from "../support/supabase";

/**
 * Dashboard read models (E8-T1, E8-T2, E8-T4): the occupancy trend derived
 * from allocation dates, and money for a period. Each test builds its own
 * hostel, so counts are exact.
 */
const { admin, createUser, createHostel, cleanup } = createUserFactory();

afterAll(cleanup);

let owner: TestUser;
let other: TestUser;

beforeAll(async () => {
  [owner, other] = await Promise.all([createUser(), createUser()]);
});

function daysFromToday(days: number): string {
  const date = new Date(`${todayIst()}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function monthStart(offset = 0): string {
  const [year, month] = todayIst().split("-").map(Number);
  return new Date(Date.UTC(year, month - 1 + offset, 1)).toISOString().slice(0, 10);
}

/** A hostel with one room of `capacity` beds; returns the hostel and bed ids. */
async function hostelWithBeds(capacity: number) {
  const hostelId = (await createHostel(owner.id)).id;
  const { data: room, error } = await admin
    .from("rooms")
    .insert({
      hostel_id: hostelId,
      room_number: "1",
      floor: 1,
      sharing_type:
        capacity <= 3 ? (["single", "double", "triple"] as const)[capacity - 1] : "four_plus",
      capacity,
    })
    .select("id")
    .single();
  if (error) throw error;
  const { data: beds } = await admin
    .from("beds")
    .select("id")
    .eq("room_id", room.id)
    .order("bed_label");
  return { hostelId, roomId: room.id, beds: beds!.map((bed) => bed.id) };
}

async function stay(
  hostelId: string,
  roomId: string,
  bedId: string,
  start: string,
  end: string | null = null,
) {
  const { data: resident } = await admin
    .from("residents")
    .insert(residentRow(hostelId))
    .select("id")
    .single();
  const { error } = await admin.from("allocations").insert({
    hostel_id: hostelId,
    resident_id: resident!.id,
    bed_id: bedId,
    room_id: roomId,
    start_date: start,
    end_date: end,
    vacate_reason: end ? "moved_out" : null,
    created_by: owner.id,
  });
  if (error) throw error;
  return resident!.id;
}

function trend(hostelId: string, from: string, to: string, granularity: "day" | "month" = "day") {
  return owner.client.rpc("occupancy_trend", {
    p_hostel_id: hostelId,
    p_from: from,
    p_to: to,
    p_granularity: granularity,
  });
}

describe("occupancy trend", () => {
  it("counts occupied beds per day from allocation dates", async () => {
    const { hostelId, roomId, beds } = await hostelWithBeds(4);
    await stay(hostelId, roomId, beds[0], daysFromToday(-5));
    await stay(hostelId, roomId, beds[1], daysFromToday(-3), daysFromToday(-2));

    const { data, error } = await trend(hostelId, daysFromToday(-6), todayIst());
    expect(error).toBeNull();
    expect(data!.map((row) => [row.bucket, Number(row.occupied_beds)])).toEqual([
      [daysFromToday(-6), 0],
      [daysFromToday(-5), 1],
      [daysFromToday(-4), 1],
      [daysFromToday(-3), 2],
      [daysFromToday(-2), 2],
      [daysFromToday(-1), 1],
      [todayIst(), 1],
    ]);
    expect(data!.every((row) => Number(row.total_beds) === 4)).toBe(true);
    expect(Number(data!.at(-1)!.occupancy_percent)).toBe(25);
  });

  it("is correct retroactively: a backdated allocation changes past days", async () => {
    const { hostelId, roomId, beds } = await hostelWithBeds(2);
    const before = await trend(hostelId, daysFromToday(-10), daysFromToday(-8));
    expect(before.data!.map((row) => Number(row.occupied_beds))).toEqual([0, 0, 0]);
    await stay(hostelId, roomId, beds[0], daysFromToday(-20));
    const after = await trend(hostelId, daysFromToday(-10), daysFromToday(-8));
    expect(after.data!.map((row) => Number(row.occupied_beds))).toEqual([1, 1, 1]);
  });

  it("agrees with today's occupancy snapshot", async () => {
    const { hostelId, roomId, beds } = await hostelWithBeds(3);
    await stay(hostelId, roomId, beds[0], daysFromToday(-40));
    await stay(hostelId, roomId, beds[1], todayIst());
    const [{ data: series }, { data: snapshot }] = await Promise.all([
      trend(hostelId, todayIst(), todayIst()),
      owner.client
        .from("hostel_occupancy")
        .select("occupied_beds, total_beds")
        .eq("hostel_id", hostelId)
        .single(),
    ]);
    expect(Number(series![0].occupied_beds)).toBe(snapshot!.occupied_beds);
    expect(Number(series![0].total_beds)).toBe(snapshot!.total_beds);
  });

  it("averages a month as occupied bed-nights over bed-nights", async () => {
    const { hostelId, roomId, beds } = await hostelWithBeds(2);
    const month = monthStart(-1);
    const [year, m] = month.split("-").map(Number);
    const days = new Date(Date.UTC(year, m, 0)).getUTCDate();
    // One bed held for the first 10 nights of last month only.
    await stay(hostelId, roomId, beds[0], month, `${month.slice(0, 8)}10`);

    const { data } = await trend(hostelId, month, `${month.slice(0, 8)}${days}`, "month");
    expect(data).toHaveLength(1);
    expect(data![0]).toMatchObject({ bucket: month, days });
    expect(Number(data![0].occupancy_percent)).toBe(Math.round((1000 * 10) / (2 * days)) / 10);
  });

  it("returns only days up to today, so a short history renders as is", async () => {
    const { hostelId } = await hostelWithBeds(1);
    const { data } = await trend(hostelId, daysFromToday(-2), daysFromToday(30));
    expect(data!.map((row) => row.bucket)).toEqual([
      daysFromToday(-2),
      daysFromToday(-1),
      todayIst(),
    ]);
  });

  it("stops counting a retired bed from the day it was retired", async () => {
    const { hostelId, roomId, beds } = await hostelWithBeds(2);
    await admin.from("beds").update({ archived_at: new Date().toISOString() }).eq("id", beds[1]);
    const { data } = await trend(hostelId, daysFromToday(-1), todayIst());
    expect(data!.map((row) => Number(row.total_beds))).toEqual([2, 1]);
    expect(roomId).toBeTruthy();
  });

  it("rejects reversed and over-long ranges and unknown granularity", async () => {
    const { hostelId } = await hostelWithBeds(1);
    expect((await trend(hostelId, todayIst(), daysFromToday(-1))).error?.hint).toBe(
      "range_reversed",
    );
    expect((await trend(hostelId, daysFromToday(-800), todayIst())).error?.hint).toBe(
      "range_too_long",
    );
    const bad = await owner.client.rpc("occupancy_trend", {
      p_hostel_id: hostelId,
      p_from: todayIst(),
      p_to: todayIst(),
      p_granularity: "week",
    });
    expect(bad.error?.hint).toBe("granularity");
  });

  it("stays fast at 500 beds and 2000 historical allocations", async () => {
    const hostelId = (await createHostel(owner.id)).id;
    const { data: rooms } = await admin
      .from("rooms")
      .insert(
        Array.from({ length: 100 }, (_, i) => ({
          hostel_id: hostelId,
          room_number: String(100 + i),
          floor: 1 + (i % 5),
          sharing_type: "four_plus",
          capacity: 5,
        })),
      )
      .select("id");
    const { data: beds } = await admin
      .from("beds")
      .select("id, room_id")
      .in(
        "room_id",
        rooms!.map((room) => room.id),
      );
    expect(beds).toHaveLength(500);
    const { data: residents } = await admin
      .from("residents")
      .insert(Array.from({ length: 2000 }, () => residentRow(hostelId)))
      .select("id");
    // Four back-to-back 80-night stays per bed over the past year.
    const rows = beds!.flatMap((bed, b) =>
      [0, 1, 2, 3].map((k) => ({
        hostel_id: hostelId,
        resident_id: residents![b * 4 + k].id,
        bed_id: bed.id,
        room_id: bed.room_id,
        start_date: daysFromToday(-360 + k * 90),
        end_date: daysFromToday(-360 + k * 90 + 79),
        vacate_reason: "moved_out",
        created_by: owner.id,
      })),
    );
    for (let i = 0; i < rows.length; i += 500) {
      const { error } = await admin.from("allocations").insert(rows.slice(i, i + 500));
      if (error) throw error;
    }

    for (const granularity of ["day", "month"] as const) {
      const started = performance.now();
      const { data, error } = await trend(hostelId, daysFromToday(-365), todayIst(), granularity);
      const elapsed = performance.now() - started;
      expect(error).toBeNull();
      expect(data!.length).toBeGreaterThan(granularity === "day" ? 360 : 11);
      expect(elapsed, `${granularity} trend took ${elapsed.toFixed(0)} ms`).toBeLessThan(1500);
    }
  }, 60_000);
});

describe("dashboard money", () => {
  it("collects in the range, bills by billing month, and owes as of today", async () => {
    const { hostelId } = await hostelWithBeds(1);
    const residentId = (
      await admin.from("residents").insert(residentRow(hostelId)).select("id").single()
    ).data!.id;
    const invoice = async (month: string, amount: number) =>
      (
        await admin
          .from("invoices")
          .insert({
            hostel_id: hostelId,
            resident_id: residentId,
            period_month: month,
            amount,
            due_date: `${month.slice(0, 8)}05`,
          })
          .select("id")
          .single()
      ).data!.id;
    const last = await invoice(monthStart(-1), 800000);
    const current = await invoice(monthStart(0), 800000);
    const pay = (invoiceId: string, amount: number, paidAt: string) =>
      owner.client.from("payments").insert({
        hostel_id: hostelId,
        invoice_id: invoiceId,
        amount,
        paid_at: paidAt,
        mode: "cash",
      });
    await pay(last, 800000, `${monthStart(-1).slice(0, 8)}20`);
    await pay(current, 300000, monthStart(0));
    await pay(current, 100000, monthStart(0));
    // A voided payment drops out.
    const { data: voided } = await admin
      .from("payments")
      .select("id")
      .eq("invoice_id", current)
      .eq("amount", 100000)
      .single();
    await owner.client.from("payments").update({ void_reason: "Mistake" }).eq("id", voided!.id);

    const thisMonth = await owner.client.rpc("dashboard_money", {
      p_hostel_id: hostelId,
      p_from: monthStart(0),
      p_to: todayIst(),
    });
    expect(thisMonth.data![0]).toMatchObject({
      collected: 300000,
      payments: 1,
      billed: 800000,
      invoices: 1,
      outstanding: 500000,
    });

    // Across the month boundary: both months' money.
    const both = await owner.client.rpc("dashboard_money", {
      p_hostel_id: hostelId,
      p_from: monthStart(-1),
      p_to: todayIst(),
    });
    expect(both.data![0]).toMatchObject({
      collected: 1100000,
      billed: 1600000,
      outstanding: 500000,
    });

    // Outstanding matches the fee list totals exactly.
    const { data: totals } = await owner.client.rpc("fee_status_totals", { p_hostel_id: hostelId });
    const listOutstanding = totals!.reduce((sum, row) => sum + row.balance, 0);
    expect(thisMonth.data![0].outstanding).toBe(listOutstanding);
  });

  it("rejects a reversed range", async () => {
    const { hostelId } = await hostelWithBeds(1);
    const { error } = await owner.client.rpc("dashboard_money", {
      p_hostel_id: hostelId,
      p_from: todayIst(),
      p_to: daysFromToday(-1),
    });
    expect(error?.hint).toBe("range_reversed");
  });

  it("shows another hostel nothing, and anonymous callers are refused", async () => {
    const { hostelId, roomId, beds } = await hostelWithBeds(1);
    await stay(hostelId, roomId, beds[0], daysFromToday(-3));
    const trendAsOther = await other.client.rpc("occupancy_trend", {
      p_hostel_id: hostelId,
      p_from: daysFromToday(-3),
      p_to: todayIst(),
    });
    expect(trendAsOther.data!.every((row) => Number(row.occupied_beds) === 0)).toBe(true);
    expect(trendAsOther.data!.every((row) => Number(row.total_beds) === 0)).toBe(true);
    const moneyAsOther = await other.client.rpc("dashboard_money", {
      p_hostel_id: hostelId,
      p_from: monthStart(-12),
      p_to: todayIst(),
    });
    expect(moneyAsOther.data![0]).toMatchObject({ collected: 0, billed: 0, outstanding: 0 });

    const anon = await anonClient().rpc("occupancy_trend", {
      p_hostel_id: hostelId,
      p_from: todayIst(),
      p_to: todayIst(),
    });
    expect(anon.error?.code).toBe("42501");
  });
});
