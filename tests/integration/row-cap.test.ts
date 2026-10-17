import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { API_MAX_ROWS, fetchAll } from "@/lib/pagination";

import { createUserFactory, type TestUser } from "../support/supabase";

/**
 * Lists that can pass the API's 1000-row cap are read page by page
 * (review fix 17). A hostel with 1,200 beds must show all of them.
 */
const { createUser, createHostel, cleanup } = createUserFactory();

afterAll(cleanup);

let owner: TestUser;
let hostelId: string;

beforeAll(async () => {
  owner = await createUser();
  hostelId = (await createHostel(owner.id, { floors: 12 })).id;
  // 12 floors of 10 rooms with 10 beds each: 1,200 beds.
  for (let floor = 1; floor <= 12; floor++) {
    const { error } = await owner.client.rpc("create_rooms_bulk", {
      p_hostel_id: hostelId,
      p_from: floor * 100 + 1,
      p_to: floor * 100 + 10,
      p_floor: floor,
      p_sharing_type: "four_plus",
      p_capacity: 10,
    });
    if (error) throw error;
  }
}, 60_000);

describe("reading past the row cap", () => {
  it("is needed: a plain read stops at the cap", async () => {
    const { data } = await owner.client.from("bed_states").select("id").eq("hostel_id", hostelId);
    expect(data).toHaveLength(API_MAX_ROWS);
  });

  it("returns every row exactly once with fetchAll", async () => {
    const beds = await fetchAll((from, to) =>
      owner.client
        .from("bed_states")
        .select("id")
        .eq("hostel_id", hostelId)
        .order("bed_label")
        .order("id")
        .range(from, to),
    );
    expect(beds).toHaveLength(1200);
    expect(new Set(beds.map((bed) => bed.id)).size).toBe(1200);
  });

  it("stops after a short page and surfaces errors", async () => {
    const pages: number[] = [];
    const rows = await fetchAll(async (from) => {
      pages.push(from);
      return { data: from === 0 ? [1, 2] : [3], error: null };
    }, 2);
    expect(rows).toEqual([1, 2, 3]);
    expect(pages).toEqual([0, 2]);
    await expect(fetchAll(async () => ({ data: null, error: new Error("boom") }))).rejects.toThrow(
      "boom",
    );
  });
});
