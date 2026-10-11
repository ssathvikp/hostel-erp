import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { todayIst } from "@/lib/validation";

import { residentRow } from "../support/residents";
import { anonClient, createUserFactory, type TestUser } from "../support/supabase";

/**
 * Tenant isolation for the allocation functions, the audit trail and the
 * occupancy views (E6-T2, E6-T4, E6-T5, E6-T7).
 */
const { admin, createUser, createHostel, cleanup } = createUserFactory();

let ownerA: TestUser;
let ownerB: TestUser;
let hostelA: string;
let hostelB: string;
let residentA: string;
let residentB: string;
let bedA: string;
let bedA2: string;
let bedB: string;
let allocationA: string;

afterAll(cleanup);

async function roomWithBeds(hostelId: string) {
  const { data: room } = await admin
    .from("rooms")
    .insert({
      hostel_id: hostelId,
      room_number: "1",
      floor: 1,
      sharing_type: "double",
      capacity: 2,
    })
    .select("id")
    .single();
  const { data: beds } = await admin
    .from("beds")
    .select("id")
    .eq("room_id", room!.id)
    .order("bed_label");
  return beds!.map((bed) => bed.id);
}

beforeAll(async () => {
  [ownerA, ownerB] = await Promise.all([createUser(), createUser()]);
  hostelA = (await createHostel(ownerA.id)).id;
  hostelB = (await createHostel(ownerB.id)).id;
  residentA = (await admin.from("residents").insert(residentRow(hostelA)).select("id").single())
    .data!.id;
  residentB = (await admin.from("residents").insert(residentRow(hostelB)).select("id").single())
    .data!.id;
  [bedA, bedA2] = await roomWithBeds(hostelA);
  [bedB] = await roomWithBeds(hostelB);

  const { data, error } = await ownerA.client.rpc("allocate_bed", {
    p_resident_id: residentA,
    p_bed_id: bedA,
    p_start_date: todayIst(),
  });
  if (error) throw error;
  allocationA = data;
});

describe("allocation functions", () => {
  it("do not let another hostel allocate its residents to my beds, or mine to its beds", async () => {
    const intoMine = await ownerB.client.rpc("allocate_bed", {
      p_resident_id: residentB,
      p_bed_id: bedA2,
      p_start_date: todayIst(),
    });
    expect(intoMine.error?.hint).toBe("bed_not_found");
    const mineIntoTheirs = await ownerB.client.rpc("allocate_bed", {
      p_resident_id: residentA,
      p_bed_id: bedB,
      p_start_date: todayIst(),
    });
    expect(mineIntoTheirs.error?.hint).toBe("resident_not_found");
  });

  it("do not let another hostel vacate or transfer my allocations", async () => {
    const vacate = await ownerB.client.rpc("vacate_allocation", {
      p_allocation_id: allocationA,
      p_move_out_date: todayIst(),
      p_reason: "moved_out",
    });
    expect(vacate.error?.hint).toBe("allocation_not_found");
    const transfer = await ownerB.client.rpc("transfer_allocation", {
      p_allocation_id: allocationA,
      p_new_bed_id: bedB,
      p_move_date: todayIst(),
    });
    expect(transfer.error?.hint).toBe("allocation_not_found");

    const { data } = await admin
      .from("allocations")
      .select("end_date")
      .eq("id", allocationA)
      .single();
    expect(data!.end_date).toBeNull();
  });

  it("cannot be called anonymously", async () => {
    const { error } = await anonClient().rpc("allocate_bed", {
      p_resident_id: residentA,
      p_bed_id: bedA2,
      p_start_date: todayIst(),
    });
    expect(error?.code).toBe("42501");
  });
});

describe("allocation history and occupancy views", () => {
  it("show each hostel only its own audit events", async () => {
    const mine = await ownerA.client.from("allocation_events").select("allocation_id");
    expect(mine.data).toEqual([{ allocation_id: allocationA }]);
    const theirs = await ownerB.client.from("allocation_events").select("id");
    expect(theirs.data).toEqual([]);
    const anon = await anonClient().from("allocation_events").select("id");
    expect(anon.data ?? []).toEqual([]);
  });

  it("show each hostel only its own floor and hostel occupancy", async () => {
    for (const view of ["floor_occupancy", "hostel_occupancy"] as const) {
      const mine = await ownerA.client.from(view).select("hostel_id, occupied_beds");
      expect(mine.data).toEqual([{ hostel_id: hostelA, occupied_beds: 1 }]);
      const theirs = await ownerB.client.from(view).select("hostel_id, occupied_beds");
      expect(theirs.data).toEqual([{ hostel_id: hostelB, occupied_beds: 0 }]);
      const anon = await anonClient().from(view).select("hostel_id");
      expect(anon.data ?? []).toEqual([]);
    }
  });
});
