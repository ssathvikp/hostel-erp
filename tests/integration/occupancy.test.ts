import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { todayIst } from "@/lib/validation";

import { residentRow } from "../support/residents";
import { createUserFactory, type TestUser } from "../support/supabase";

/**
 * Derived occupancy (E6-T5): room, floor and hostel figures all come from
 * live allocations and always agree with each other.
 */
const { admin, createUser, createHostel, cleanup } = createUserFactory();

afterAll(cleanup);

function daysFromToday(days: number): string {
  const date = new Date(`${todayIst()}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

async function insertRoom(hostelId: string, room_number: string, floor: number, capacity: number) {
  const sharing_type = (["single", "double", "triple"] as const)[capacity - 1] ?? "four_plus";
  const { data, error } = await admin
    .from("rooms")
    .insert({ hostel_id: hostelId, room_number, floor, sharing_type, capacity })
    .select("id")
    .single();
  if (error) throw error;
  const { data: beds } = await admin
    .from("beds")
    .select("id")
    .eq("room_id", data.id)
    .order("bed_label");
  return { id: data.id, beds: beds!.map((bed) => bed.id) };
}

async function stay(
  owner: TestUser,
  hostelId: string,
  room: { id: string },
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
    room_id: room.id,
    start_date: start,
    end_date: end,
    vacate_reason: end ? "moved_out" : null,
    created_by: owner.id,
  });
  if (error) throw error;
}

describe("occupancy fixture", () => {
  let owner: TestUser;
  let hostelId: string;

  beforeAll(async () => {
    owner = await createUser();
    hostelId = (await createHostel(owner.id)).id;

    // Floor 0: G1 (double): one live stay, one bed vacant.
    const g1 = await insertRoom(hostelId, "G1", 0, 2);
    await stay(owner, hostelId, g1, g1.beds[0], daysFromToday(-30));

    // Floor 1: 101 (triple): live stay ending today, a stay that ended
    // yesterday, and a maintenance bed.
    const r101 = await insertRoom(hostelId, "101", 1, 3);
    await stay(owner, hostelId, r101, r101.beds[0], daysFromToday(-10), todayIst());
    await stay(owner, hostelId, r101, r101.beds[1], daysFromToday(-10), daysFromToday(-1));
    await admin
      .from("beds")
      .update({ status: "maintenance", status_reason: "Broken frame" })
      .eq("id", r101.beds[2]);

    // Floor 1: 102 (single): blocked. 103 (double): archived, not counted.
    const r102 = await insertRoom(hostelId, "102", 1, 1);
    await admin
      .from("beds")
      .update({ status: "blocked", status_reason: "Owner's guest" })
      .eq("id", r102.beds[0]);
    const r103 = await insertRoom(hostelId, "103", 1, 2);
    await admin.from("rooms").update({ status: "archived" }).eq("id", r103.id);

    // Floor 2: 201 (four sharing): two live, one starting tomorrow (not live yet).
    const r201 = await insertRoom(hostelId, "201", 2, 4);
    await stay(owner, hostelId, r201, r201.beds[0], todayIst());
    await stay(owner, hostelId, r201, r201.beds[1], daysFromToday(-60));
    await stay(owner, hostelId, r201, r201.beds[2], daysFromToday(1));
  });

  it("counts each room from live allocations", async () => {
    const { data } = await owner.client
      .from("room_inventory")
      .select("room_number, total_beds, occupied_beds, available_beds, out_of_service_beds")
      .eq("hostel_id", hostelId)
      .order("floor")
      .order("room_sort");
    expect(data).toEqual([
      {
        room_number: "G1",
        total_beds: 2,
        occupied_beds: 1,
        available_beds: 1,
        out_of_service_beds: 0,
      },
      {
        room_number: "101",
        total_beds: 3,
        occupied_beds: 1,
        available_beds: 1,
        out_of_service_beds: 1,
      },
      {
        room_number: "102",
        total_beds: 1,
        occupied_beds: 0,
        available_beds: 0,
        out_of_service_beds: 1,
      },
      {
        room_number: "103",
        total_beds: 0,
        occupied_beds: 0,
        available_beds: 0,
        out_of_service_beds: 0,
      },
      {
        room_number: "201",
        total_beds: 4,
        occupied_beds: 2,
        available_beds: 2,
        out_of_service_beds: 0,
      },
    ]);
  });

  it("totals floors from the rooms, excluding archived rooms", async () => {
    const { data } = await owner.client
      .from("floor_occupancy")
      .select("floor, rooms, total_beds, occupied_beds, vacant_beds, out_of_service_beds")
      .eq("hostel_id", hostelId)
      .order("floor");
    expect(data).toEqual([
      {
        floor: 0,
        rooms: 1,
        total_beds: 2,
        occupied_beds: 1,
        vacant_beds: 1,
        out_of_service_beds: 0,
      },
      {
        floor: 1,
        rooms: 2,
        total_beds: 4,
        occupied_beds: 1,
        vacant_beds: 1,
        out_of_service_beds: 2,
      },
      {
        floor: 2,
        rooms: 1,
        total_beds: 4,
        occupied_beds: 2,
        vacant_beds: 2,
        out_of_service_beds: 0,
      },
    ]);
  });

  it("totals the hostel from the floors, and every bed is in exactly one bucket", async () => {
    const { data } = await owner.client
      .from("hostel_occupancy")
      .select("rooms, total_beds, occupied_beds, vacant_beds, out_of_service_beds")
      .eq("hostel_id", hostelId)
      .single();
    expect(data).toEqual({
      rooms: 4,
      total_beds: 10,
      occupied_beds: 4,
      vacant_beds: 4,
      out_of_service_beds: 2,
    });
    expect(data!.occupied_beds + data!.vacant_beds + data!.out_of_service_beds).toBe(
      data!.total_beds,
    );
  });

  it("matches the residents the directory shows in a bed", async () => {
    const { count } = await owner.client
      .from("resident_directory")
      .select("id", { count: "exact", head: true })
      .eq("hostel_id", hostelId)
      .not("bed_label", "is", null);
    expect(count).toBe(4);
  });
});

describe("occupancy at scale", () => {
  it("answers for 500 beds across 100 rooms quickly", async () => {
    const owner = await createUser();
    const hostelId = (await createHostel(owner.id)).id;
    const { error } = await owner.client.rpc("create_rooms_bulk", {
      p_hostel_id: hostelId,
      p_from: 1,
      p_to: 100,
      p_floor: 1,
      p_sharing_type: "four_plus",
      p_capacity: 5,
    });
    expect(error).toBeNull();

    // Fill 300 of the 500 beds.
    const { data: beds } = await admin
      .from("beds")
      .select("id, room_id")
      .eq("hostel_id", hostelId)
      .order("bed_label")
      .limit(300);
    const { data: residents } = await admin
      .from("residents")
      .insert(beds!.map(() => residentRow(hostelId)))
      .select("id");
    const { error: allocationError } = await admin.from("allocations").insert(
      beds!.map((bed, i) => ({
        hostel_id: hostelId,
        resident_id: residents![i].id,
        bed_id: bed.id,
        room_id: bed.room_id,
        start_date: daysFromToday(-5),
        created_by: owner.id,
      })),
    );
    expect(allocationError).toBeNull();

    const started = performance.now();
    const [hostel, rooms] = await Promise.all([
      owner.client.from("hostel_occupancy").select("*").eq("hostel_id", hostelId).single(),
      owner.client.from("room_inventory").select("*").eq("hostel_id", hostelId),
    ]);
    const elapsed = performance.now() - started;

    expect(hostel.data).toMatchObject({ total_beds: 500, occupied_beds: 300, vacant_beds: 200 });
    expect(rooms.data).toHaveLength(100);
    expect(elapsed).toBeLessThan(1500);
  });
});
