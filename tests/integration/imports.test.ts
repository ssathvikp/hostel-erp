import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { fakeIdHash, randomMobile } from "../support/residents";
import { createUserFactory, type TestUser } from "../support/supabase";

/**
 * Spreadsheet import functions: one statement each, so a file goes in
 * whole or not at all, and RLS decides who may import.
 */
const PERMISSION_DENIED = "42501";

const { admin, createUser, createHostel, cleanup } = createUserFactory();

afterAll(cleanup);

let owner: TestUser;
let staff: TestUser;
let otherOwner: TestUser;
let hostelId: string;

beforeAll(async () => {
  [owner, otherOwner] = await Promise.all([createUser(), createUser()]);
  hostelId = (await createHostel(owner.id)).id;
  await createHostel(otherOwner.id);
  staff = await createUser({ profile: { role: "staff", hostel_id: hostelId } });
});

const room = (room_number: string, sharing_type = "double", capacity = 2) => ({
  room_number,
  floor: 1,
  sharing_type,
  capacity,
});

function resident(name: string, phone = randomMobile()) {
  return {
    full_name: name,
    phone,
    alt_phone: null,
    email: null,
    gender: "female",
    dob: "2001-03-04",
    id_proof_type: "aadhaar",
    id_proof_last4: "0123",
    id_proof_hash: fakeIdHash(),
    guardian_name: null,
    guardian_phone: null,
    permanent_address: "5 Temple Street",
    joining_date: "2026-06-01",
    notes: null,
  };
}

describe("importing rooms", () => {
  it("creates every room with its beds", async () => {
    const { data, error } = await owner.client.rpc("import_rooms", {
      p_hostel_id: hostelId,
      p_rooms: [room("201"), room("202", "triple", 3), room("203", "single", 1)],
    });
    expect(error).toBeNull();
    expect(data).toEqual([{ rooms_created: 3, beds_created: 6 }]);
    const { count } = await owner.client
      .from("bed_states")
      .select("id", { count: "exact", head: true })
      .eq("hostel_id", hostelId);
    expect(count).toBe(6);
  });

  it("rolls back the whole file when one room already exists", async () => {
    const { error } = await owner.client.rpc("import_rooms", {
      p_hostel_id: hostelId,
      p_rooms: [room("301"), room("201")],
    });
    expect(error?.code).toBe("23505");
    const { data } = await owner.client
      .from("rooms")
      .select("id")
      .eq("hostel_id", hostelId)
      .eq("room_number", "301");
    expect(data).toEqual([]);
  });

  it("is for owners only, and only into their own hostel", async () => {
    const byStaff = await staff.client.rpc("import_rooms", {
      p_hostel_id: hostelId,
      p_rooms: [room("401")],
    });
    expect(byStaff.error?.code).toBe(PERMISSION_DENIED);
    const intoOther = await otherOwner.client.rpc("import_rooms", {
      p_hostel_id: hostelId,
      p_rooms: [room("402")],
    });
    expect(intoOther.error?.code).toBe(PERMISSION_DENIED);
  });

  it("refuses an empty or oversized batch", async () => {
    const empty = await owner.client.rpc("import_rooms", { p_hostel_id: hostelId, p_rooms: [] });
    expect(empty.error?.hint).toBe("import_size");
    const big = Array.from({ length: 501 }, (_, i) => room(String(1000 + i)));
    const tooMany = await owner.client.rpc("import_rooms", { p_hostel_id: hostelId, p_rooms: big });
    expect(tooMany.error?.hint).toBe("import_size");
  });
});

describe("importing residents", () => {
  it("lets staff import, recording them as the creator", async () => {
    const { data, error } = await staff.client.rpc("import_residents", {
      p_hostel_id: hostelId,
      p_residents: [resident("Asha One"), resident("Asha Two")],
    });
    expect(error).toBeNull();
    expect(data).toBe(2);
    const { data: rows } = await admin
      .from("residents")
      .select("created_by, status")
      .eq("hostel_id", hostelId)
      .like("full_name", "Asha %");
    expect(rows).toEqual([
      { created_by: staff.id, status: "active" },
      { created_by: staff.id, status: "active" },
    ]);
  });

  it("rolls back on a duplicate mobile and keeps hostels apart", async () => {
    const phone = randomMobile();
    await owner.client.rpc("import_residents", {
      p_hostel_id: hostelId,
      p_residents: [resident("First", phone)],
    });
    const again = await owner.client.rpc("import_residents", {
      p_hostel_id: hostelId,
      p_residents: [resident("Fresh"), resident("Second", phone)],
    });
    expect(again.error?.code).toBe("23505");
    const { data } = await owner.client.from("residents").select("id").eq("full_name", "Fresh");
    expect(data).toEqual([]);

    const intoOther = await otherOwner.client.rpc("import_residents", {
      p_hostel_id: hostelId,
      p_residents: [resident("Intruder")],
    });
    expect(intoOther.error?.code).toBe(PERMISSION_DENIED);
  });
});
