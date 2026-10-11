import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { todayIst } from "@/lib/validation";

import { residentRow } from "../support/residents";
import { createUserFactory, type TestUser } from "../support/supabase";

/**
 * The integrity rules that protect beds and money (E9-T2), in one place.
 *
 * Each rule is enforced by the database, so each is attacked here the way a
 * future refactor could break it: through the app's own functions, with
 * concurrent requests, and with direct writes that skip the app entirely.
 * Every assertion names its rule, so a failure says which guarantee broke.
 * Fixtures are created per test; nothing depends on the seed script.
 *
 * Run alone with `npm run test:integrity` (local database: `npm run db:reset`).
 */
const { admin, createUser, createHostel, cleanup } = createUserFactory();

afterAll(cleanup);

let owner: TestUser;

beforeAll(async () => {
  owner = await createUser();
});

const UNIQUE_VIOLATION = "23505";
const EXCLUSION_VIOLATION = "23P01";

function daysFromToday(days: number): string {
  const date = new Date(`${todayIst()}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

const lastMonth = (() => {
  const [year, month] = todayIst().split("-").map(Number);
  return new Date(Date.UTC(year, month - 2, 1)).toISOString().slice(0, 10);
})();

async function hostelWithRoom(capacity = 2) {
  const hostelId = (await createHostel(owner.id)).id;
  const { data: room, error } = await admin
    .from("rooms")
    .insert({
      hostel_id: hostelId,
      room_number: "101",
      floor: 1,
      sharing_type: capacity === 1 ? "single" : "double",
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

async function resident(hostelId: string) {
  const { data, error } = await admin
    .from("residents")
    .insert(residentRow(hostelId))
    .select("id")
    .single();
  if (error) throw error;
  return data.id;
}

describe("Rule: a bed is never held by two residents on the same night", () => {
  const RULE = "no double allocation of a bed";

  it("rejects an overlapping stay even when written directly, bypassing the app", async () => {
    const { hostelId, roomId, beds } = await hostelWithRoom();
    const row = (residentId: string, start: string) => ({
      hostel_id: hostelId,
      resident_id: residentId,
      bed_id: beds[0],
      room_id: roomId,
      start_date: start,
      created_by: owner.id,
    });
    const first = await admin
      .from("allocations")
      .insert(row(await resident(hostelId), daysFromToday(-10)));
    expect(first.error, RULE).toBeNull();
    const overlap = await admin.from("allocations").insert({
      ...row(await resident(hostelId), daysFromToday(-5)),
      end_date: daysFromToday(-1),
      vacate_reason: "moved_out",
    });
    expect(overlap.error?.code, RULE).toBe(EXCLUSION_VIOLATION);
  });

  it("lets exactly one of many simultaneous allocations of one bed succeed", async () => {
    const { hostelId, beds } = await hostelWithRoom();
    const residents = await Promise.all(Array.from({ length: 6 }, () => resident(hostelId)));
    const results = await Promise.all(
      residents.map((residentId) =>
        owner.client.rpc("allocate_bed", {
          p_resident_id: residentId,
          p_bed_id: beds[0],
          p_start_date: todayIst(),
        }),
      ),
    );
    expect(
      results.filter((result) => !result.error),
      RULE,
    ).toHaveLength(1);
    const { count } = await admin
      .from("allocations")
      .select("id", { count: "exact", head: true })
      .eq("bed_id", beds[0]);
    expect(count, RULE).toBe(1);
  });

  it("still allows a later stay on the same bed once the first has ended", async () => {
    const { hostelId, roomId, beds } = await hostelWithRoom();
    for (const [start, end] of [
      [daysFromToday(-30), daysFromToday(-20)],
      [daysFromToday(-19), null],
    ] as const) {
      const { error } = await admin.from("allocations").insert({
        hostel_id: hostelId,
        resident_id: await resident(hostelId),
        bed_id: beds[0],
        room_id: roomId,
        start_date: start,
        end_date: end,
        vacate_reason: end ? "moved_out" : null,
        created_by: owner.id,
      });
      expect(error, `${RULE}: back-to-back stays are allowed`).toBeNull();
    }
  });
});

describe("Rule: a resident never holds two beds on the same night", () => {
  it("rejects a second overlapping stay for one resident, even written directly", async () => {
    const { hostelId, roomId, beds } = await hostelWithRoom();
    const residentId = await resident(hostelId);
    const row = (bedId: string) => ({
      hostel_id: hostelId,
      resident_id: residentId,
      bed_id: bedId,
      room_id: roomId,
      start_date: daysFromToday(-3),
      created_by: owner.id,
    });
    expect((await admin.from("allocations").insert(row(beds[0]))).error).toBeNull();
    const second = await admin.from("allocations").insert(row(beds[1]));
    expect(second.error?.code, "no resident in two beds").toMatch(
      new RegExp(`${EXCLUSION_VIOLATION}|${UNIQUE_VIOLATION}`),
    );
  });
});

describe("Rule: room numbers are unique within a hostel", () => {
  it("rejects a duplicate, whatever its case or spacing", async () => {
    const { hostelId } = await hostelWithRoom();
    const { error } = await owner.client.from("rooms").insert({
      hostel_id: hostelId,
      room_number: "  101 ",
      floor: 2,
      sharing_type: "single",
      capacity: 1,
    });
    expect(error?.code, "unique room number per hostel").toBe(UNIQUE_VIOLATION);
  });

  it("allows the same number in another hostel", async () => {
    await hostelWithRoom();
    const otherHostel = (await createHostel(owner.id)).id;
    const { error } = await owner.client.from("rooms").insert({
      hostel_id: otherHostel,
      room_number: "101",
      floor: 1,
      sharing_type: "single",
      capacity: 1,
    });
    expect(error, "room numbers are scoped to their hostel").toBeNull();
  });
});

describe("Rule: one record per person per hostel", () => {
  it("rejects a second resident with the same phone or the same ID proof", async () => {
    const { hostelId } = await hostelWithRoom();
    const first = residentRow(hostelId);
    expect((await admin.from("residents").insert(first)).error).toBeNull();

    const samePhone = await admin
      .from("residents")
      .insert(residentRow(hostelId, { phone: first.phone }));
    expect(samePhone.error?.code, "unique resident phone per hostel").toBe(UNIQUE_VIOLATION);

    const sameId = await admin.from("residents").insert(
      residentRow(hostelId, {
        id_proof_type: first.id_proof_type,
        id_proof_hash: first.id_proof_hash,
      }),
    );
    expect(sameId.error?.code, "unique resident ID proof per hostel").toBe(UNIQUE_VIOLATION);
  });
});

describe("Rule: a resident is billed once per month", () => {
  const RULE = "one issued invoice per resident per month";

  async function billable() {
    const { hostelId, roomId, beds } = await hostelWithRoom(1);
    await owner.client.rpc("set_fee_structure", {
      p_hostel_id: hostelId,
      p_sharing_type: "single",
      p_monthly_amount: 900000,
      p_effective_from: "2025-01-01",
    });
    const residentId = await resident(hostelId);
    await admin.from("allocations").insert({
      hostel_id: hostelId,
      resident_id: residentId,
      bed_id: beds[0],
      room_id: roomId,
      start_date: "2025-06-01",
      created_by: owner.id,
    });
    return { hostelId, residentId };
  }

  it("creates nothing new when the month is generated again, or many times at once", async () => {
    const { hostelId, residentId } = await billable();
    const runs = await Promise.all(
      Array.from({ length: 5 }, () =>
        owner.client.rpc("generate_invoices", { p_hostel_id: hostelId, p_period_month: lastMonth }),
      ),
    );
    expect(
      runs.every((run) => !run.error),
      RULE,
    ).toBe(true);
    const again = await owner.client.rpc("generate_invoices", {
      p_hostel_id: hostelId,
      p_period_month: lastMonth,
    });
    expect(again.error).toBeNull();
    const { count } = await admin
      .from("invoices")
      .select("id", { count: "exact", head: true })
      .eq("resident_id", residentId);
    expect(count, RULE).toBe(1);
  });

  it("rejects a duplicate even when written directly", async () => {
    const { hostelId, residentId } = await billable();
    const row = {
      hostel_id: hostelId,
      resident_id: residentId,
      period_month: lastMonth,
      amount: 900000,
      due_date: `${lastMonth.slice(0, 8)}05`,
    };
    expect((await admin.from("invoices").insert(row)).error).toBeNull();
    expect((await admin.from("invoices").insert(row)).error?.code, RULE).toBe(UNIQUE_VIOLATION);
  });
});

describe("Rule: payments never exceed what is due", () => {
  it("lets simultaneous collectors pay an invoice in full exactly once", async () => {
    const { hostelId } = await hostelWithRoom();
    const residentId = await resident(hostelId);
    const { data: invoice } = await admin
      .from("invoices")
      .insert({
        hostel_id: hostelId,
        resident_id: residentId,
        period_month: lastMonth,
        amount: 500000,
        due_date: `${lastMonth.slice(0, 8)}05`,
      })
      .select("id")
      .single();
    const results = await Promise.all(
      Array.from({ length: 6 }, () =>
        owner.client.from("payments").insert({
          hostel_id: hostelId,
          invoice_id: invoice!.id,
          amount: 500000,
          paid_at: todayIst(),
          mode: "cash",
        }),
      ),
    );
    expect(
      results.filter((result) => !result.error),
      "no overpayment",
    ).toHaveLength(1);
  });
});

describe("Rule: history is never rewritten", () => {
  it("keeps the allocation audit trail immutable and stays with invoices undeletable", async () => {
    const { hostelId, beds } = await hostelWithRoom();
    const residentId = await resident(hostelId);
    const { data: allocationId } = await owner.client.rpc("allocate_bed", {
      p_resident_id: residentId,
      p_bed_id: beds[0],
      p_start_date: todayIst(),
    });

    const { data: event } = await admin
      .from("allocation_events")
      .select("id")
      .eq("allocation_id", allocationId!)
      .single();
    const edit = await admin
      .from("allocation_events")
      .update({ actor_name: "someone else" })
      .eq("id", event!.id);
    expect(edit.error?.hint, "audit rows are immutable").toBe("history_immutable");
    const remove = await admin.from("allocation_events").delete().eq("id", event!.id);
    expect(remove.error?.hint, "audit rows are never deleted").toBe("history_immutable");

    await admin.from("invoices").insert({
      hostel_id: hostelId,
      resident_id: residentId,
      allocation_id: allocationId,
      period_month: lastMonth,
      amount: 100,
      due_date: `${lastMonth.slice(0, 8)}05`,
    });
    const dropStay = await admin.from("allocations").delete().eq("id", allocationId!);
    expect(dropStay.error?.code, "a billed stay cannot be deleted").toBe("23503");
  });
});
