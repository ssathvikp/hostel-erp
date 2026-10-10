import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { todayIst } from "@/lib/validation";

import { connectToDatabase } from "../support/db";
import { residentRow } from "../support/residents";
import { createUserFactory, type TestUser } from "../support/supabase";

/**
 * Allocation flows (E6-T2, E6-T3, E6-T4) and the audit trail (E6-T7), run
 * as real signed-in owners and staff through the same functions the app calls.
 */
const RAISED = "P0001";
const EXCLUSION_VIOLATION = "23P01";
const PERMISSION_DENIED = "42501";

const sql = connectToDatabase();
const { admin, createUser, createHostel, cleanup } = createUserFactory();

afterAll(async () => {
  await cleanup();
  await sql.end();
});

let owner: TestUser;
let staff: TestUser;
let hostelId: string;

beforeAll(async () => {
  owner = await createUser();
  hostelId = (await createHostel(owner.id)).id;
  staff = await createUser({ profile: { role: "staff", hostel_id: hostelId } });
});

/** `YYYY-MM-DD` shifted by whole days from today in India. */
function daysFromToday(days: number): string {
  const date = new Date(`${todayIst()}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

async function resident(overrides = {}) {
  const { data, error } = await admin
    .from("residents")
    .insert(residentRow(hostelId, overrides))
    .select("id, full_name")
    .single();
  if (error) throw error;
  return data;
}

let roomCounter = 0;
async function room(capacity = 2) {
  roomCounter += 1;
  const { data, error } = await admin
    .from("rooms")
    .insert({
      hostel_id: hostelId,
      room_number: `A${roomCounter}`,
      floor: 2,
      sharing_type: (["single", "double", "triple"] as const)[capacity - 1] ?? "four_plus",
      capacity,
    })
    .select("id")
    .single();
  if (error) throw error;
  const { data: beds } = await admin
    .from("beds")
    .select("id, bed_label")
    .eq("room_id", data.id)
    .order("bed_label");
  return { id: data.id, beds: beds! };
}

function allocate(user: TestUser, residentId: string, bedId: string, start = todayIst()) {
  return user.client.rpc("allocate_bed", {
    p_resident_id: residentId,
    p_bed_id: bedId,
    p_start_date: start,
  });
}

async function liveBed(residentId: string) {
  const { data } = await admin
    .from("resident_directory")
    .select("bed_label")
    .eq("id", residentId)
    .single();
  return data?.bed_label ?? null;
}

describe("allocating a bed (E6-T2)", () => {
  it("allocates a vacant bed to an active resident, recording actor and hostel", async () => {
    const r = await resident();
    const { id: roomId, beds } = await room();
    const { data: allocationId, error } = await allocate(staff, r.id, beds[0].id);
    expect(error).toBeNull();

    const { data: row } = await admin
      .from("allocations")
      .select("hostel_id, room_id, created_by, created_at, start_date, end_date")
      .eq("id", allocationId!)
      .single();
    expect(row).toMatchObject({
      hostel_id: hostelId,
      room_id: roomId,
      created_by: staff.id,
      start_date: todayIst(),
      end_date: null,
    });
    expect(row!.created_at).toBeTruthy();

    // Occupancy is derived; the bed row itself is untouched.
    const { data: bed } = await admin
      .from("bed_states")
      .select("status, manual_status")
      .eq("id", beds[0].id)
      .single();
    expect(bed).toEqual({ status: "occupied", manual_status: "available" });
  });

  it("refuses a resident who already holds a bed, with an explicit reason", async () => {
    const r = await resident();
    const { beds } = await room();
    await allocate(owner, r.id, beds[0].id);
    const { error } = await allocate(owner, r.id, beds[1].id);
    expect(error).toMatchObject({ code: RAISED, hint: "resident_has_bed" });
  });

  it("refuses vacated and blocked residents", async () => {
    const { beds } = await room();
    for (const status of ["vacated", "blocked"] as const) {
      const r = await resident();
      if (status === "vacated") {
        await admin.from("residents").update({ status: "notice" }).eq("id", r.id);
      }
      await admin.from("residents").update({ status }).eq("id", r.id);
      const { error } = await allocate(owner, r.id, beds[0].id);
      expect(error).toMatchObject({ code: RAISED, hint: "resident_not_allocatable" });
    }
  });

  it("refuses blocked, maintenance and retired beds", async () => {
    const r = await resident();
    const { id: roomId, beds } = await room(3);
    await admin
      .from("beds")
      .update({ status: "maintenance", status_reason: "Leaking roof" })
      .eq("id", beds[0].id);
    expect((await allocate(owner, r.id, beds[0].id)).error).toMatchObject({
      hint: "bed_out_of_service",
    });

    await admin.from("rooms").update({ sharing_type: "double", capacity: 2 }).eq("id", roomId);
    expect((await allocate(owner, r.id, beds[2].id)).error).toMatchObject({
      hint: "bed_retired",
    });
  });

  it("does not take advance bookings, but accepts a backdated start", async () => {
    const r = await resident();
    const { beds } = await room();
    expect((await allocate(owner, r.id, beds[0].id, daysFromToday(1))).error).toMatchObject({
      hint: "allocation_future",
    });
    expect((await allocate(owner, r.id, beds[0].id, daysFromToday(-20))).error).toBeNull();
  });

  it("refuses a bed or resident from another hostel", async () => {
    const otherOwner = await createUser();
    const otherHostel = (await createHostel(otherOwner.id)).id;
    const { data: stranger } = await admin
      .from("residents")
      .insert(residentRow(otherHostel))
      .select("id")
      .single();
    const { beds } = await room();
    const r = await resident();

    expect((await allocate(owner, stranger!.id, beds[0].id)).error).toMatchObject({
      hint: "resident_not_found",
    });
    expect((await allocate(otherOwner, r.id, beds[0].id)).error).toMatchObject({
      hint: "bed_not_found",
    });
  });
});

describe("double allocation (E6-T3)", () => {
  it("names the resident and dates holding the bed", async () => {
    const [first, second] = [await resident({ full_name: "Ravi Kumar" }), await resident()];
    const { beds } = await room();
    await allocate(owner, first.id, beds[0].id, daysFromToday(-3));

    const { error } = await allocate(owner, second.id, beds[0].id);
    expect(error).toMatchObject({ code: RAISED, hint: "bed_overlap" });
    expect(error!.message).toContain("Ravi Kumar");
    expect(error!.message).toContain("with no end date");
  });

  it("rejects a backdated allocation that overlaps a closed stay, and allows one that does not", async () => {
    const [past, next, later] = [
      await resident({ full_name: "Meena Rao" }),
      await resident(),
      await resident(),
    ];
    const { id: roomId, beds } = await room();
    // History: Meena slept in the bed from -40 to -21.
    const { error: fixture } = await admin.from("allocations").insert({
      hostel_id: hostelId,
      resident_id: past.id,
      bed_id: beds[0].id,
      room_id: roomId,
      start_date: daysFromToday(-40),
      end_date: daysFromToday(-21),
      vacate_reason: "moved_out",
      created_by: owner.id,
    });
    expect(fixture).toBeNull();

    const overlapping = await allocate(owner, next.id, beds[0].id, daysFromToday(-25));
    expect(overlapping.error).toMatchObject({ hint: "bed_overlap" });
    expect(overlapping.error!.message).toMatch(/Meena Rao from .* to /);

    expect((await allocate(owner, later.id, beds[0].id, daysFromToday(-20))).error).toBeNull();
  });

  it("is enforced by the database even for writes that skip the functions", async () => {
    const [a, b] = [await resident(), await resident()];
    const { id: roomId, beds } = await room();
    await allocate(owner, a.id, beds[0].id, daysFromToday(-5));
    // A closed stay for b that overlaps a's open one on the same bed.
    const { error } = await admin.from("allocations").insert({
      hostel_id: hostelId,
      resident_id: b.id,
      bed_id: beds[0].id,
      room_id: roomId,
      start_date: daysFromToday(-10),
      end_date: daysFromToday(-4),
      vacate_reason: "other",
      created_by: owner.id,
    });
    expect(error?.code).toBe(EXCLUSION_VIOLATION);
  });

  it("lets exactly one of many simultaneous requests for a bed win", async () => {
    for (let round = 0; round < 5; round += 1) {
      const residents = await Promise.all(Array.from({ length: 4 }, () => resident()));
      const { beds } = await room(1);
      const users = [owner, staff, owner, staff];
      const results = await Promise.all(
        residents.map((r, i) => allocate(users[i], r.id, beds[0].id)),
      );

      expect(results.filter((result) => result.error === null)).toHaveLength(1);
      for (const failed of results.filter((result) => result.error !== null)) {
        expect(failed.error!.hint).toBe("bed_overlap");
      }
      const [{ count }] = await sql`
        select count(*)::int as count from public.allocations where bed_id = ${beds[0].id}
      `;
      expect(count).toBe(1);
    }
  });

  it("never gives one resident two beds, even when requested at once", async () => {
    const r = await resident();
    const { beds } = await room(4);
    const results = await Promise.all(beds.map((bed) => allocate(owner, r.id, bed.id)));
    expect(results.filter((result) => result.error === null)).toHaveLength(1);
    const [{ count }] = await sql`
      select count(*)::int as count from public.allocations where resident_id = ${r.id}
    `;
    expect(count).toBe(1);
  });
});

describe("vacating (E6-T4)", () => {
  it("closes the allocation the day before move-out and frees the bed today", async () => {
    const r = await resident();
    const { beds } = await room();
    const { data: allocationId } = await allocate(owner, r.id, beds[0].id, daysFromToday(-10));

    const { error } = await staff.client.rpc("vacate_allocation", {
      p_allocation_id: allocationId!,
      p_move_out_date: todayIst(),
      p_reason: "moved_out",
    });
    expect(error).toBeNull();

    const { data: row } = await admin
      .from("allocations")
      .select("end_date, vacate_reason")
      .eq("id", allocationId!)
      .single();
    expect(row).toEqual({ end_date: daysFromToday(-1), vacate_reason: "moved_out" });
    const { data: bed } = await admin
      .from("bed_states")
      .select("status")
      .eq("id", beds[0].id)
      .single();
    expect(bed!.status).toBe("available");
    expect(await liveBed(r.id)).toBeNull();
  });

  it("can mark the resident vacated in the same step, keeping them searchable", async () => {
    const r = await resident();
    const { beds } = await room();
    const { data: allocationId } = await allocate(owner, r.id, beds[0].id, daysFromToday(-10));
    const { error } = await owner.client.rpc("vacate_allocation", {
      p_allocation_id: allocationId!,
      p_move_out_date: todayIst(),
      p_reason: "evicted",
      p_mark_vacated: true,
    });
    expect(error).toBeNull();
    const { data } = await owner.client
      .from("resident_directory")
      .select("status, bed_label")
      .eq("id", r.id)
      .single();
    expect(data).toEqual({ status: "vacated", bed_label: null });
  });

  it("refuses a future move-out, a move-out on the first night, a closed allocation and an unknown reason", async () => {
    const r = await resident();
    const { beds } = await room();
    const { data: allocationId } = await allocate(owner, r.id, beds[0].id, daysFromToday(-2));
    const vacate = (move: string, reason = "moved_out") =>
      owner.client.rpc("vacate_allocation", {
        p_allocation_id: allocationId!,
        p_move_out_date: move,
        p_reason: reason,
      });

    expect((await vacate(daysFromToday(1))).error).toMatchObject({ hint: "move_future" });
    expect((await vacate(daysFromToday(-2))).error).toMatchObject({
      hint: "allocation_same_day",
    });
    expect((await vacate(todayIst(), "transferred")).error).toMatchObject({
      hint: "vacate_reason",
    });
    expect((await vacate(todayIst())).error).toBeNull();
    expect((await vacate(todayIst())).error).toMatchObject({ hint: "allocation_closed" });
  });
});

describe("transferring (E6-T4)", () => {
  it("moves the resident in one step: old bed free, new bed occupied", async () => {
    const r = await resident();
    const from = await room();
    const to = await room();
    const { data: allocationId } = await allocate(owner, r.id, from.beds[0].id, daysFromToday(-7));

    const { data: newId, error } = await staff.client.rpc("transfer_allocation", {
      p_allocation_id: allocationId!,
      p_new_bed_id: to.beds[1].id,
      p_move_date: todayIst(),
    });
    expect(error).toBeNull();

    const { data: rows } = await admin
      .from("allocations")
      .select("id, bed_id, room_id, start_date, end_date, vacate_reason")
      .eq("resident_id", r.id)
      .order("start_date");
    expect(rows).toEqual([
      {
        id: allocationId,
        bed_id: from.beds[0].id,
        room_id: from.id,
        start_date: daysFromToday(-7),
        end_date: daysFromToday(-1),
        vacate_reason: "transferred",
      },
      {
        id: newId,
        bed_id: to.beds[1].id,
        room_id: to.id,
        start_date: todayIst(),
        end_date: null,
        vacate_reason: null,
      },
    ]);
    const { data: states } = await admin
      .from("bed_states")
      .select("id, status")
      .in("id", [from.beds[0].id, to.beds[1].id]);
    expect(Object.fromEntries(states!.map((s) => [s.id, s.status]))).toEqual({
      [from.beds[0].id]: "available",
      [to.beds[1].id]: "occupied",
    });
  });

  it("rolls back completely when the new bed is taken", async () => {
    const [mover, holder] = [await resident(), await resident({ full_name: "Kiran Das" })];
    const from = await room();
    const to = await room(1);
    const { data: allocationId } = await allocate(
      owner,
      mover.id,
      from.beds[0].id,
      daysFromToday(-7),
    );
    await allocate(owner, holder.id, to.beds[0].id, daysFromToday(-3));

    const { error } = await owner.client.rpc("transfer_allocation", {
      p_allocation_id: allocationId!,
      p_new_bed_id: to.beds[0].id,
      p_move_date: todayIst(),
    });
    expect(error).toMatchObject({ hint: "bed_overlap" });
    expect(error!.message).toContain("Kiran Das");

    // The old allocation is still open: nothing changed.
    const { data: rows } = await admin
      .from("allocations")
      .select("end_date")
      .eq("resident_id", mover.id);
    expect(rows).toEqual([{ end_date: null }]);
    expect(await liveBed(mover.id)).toBe(from.beds[0].bed_label);
    const { count } = await admin
      .from("allocation_events")
      .select("id", { count: "exact", head: true })
      .eq("resident_id", mover.id);
    expect(count).toBe(1);
  });

  it("rolls back when the new bed is out of service or the same bed", async () => {
    const r = await resident();
    const from = await room();
    const to = await room();
    await admin
      .from("beds")
      .update({ status: "blocked", status_reason: "Reserved for staff" })
      .eq("id", to.beds[0].id);
    const { data: allocationId } = await allocate(owner, r.id, from.beds[0].id, daysFromToday(-7));
    const transfer = (bedId: string) =>
      owner.client.rpc("transfer_allocation", {
        p_allocation_id: allocationId!,
        p_new_bed_id: bedId,
        p_move_date: todayIst(),
      });

    expect((await transfer(to.beds[0].id)).error).toMatchObject({ hint: "bed_out_of_service" });
    expect((await transfer(from.beds[0].id)).error).toMatchObject({ hint: "transfer_same_bed" });
    const { data: rows } = await admin
      .from("allocations")
      .select("end_date")
      .eq("resident_id", r.id);
    expect(rows).toEqual([{ end_date: null }]);
  });
});

describe("audit trail (E6-T7)", () => {
  it("logs allocate, transfer and vacate with actor and previous and new state", async () => {
    const r = await resident();
    const from = await room();
    const to = await room();
    const { data: first } = await allocate(owner, r.id, from.beds[0].id, daysFromToday(-9));
    const { data: second } = await staff.client.rpc("transfer_allocation", {
      p_allocation_id: first!,
      p_new_bed_id: to.beds[0].id,
      p_move_date: daysFromToday(-2),
    });
    await owner.client.rpc("vacate_allocation", {
      p_allocation_id: second!,
      p_move_out_date: todayIst(),
      p_reason: "moved_out",
    });

    const { data: events } = await staff.client
      .from("allocation_events")
      .select(
        "allocation_id, action, effective_date, actor_id, actor_name, previous_state, new_state",
      )
      .eq("resident_id", r.id)
      .order("id");
    expect(events).toMatchObject([
      {
        allocation_id: first,
        action: "allocated",
        effective_date: daysFromToday(-9),
        actor_id: owner.id,
        actor_name: "Test User",
        previous_state: null,
        new_state: { bed_id: from.beds[0].id, end_date: null },
      },
      {
        allocation_id: first,
        action: "transferred_out",
        effective_date: daysFromToday(-2),
        actor_id: staff.id,
        previous_state: { end_date: null, vacate_reason: null },
        new_state: { end_date: daysFromToday(-3), vacate_reason: "transferred" },
      },
      {
        allocation_id: second,
        action: "transferred_in",
        effective_date: daysFromToday(-2),
        actor_id: staff.id,
        new_state: { bed_id: to.beds[0].id, transferred_from: first },
      },
      {
        allocation_id: second,
        action: "vacated",
        effective_date: todayIst(),
        actor_id: owner.id,
        new_state: { end_date: daysFromToday(-1), vacate_reason: "moved_out" },
      },
    ]);
  });

  it("cannot be written, edited or deleted by users, and is immutable even for the database owner", async () => {
    const r = await resident();
    const { beds } = await room();
    await allocate(owner, r.id, beds[0].id);
    const { data: event } = await owner.client
      .from("allocation_events")
      .select("id, hostel_id, allocation_id, resident_id, bed_id, room_id")
      .eq("resident_id", r.id)
      .single();

    const insert = await owner.client.from("allocation_events").insert({
      ...event!,
      id: undefined,
      action: "vacated",
      effective_date: todayIst(),
      new_state: {},
    } as never);
    expect(insert.error?.code).toBe(PERMISSION_DENIED);
    const update = await owner.client
      .from("allocation_events")
      .update({ action: "vacated" })
      .eq("id", event!.id);
    expect(update.error?.code).toBe(PERMISSION_DENIED);
    const remove = await owner.client.from("allocation_events").delete().eq("id", event!.id);
    expect(remove.error?.code).toBe(PERMISSION_DENIED);

    await expect(
      sql`update public.allocation_events set action = 'vacated' where id = ${event!.id}`,
    ).rejects.toMatchObject({ hint: "history_immutable" });
    await expect(
      sql`delete from public.allocation_events where id = ${event!.id}`,
    ).rejects.toMatchObject({ hint: "history_immutable" });
  });

  it("refuses to reopen or rewrite a closed allocation", async () => {
    const r = await resident();
    const { beds } = await room();
    const { data: allocationId } = await allocate(owner, r.id, beds[0].id, daysFromToday(-4));
    await owner.client.rpc("vacate_allocation", {
      p_allocation_id: allocationId!,
      p_move_out_date: todayIst(),
      p_reason: "other",
    });
    const { error } = await owner.client
      .from("allocations")
      .update({ end_date: null, vacate_reason: null })
      .eq("id", allocationId!);
    expect(error).toMatchObject({ code: RAISED, hint: "allocation_closed" });
  });
});
