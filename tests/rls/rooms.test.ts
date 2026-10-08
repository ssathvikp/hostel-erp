import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { anonClient, createUserFactory, type TestUser } from "../support/supabase";

/**
 * Tenant isolation for rooms and beds (E4-T1). Every assertion runs as a
 * real signed-in user against the real policies and grants.
 */
const PERMISSION_DENIED = "42501";
const FOREIGN_KEY_VIOLATION = "23503";

const { admin, createUser, createHostel, cleanup } = createUserFactory();

afterAll(cleanup);

let ownerA: TestUser;
let ownerB: TestUser;
let staffA: TestUser;
let hostelA: string;
let hostelB: string;
let roomA: string;
let roomB: string;
let bedA: string;

const room = { floor: 1, sharing_type: "double", capacity: 2 } as const;

beforeAll(async () => {
  [ownerA, ownerB] = await Promise.all([createUser(), createUser()]);
  hostelA = (await createHostel(ownerA.id)).id;
  hostelB = (await createHostel(ownerB.id)).id;
  staffA = await createUser({ profile: { role: "staff", hostel_id: hostelA } });

  const a = await ownerA.client
    .from("rooms")
    .insert({ ...room, hostel_id: hostelA, room_number: "101" })
    .select("id")
    .single();
  const b = await ownerB.client
    .from("rooms")
    .insert({ ...room, hostel_id: hostelB, room_number: "101" })
    .select("id")
    .single();
  roomA = a.data!.id;
  roomB = b.data!.id;

  const { data: beds } = await admin.from("beds").select("id").eq("room_id", roomA).limit(1);
  bedA = beds![0].id;
});

describe("reading", () => {
  it("shows each owner only their own rooms and beds", async () => {
    const rooms = await ownerA.client.from("rooms").select("id");
    expect(rooms.data?.map((row) => row.id)).toEqual([roomA]);

    const beds = await ownerA.client.from("beds").select("room_id");
    expect(new Set(beds.data?.map((row) => row.room_id))).toEqual(new Set([roomA]));
  });

  it("returns nothing when another tenant's room or beds are requested by id", async () => {
    const rooms = await ownerB.client.from("rooms").select("*").eq("id", roomA);
    expect(rooms.data).toEqual([]);
    const beds = await ownerB.client.from("beds").select("*").eq("room_id", roomA);
    expect(beds.data).toEqual([]);
  });

  it("applies the same isolation to the read views", async () => {
    const inventory = await ownerB.client.from("room_inventory").select("id");
    expect(inventory.data?.map((row) => row.id)).toEqual([roomB]);
    const states = await ownerB.client.from("bed_states").select("room_id").eq("room_id", roomA);
    expect(states.data).toEqual([]);
  });

  it("lets staff read their hostel's rooms and beds", async () => {
    const rooms = await staffA.client.from("rooms").select("id");
    expect(rooms.data?.map((row) => row.id)).toEqual([roomA]);
    const beds = await staffA.client.from("bed_states").select("id").eq("room_id", roomA);
    expect(beds.data).toHaveLength(2);
  });

  it("denies a signed-out visitor all access", async () => {
    const anon = anonClient();
    const results = await Promise.all([
      anon.from("rooms").select("id"),
      anon.from("beds").select("id"),
      anon.from("room_inventory").select("id"),
      anon.from("bed_states").select("id"),
    ]);
    expect(results.map((result) => result.error?.code)).toEqual(Array(4).fill(PERMISSION_DENIED));
  });
});

describe("writing", () => {
  it("does not let an owner create a room in another tenant's hostel", async () => {
    const { error } = await ownerB.client
      .from("rooms")
      .insert({ ...room, hostel_id: hostelA, room_number: "999" });
    expect(error?.code).toBe(PERMISSION_DENIED);
  });

  it("does not let bulk generation write into another tenant's hostel", async () => {
    const { error } = await ownerB.client.rpc("create_rooms_bulk", {
      p_hostel_id: hostelA,
      p_from: 500,
      p_to: 502,
      p_floor: 5,
      p_sharing_type: "single",
      p_capacity: 1,
    });
    expect(error?.code).toBe(PERMISSION_DENIED);
  });

  it("does not let an owner edit, archive or delete another tenant's room", async () => {
    const edit = await ownerB.client
      .from("rooms")
      .update({ floor: 9 })
      .eq("id", roomA)
      .select("id");
    expect(edit.data).toEqual([]);
    const archive = await ownerB.client
      .from("rooms")
      .update({ status: "archived" })
      .eq("id", roomA)
      .select("id");
    expect(archive.data).toEqual([]);
    const remove = await ownerB.client.from("rooms").delete().eq("id", roomA).select("id");
    expect(remove.data).toEqual([]);

    const { data } = await admin.from("rooms").select("floor, status").eq("id", roomA).single();
    expect(data).toEqual({ floor: 1, status: "active" });
  });

  it("does not let an owner change the status of another tenant's bed", async () => {
    const { data } = await ownerB.client
      .from("beds")
      .update({ status: "blocked" })
      .eq("id", bedA)
      .select("id");
    expect(data).toEqual([]);
  });

  it("does not let an owner move a room into another hostel", async () => {
    const { error } = await ownerA.client
      .from("rooms")
      .update({ hostel_id: hostelB } as never)
      .eq("id", roomA);
    expect(error?.code).toBe(PERMISSION_DENIED);
  });

  it("lets staff change bed status but not create, edit or delete rooms", async () => {
    const block = await staffA.client
      .from("beds")
      .update({ status: "maintenance", status_reason: "Leaking tap" })
      .eq("id", bedA)
      .select("status_changed_by")
      .single();
    expect(block.error).toBeNull();
    expect(block.data?.status_changed_by).toBe(staffA.id);

    const create = await staffA.client
      .from("rooms")
      .insert({ ...room, hostel_id: hostelA, room_number: "S1" });
    expect(create.error?.code).toBe(PERMISSION_DENIED);

    const edit = await staffA.client.from("rooms").update({ floor: 3 }).eq("id", roomA).select();
    expect(edit.data).toEqual([]);
    const remove = await staffA.client.from("rooms").delete().eq("id", roomA).select();
    expect(remove.data).toEqual([]);
  });
});

describe("composite tenant keys", () => {
  it("makes it impossible for a bed to belong to a room in another hostel", async () => {
    // Even the service role, which bypasses RLS, cannot create the mismatch.
    const { error } = await admin
      .from("beds")
      .insert({ hostel_id: hostelB, room_id: roomA, bed_label: "101-Z" });
    expect(error?.code).toBe(FOREIGN_KEY_VIOLATION);
  });
});
