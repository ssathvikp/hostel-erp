import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { todayIst } from "@/lib/validation";

import { connectToDatabase } from "../support/db";
import { fakeIdHash, randomMobile, residentRow } from "../support/residents";
import { createUserFactory, type TestUser } from "../support/supabase";

/**
 * Residents (E5-T1, E5-T3, E5-T6) and allocations (E6-T1): the integrity
 * rules, run as a real signed-in owner or staff member.
 */
const UNIQUE_VIOLATION = "23505";
const CHECK_VIOLATION = "23514";
const FOREIGN_KEY_VIOLATION = "23503";
const PERMISSION_DENIED = "42501";
const RAISED = "P0001";

const sql = connectToDatabase();
const { admin, createUser, createHostel, cleanup } = createUserFactory();

afterAll(async () => {
  await cleanup();
  await sql.end();
});

let owner: TestUser;
let staff: TestUser;
let hostelId: string;

/** `YYYY-MM-DD` shifted by whole days from today in India. */
function daysFromToday(days: number): string {
  const date = new Date(`${todayIst()}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

beforeAll(async () => {
  owner = await createUser();
  hostelId = (await createHostel(owner.id)).id;
  staff = await createUser({ profile: { role: "staff", hostel_id: hostelId } });
});

async function register(user: TestUser, overrides = {}) {
  return user.client
    .from("residents")
    .insert(residentRow(hostelId, overrides))
    .select("id, status, created_by, phone")
    .single();
}

/** A fresh room with `capacity` beds; returns the room and its bed ids in label order. */
let roomCounter = 0;
async function roomWithBeds(capacity = 2) {
  roomCounter += 1;
  const { data: room, error } = await owner.client
    .from("rooms")
    .insert({
      hostel_id: hostelId,
      room_number: `R${roomCounter}`,
      floor: 1,
      sharing_type: capacity === 1 ? "single" : capacity === 2 ? "double" : "four_plus",
      capacity,
    })
    .select("id, room_number")
    .single();
  if (error) throw error;
  const { data: beds } = await owner.client
    .from("beds")
    .select("id, bed_label")
    .eq("room_id", room.id)
    .order("bed_label");
  return { room, beds: beds! };
}

async function allocate(
  residentId: string,
  bed: { roomId: string; bedId: string },
  dates: { start_date?: string; end_date?: string | null; vacate_reason?: string | null } = {},
) {
  return admin
    .from("allocations")
    .insert({
      hostel_id: hostelId,
      resident_id: residentId,
      bed_id: bed.bedId,
      room_id: bed.roomId,
      start_date: dates.start_date ?? daysFromToday(-10),
      end_date: dates.end_date ?? null,
      vacate_reason: dates.vacate_reason ?? null,
      created_by: owner.id,
    })
    .select("id")
    .single();
}

describe("registering residents", () => {
  it("lets owners and staff register active residents and records who did it", async () => {
    const byOwner = await register(owner);
    const byStaff = await register(staff);
    expect(byOwner.error).toBeNull();
    expect(byStaff.error).toBeNull();
    expect(byOwner.data).toMatchObject({ status: "active", created_by: owner.id });
    expect(byStaff.data).toMatchObject({ status: "active", created_by: staff.id });
  });

  it("refuses a resident registered directly in another status", async () => {
    const { error } = await register(owner, { status: "vacated" });
    expect(error?.code).toBe(PERMISSION_DENIED);
  });

  it("keeps identity fixed after registration and never deletes residents", async () => {
    const { data } = await register(owner);
    const rename = await owner.client
      .from("residents")
      .update({ full_name: "Someone Else" } as never)
      .eq("id", data!.id);
    expect(rename.error?.code).toBe(PERMISSION_DENIED);
    const remove = await owner.client.from("residents").delete().eq("id", data!.id);
    expect(remove.error?.code).toBe(PERMISSION_DENIED);
  });

  it("only stores last 4 and a 64-character hash for the ID number", async () => {
    const short = await register(owner, { id_proof_hash: "123456789012" });
    expect(short.error?.code).toBe(CHECK_VIOLATION);
    const columns = await sql`
      select column_name from information_schema.columns
      where table_schema = 'public' and table_name = 'residents' and column_name like 'id_proof%'
      order by 1`;
    expect(columns.map((c) => c.column_name)).toEqual([
      "id_proof_hash",
      "id_proof_last4",
      "id_proof_path",
      "id_proof_type",
    ]);
  });

  it("keeps ID proof files inside the resident's own folder", async () => {
    const { data } = await register(owner);
    const outside = await owner.client
      .from("residents")
      .update({ id_proof_path: `${hostelId}/someone-else/file.pdf` })
      .eq("id", data!.id);
    expect(outside.error?.code).toBe(CHECK_VIOLATION);
    const inside = await owner.client
      .from("residents")
      .update({ id_proof_path: `${hostelId}/${data!.id}/copy.pdf` })
      .eq("id", data!.id);
    expect(inside.error).toBeNull();
  });
});

describe("duplicate residents", () => {
  it("rejects a second resident with the same phone in the same hostel", async () => {
    const phone = randomMobile();
    await register(owner, { phone });
    const { error } = await register(staff, { phone });
    expect(error?.code).toBe(UNIQUE_VIOLATION);
    expect(error?.message).toContain("residents_hostel_phone_key");
  });

  it("rejects the same ID proof twice, but not the same digits on another document", async () => {
    const hash = fakeIdHash();
    await register(owner, { id_proof_type: "pan", id_proof_hash: hash });
    const again = await register(owner, { id_proof_type: "pan", id_proof_hash: hash });
    expect(again.error?.code).toBe(UNIQUE_VIOLATION);
    expect(again.error?.message).toContain("residents_hostel_id_proof_key");

    const otherType = await register(owner, { id_proof_type: "passport", id_proof_hash: hash });
    expect(otherType.error).toBeNull();
  });

  it("allows the same person in a different hostel", async () => {
    const phone = randomMobile();
    const hash = fakeIdHash();
    await register(owner, { phone, id_proof_hash: hash });
    const other = await createUser();
    const otherHostel = await createHostel(other.id);
    const { error } = await other.client
      .from("residents")
      .insert(residentRow(otherHostel.id, { phone, id_proof_hash: hash }));
    expect(error).toBeNull();
  });
});

describe("status lifecycle", () => {
  async function setStatus(user: TestUser, id: string, status: string) {
    return user.client
      .from("residents")
      .update({ status })
      .eq("id", id)
      .select("status, status_changed_by, status_changed_at")
      .single();
  }

  it("moves active → notice → vacated → active, recording actor and time", async () => {
    const { data } = await register(owner);
    const notice = await setStatus(staff, data!.id, "notice");
    expect(notice.data).toMatchObject({ status: "notice", status_changed_by: staff.id });
    expect(notice.data?.status_changed_at).not.toBeNull();

    const vacated = await setStatus(owner, data!.id, "vacated");
    expect(vacated.data).toMatchObject({ status: "vacated", status_changed_by: owner.id });

    const back = await setStatus(owner, data!.id, "active");
    expect(back.data?.status).toBe("active");
  });

  it("blocks and unblocks", async () => {
    const { data } = await register(owner);
    expect((await setStatus(owner, data!.id, "blocked")).data?.status).toBe("blocked");
    expect((await setStatus(owner, data!.id, "active")).data?.status).toBe("active");
  });

  it.each([
    ["active", "vacated"],
    ["vacated", "notice"],
    ["blocked", "vacated"],
  ])("rejects %s → %s on the server", async (from, to) => {
    const { data } = await register(owner);
    const path: Record<string, string[]> = {
      active: [],
      vacated: ["notice", "vacated"],
      blocked: ["blocked"],
    };
    for (const step of path[from]) await setStatus(owner, data!.id, step);
    const { error } = await setStatus(owner, data!.id, to);
    expect(error).toMatchObject({ code: RAISED, hint: "resident_status_transition" });
  });
});

describe("allocations", () => {
  it("derives occupancy from live allocations", async () => {
    const { room, beds } = await roomWithBeds(2);
    const { data: resident } = await register(owner);
    const { error } = await allocate(resident!.id, { roomId: room.id, bedId: beds[0].id });
    expect(error).toBeNull();

    const { data: states } = await owner.client
      .from("bed_states")
      .select("bed_label, status")
      .eq("room_id", room.id)
      .order("bed_label");
    expect(states?.map((bed) => bed.status)).toEqual(["occupied", "available"]);

    const { data: inventory } = await owner.client
      .from("room_inventory")
      .select("available_beds")
      .eq("id", room.id)
      .single();
    expect(inventory?.available_beds).toBe(1);
  });

  it("treats only today's dates as live (IST)", async () => {
    const { room, beds } = await roomWithBeds(2);
    const [{ data: past }, { data: future }] = await Promise.all([
      register(owner),
      register(owner),
    ]);
    await allocate(
      past!.id,
      { roomId: room.id, bedId: beds[0].id },
      {
        start_date: daysFromToday(-30),
        end_date: daysFromToday(-1),
        vacate_reason: "moved_out",
      },
    );
    await allocate(
      future!.id,
      { roomId: room.id, bedId: beds[1].id },
      {
        start_date: daysFromToday(5),
      },
    );
    const { data: states } = await owner.client
      .from("bed_states")
      .select("status")
      .eq("room_id", room.id);
    expect(states?.map((bed) => bed.status)).toEqual(["available", "available"]);
  });

  it("allows one open allocation per bed and per resident", async () => {
    const { room, beds } = await roomWithBeds(2);
    const [{ data: a }, { data: b }] = await Promise.all([register(owner), register(owner)]);
    await allocate(a!.id, { roomId: room.id, bedId: beds[0].id });

    const sameBed = await allocate(b!.id, { roomId: room.id, bedId: beds[0].id });
    expect(sameBed.error?.code).toBe(UNIQUE_VIOLATION);
    const sameResident = await allocate(a!.id, { roomId: room.id, bedId: beds[1].id });
    expect(sameResident.error?.code).toBe(UNIQUE_VIOLATION);
  });

  it("requires ordered dates and a reason exactly when closed", async () => {
    const { room, beds } = await roomWithBeds(1);
    const { data: resident } = await register(owner);
    const bed = { roomId: room.id, bedId: beds[0].id };

    const backwards = await allocate(resident!.id, bed, {
      start_date: daysFromToday(-1),
      end_date: daysFromToday(-5),
      vacate_reason: "other",
    });
    expect(backwards.error?.code).toBe(CHECK_VIOLATION);
    const closedNoReason = await allocate(resident!.id, bed, { end_date: daysFromToday(-1) });
    expect(closedNoReason.error?.code).toBe(CHECK_VIOLATION);
    const openWithReason = await allocate(resident!.id, bed, { vacate_reason: "other" });
    expect(openWithReason.error?.code).toBe(CHECK_VIOLATION);
  });

  it("never lets a bed be allocated under a room it does not belong to", async () => {
    const first = await roomWithBeds(1);
    const second = await roomWithBeds(1);
    const { data: resident } = await register(owner);
    const { error } = await allocate(resident!.id, {
      roomId: first.room.id,
      bedId: second.beds[0].id,
    });
    expect(error?.code).toBe(FOREIGN_KEY_VIOLATION);
  });

  it("lets members record allocations as themselves only", async () => {
    const { room, beds } = await roomWithBeds(1);
    const { data: resident } = await register(owner);
    const asStaff = await staff.client
      .from("allocations")
      .insert({
        hostel_id: hostelId,
        resident_id: resident!.id,
        bed_id: beds[0].id,
        room_id: room.id,
        start_date: todayIst(),
      })
      .select("created_by")
      .single();
    expect(asStaff.error).toBeNull();
    expect(asStaff.data?.created_by).toBe(staff.id);

    const forged = await owner.client.from("allocations").insert({
      hostel_id: hostelId,
      resident_id: resident!.id,
      bed_id: beds[0].id,
      room_id: room.id,
      start_date: daysFromToday(-100),
      created_by: staff.id,
    } as never);
    expect(forged.error?.code).toBe(PERMISSION_DENIED);
  });

  it("never deletes allocation history", async () => {
    const { room, beds } = await roomWithBeds(1);
    const { data: resident } = await register(owner);
    const { data: allocation } = await allocate(resident!.id, {
      roomId: room.id,
      bedId: beds[0].id,
    });
    const { error } = await owner.client.from("allocations").delete().eq("id", allocation!.id);
    expect(error?.code).toBe(PERMISSION_DENIED);

    const roomDelete = await owner.client.from("rooms").delete().eq("id", room.id);
    expect(roomDelete.error?.code).toBe(FOREIGN_KEY_VIOLATION);
  });
});

describe("rules that depend on allocations", () => {
  it("refuses a bed to vacated or blocked residents until they are reactivated", async () => {
    const { room, beds } = await roomWithBeds(2);
    const [{ data: vacated }, { data: blocked }] = await Promise.all([
      register(owner),
      register(owner),
    ]);
    await owner.client.from("residents").update({ status: "notice" }).eq("id", vacated!.id);
    await owner.client.from("residents").update({ status: "vacated" }).eq("id", vacated!.id);
    await owner.client.from("residents").update({ status: "blocked" }).eq("id", blocked!.id);

    for (const [resident, bed] of [
      [vacated!, beds[0]],
      [blocked!, beds[1]],
    ] as const) {
      const { error } = await allocate(resident.id, { roomId: room.id, bedId: bed.id });
      expect(error).toMatchObject({ code: RAISED, hint: "resident_not_allocatable" });
    }

    await owner.client.from("residents").update({ status: "active" }).eq("id", vacated!.id);
    const reactivated = await allocate(vacated!.id, { roomId: room.id, bedId: beds[0].id });
    expect(reactivated.error).toBeNull();
  });

  it("refuses to mark a resident vacated while they hold a live bed", async () => {
    const { room, beds } = await roomWithBeds(1);
    const { data: resident } = await register(owner);
    const { data: allocation } = await allocate(resident!.id, {
      roomId: room.id,
      bedId: beds[0].id,
    });
    await owner.client.from("residents").update({ status: "notice" }).eq("id", resident!.id);

    const early = await owner.client
      .from("residents")
      .update({ status: "vacated" })
      .eq("id", resident!.id);
    expect(early.error).toMatchObject({ code: RAISED, hint: "resident_has_allocation" });

    await owner.client
      .from("allocations")
      .update({ end_date: daysFromToday(-1), vacate_reason: "moved_out" })
      .eq("id", allocation!.id);
    const after = await owner.client
      .from("residents")
      .update({ status: "vacated" })
      .eq("id", resident!.id);
    expect(after.error).toBeNull();
  });

  it("now enforces the EP-04 occupancy rules with real allocations", async () => {
    const { room, beds } = await roomWithBeds(4);
    const { data: resident } = await register(owner);
    await allocate(resident!.id, { roomId: room.id, bedId: beds[3].id }); // the D bed

    const shrink = await owner.client
      .from("rooms")
      .update({ sharing_type: "triple", capacity: 3 })
      .eq("id", room.id);
    // D is occupied, so C is retired instead.
    expect(shrink.error).toBeNull();
    const { data: active } = await owner.client
      .from("bed_states")
      .select("bed_label")
      .eq("room_id", room.id)
      .order("bed_label");
    expect(active?.map((bed) => bed.bed_label)).toEqual([
      `${room.room_number}-A`,
      `${room.room_number}-B`,
      `${room.room_number}-D`,
    ]);

    const block = await owner.client
      .from("beds")
      .update({ status: "blocked" })
      .eq("id", beds[3].id);
    expect(block.error).toMatchObject({ code: RAISED, hint: "bed_occupied" });
    const archive = await owner.client
      .from("rooms")
      .update({ status: "archived" })
      .eq("id", room.id);
    expect(archive.error).toMatchObject({ code: RAISED, hint: "room_occupied" });
  });
});

describe("resident directory", () => {
  it("shows the current room and bed and finds residents by name, phone or room", async () => {
    const { room, beds } = await roomWithBeds(1);
    const phone = randomMobile();
    const { data: resident } = await register(owner, { full_name: "Meenakshi Iyer", phone });
    await allocate(resident!.id, { roomId: room.id, bedId: beds[0].id });

    const { data: row } = await owner.client
      .from("resident_directory")
      .select("room_number, bed_label")
      .eq("id", resident!.id)
      .single();
    expect(row).toEqual({ room_number: room.room_number, bed_label: beds[0].bed_label });

    for (const filter of [
      `full_name.ilike."%meenakshi%"`,
      `phone.like."%${phone.slice(-6)}%"`,
      `room_number.ilike."%${room.room_number}%"`,
    ]) {
      const { data } = await owner.client
        .from("resident_directory")
        .select("id")
        .eq("hostel_id", hostelId)
        .or(filter);
      expect(data?.map((r) => r.id)).toContain(resident!.id);
    }
  });

  it("stays responsive with 2000 residents", async () => {
    const bigOwner = await createUser();
    const big = await createHostel(bigOwner.id);
    const rows = Array.from({ length: 2000 }, (_, index) =>
      residentRow(big.id, { full_name: `Resident ${String(index).padStart(4, "0")}` }),
    );
    for (let start = 0; start < rows.length; start += 500) {
      const { error } = await admin.from("residents").insert(rows.slice(start, start + 500));
      expect(error).toBeNull();
    }

    const started = performance.now();
    const { data, count, error } = await bigOwner.client
      .from("resident_directory")
      .select("id, full_name, phone, status, room_number, bed_label", { count: "exact" })
      .eq("hostel_id", big.id)
      .in("status", ["active", "notice"])
      .or(`full_name.ilike."%resident 1%",room_number.ilike."%RESIDENT 1%"`)
      .order("full_name")
      .range(0, 24);
    const elapsed = performance.now() - started;

    expect(error).toBeNull();
    expect(count).toBe(1000);
    expect(data).toHaveLength(25);
    expect(elapsed).toBeLessThan(1_000);
  });
});
