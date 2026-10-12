import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { getVacantBeds } from "@/features/allocations/queries";
import { getOccupancySnapshot } from "@/features/occupancy/queries";
import { API_MAX_ROWS } from "@/lib/pagination";

import { createUserFactory, type TestUser } from "../support/supabase";

/**
 * A hostel bigger than the API's 1000-row response cap. Lists built from
 * every bed must still see every bed, not a silently truncated first page.
 */
const { createUser, createHostel, cleanup } = createUserFactory();

afterAll(cleanup);

let owner: TestUser;
let hostelId: string;
const ROOMS = 90;
const BEDS_PER_ROOM = 12;

beforeAll(async () => {
  owner = await createUser();
  hostelId = (await createHostel(owner.id)).id;
  const { error } = await owner.client.rpc("create_rooms_bulk", {
    p_hostel_id: hostelId,
    p_from: 1,
    p_to: ROOMS,
    p_floor: 1,
    p_sharing_type: "four_plus",
    p_capacity: BEDS_PER_ROOM,
  });
  if (error) throw error;
});

describe("a hostel with more beds than one API response holds", () => {
  it("shows every bed on the occupancy page", async () => {
    expect(ROOMS * BEDS_PER_ROOM).toBeGreaterThan(API_MAX_ROWS);
    const snapshot = await getOccupancySnapshot(owner.client, hostelId);
    const beds = snapshot.floors.flatMap((floor) => floor.roomList.flatMap((room) => room.beds));
    expect(snapshot.hostel.totalBeds).toBe(ROOMS * BEDS_PER_ROOM);
    expect(beds).toHaveLength(ROOMS * BEDS_PER_ROOM);
    expect(new Set(beds.map((bed) => bed.id)).size).toBe(beds.length);
  });

  it("offers every vacant bed for allocation", async () => {
    const beds = await getVacantBeds(owner.client, hostelId);
    expect(beds).toHaveLength(ROOMS * BEDS_PER_ROOM);
    expect(new Set(beds.map((bed) => bed.id)).size).toBe(beds.length);
  });
});
