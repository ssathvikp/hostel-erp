import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { connectToDatabase } from "../support/db";
import { createUserFactory, type TestUser } from "../support/supabase";

/**
 * Room and bed integrity rules (E4-T1, E4-T3, E4-T4, E4-T5, E4-T7, E4-T8).
 * Writes go through a signed-in owner so the real grants, policies and
 * triggers run; the superuser connection is used only to inspect state and
 * to simulate occupancy until allocations exist (EP-06).
 */
const UNIQUE_VIOLATION = "23505";
const CHECK_VIOLATION = "23514";
const PERMISSION_DENIED = "42501";
const RAISED = "P0001";

const sql = connectToDatabase();
const { admin, createUser, createHostel, cleanup } = createUserFactory();

afterAll(async () => {
  await cleanup();
  await sql.end();
});

let owner: TestUser;
let hostelId: string;

beforeAll(async () => {
  owner = await createUser();
  hostelId = (await createHostel(owner.id)).id;
});

async function createRoom(room_number: string, capacity = 2, extra: Record<string, unknown> = {}) {
  const sharing_type =
    capacity === 1 ? "single" : capacity === 2 ? "double" : capacity === 3 ? "triple" : "four_plus";
  return owner.client
    .from("rooms")
    .insert({ hostel_id: hostelId, room_number, floor: 1, sharing_type, capacity, ...extra })
    .select("id, room_number")
    .single();
}

/** All beds of a room, including retired ones, ordered by label. */
async function bedsOf(roomId: string) {
  return sql<{ id: string; bed_label: string; archived_at: Date | null; status: string }[]>`
    select id, bed_label, archived_at, status from public.beds
    where room_id = ${roomId} order by bed_label`;
}

async function activeLabels(roomId: string) {
  return (await bedsOf(roomId)).filter((bed) => !bed.archived_at).map((bed) => bed.bed_label);
}

/**
 * Runs `body` while the given beds count as occupied, inside a transaction
 * that is always rolled back. Postgres DDL is transactional, so the real
 * bed_is_occupied is back in place afterwards.
 */
async function whileOccupied(bedIds: string[], body: (tx: typeof sql) => Promise<void>) {
  const rollback = new Error("rollback");
  await sql
    .begin(async (tx) => {
      await tx.unsafe(`
        create or replace function private.bed_is_occupied(p_bed_id uuid)
        returns boolean language sql stable security invoker set search_path = ''
        as $$ select p_bed_id = any (array[${bedIds.map((id) => `'${id}'::uuid`).join(",")}]) $$`);
      await body(tx as unknown as typeof sql);
      throw rollback;
    })
    .catch((error: unknown) => {
      if (error !== rollback) throw error;
    });
}

describe("bed generation", () => {
  it("creates exactly one bed per place with stable labels, in the same statement", async () => {
    const { data, error } = await createRoom("101", 4);
    expect(error).toBeNull();
    expect(await activeLabels(data!.id)).toEqual(["101-A", "101-B", "101-C", "101-D"]);
  });

  it("is idempotent: running generation again creates no duplicates", async () => {
    const { data } = await createRoom("102", 3);
    await sql`select private.sync_room_beds(${data!.id})`;
    await sql`select private.sync_room_beds(${data!.id})`;
    expect(await bedsOf(data!.id)).toHaveLength(3);
  });

  it("creates no room at all when the insert fails", async () => {
    const before =
      await sql`select count(*)::int as n from public.rooms where hostel_id = ${hostelId}`;
    const { error } = await createRoom("103", 2, { sharing_type: "single" });
    expect(error?.code).toBe(CHECK_VIOLATION);
    const after =
      await sql`select count(*)::int as n from public.rooms where hostel_id = ${hostelId}`;
    expect(after[0].n).toBe(before[0].n);
  });

  it("never leaves a room whose active beds differ from its capacity", async () => {
    const mismatched = await sql`
      select r.room_number from public.rooms r
      where r.status = 'active' and r.capacity <> (
        select count(*) from public.beds b where b.room_id = r.id and b.archived_at is null)`;
    expect(mismatched).toEqual([]);
  });

  it("does not let users write beds directly", async () => {
    const { data: room } = await createRoom("104", 1);
    const insert = await owner.client
      .from("beds")
      .insert({ hostel_id: hostelId, room_id: room!.id, bed_label: "104-Z" } as never);
    expect(insert.error?.code).toBe(PERMISSION_DENIED);

    const [bed] = await bedsOf(room!.id);
    const remove = await owner.client.from("beds").delete().eq("id", bed.id);
    expect(remove.error?.code).toBe(PERMISSION_DENIED);
  });
});

describe("room numbers", () => {
  it("rejects a duplicate room number in the same hostel at the database", async () => {
    await createRoom("201");
    const { error } = await createRoom("201");
    expect(error?.code).toBe(UNIQUE_VIOLATION);
    expect(error?.message).toContain("rooms_hostel_room_number_key");
  });

  it("normalises whitespace and letter case before checking uniqueness", async () => {
    const { data } = await createRoom("  g-12a ");
    expect(data?.room_number).toBe("G-12A");
    const { error } = await createRoom("G-12a");
    expect(error?.code).toBe(UNIQUE_VIOLATION);
  });

  it("allows the same room number in a different hostel", async () => {
    const other = await createUser();
    const otherHostel = await createHostel(other.id);
    const { error } = await other.client.from("rooms").insert({
      hostel_id: otherHostel.id,
      room_number: "201",
      floor: 2,
      sharing_type: "double",
      capacity: 2,
    });
    expect(error).toBeNull();
  });

  it("never lets a room number change after creation", async () => {
    const { data } = await createRoom("202");
    const { error } = await owner.client
      .from("rooms")
      .update({ room_number: "203" } as never)
      .eq("id", data!.id);
    expect(error?.code).toBe(PERMISSION_DENIED);
  });

  it("keeps capacity consistent with sharing type and within 1 to 12", async () => {
    for (const [sharing_type, capacity] of [
      ["double", 3],
      ["four_plus", 3],
      ["four_plus", 13],
    ] as const) {
      const { error } = await owner.client.from("rooms").insert({
        hostel_id: hostelId,
        room_number: `X${capacity}${sharing_type.length}`,
        floor: 0,
        sharing_type,
        capacity,
      });
      expect(error?.code).toBe(CHECK_VIOLATION);
    }
  });
});

describe("capacity changes", () => {
  it("adds the next labels when capacity grows", async () => {
    const { data } = await createRoom("301", 4);
    await owner.client.from("rooms").update({ capacity: 6 }).eq("id", data!.id);
    expect(await activeLabels(data!.id)).toEqual([
      "301-A",
      "301-B",
      "301-C",
      "301-D",
      "301-E",
      "301-F",
    ]);
  });

  it("retires the highest-labelled vacant beds when capacity shrinks, keeping them as history", async () => {
    const { data } = await createRoom("302", 6);
    const { error } = await owner.client
      .from("rooms")
      .update({ sharing_type: "double", capacity: 2 })
      .eq("id", data!.id);
    expect(error).toBeNull();
    expect(await activeLabels(data!.id)).toEqual(["302-A", "302-B"]);
    expect(await bedsOf(data!.id)).toHaveLength(6);
  });

  it("brings retired beds back before creating new labels", async () => {
    const { data } = await createRoom("303", 5);
    await owner.client.from("rooms").update({ capacity: 4 }).eq("id", data!.id);
    await owner.client.from("rooms").update({ capacity: 6 }).eq("id", data!.id);
    const beds = await bedsOf(data!.id);
    expect(beds.map((bed) => bed.bed_label)).toEqual([
      "303-A",
      "303-B",
      "303-C",
      "303-D",
      "303-E",
      "303-F",
    ]);
    expect(beds.every((bed) => bed.archived_at === null)).toBe(true);
  });

  it("skips occupied beds and retires the highest-labelled vacant ones", async () => {
    const { data } = await createRoom("304", 5);
    const beds = await bedsOf(data!.id);
    const e = beds.find((bed) => bed.bed_label === "304-E")!;

    await whileOccupied([e.id], async (tx) => {
      await tx`update public.rooms set capacity = 4 where id = ${data!.id}`;
      const active = await tx`
        select bed_label from public.beds
        where room_id = ${data!.id} and archived_at is null order by bed_label`;
      expect(active.map((row) => row.bed_label)).toEqual(["304-A", "304-B", "304-C", "304-E"]);
    });
  });

  it("blocks a reduction when the beds that would be removed are occupied", async () => {
    const { data } = await createRoom("305", 4);
    const beds = await bedsOf(data!.id);

    await whileOccupied(
      beds.map((bed) => bed.id),
      async (tx) => {
        const error =
          await tx`update public.rooms set sharing_type = 'triple', capacity = 3 where id = ${data!.id}`.catch(
            (caught: { code: string; hint: string }) => caught,
          );
        expect(error).toMatchObject({ code: RAISED, hint: "room_beds_occupied" });
      },
    );
    expect(await activeLabels(data!.id)).toHaveLength(4);
  });
});

describe("archive and delete", () => {
  it("archives a room, retires its beds and makes it read-only", async () => {
    const { data } = await createRoom("401", 3);
    const archived = await owner.client
      .from("rooms")
      .update({ status: "archived" })
      .eq("id", data!.id);
    expect(archived.error).toBeNull();
    expect(await activeLabels(data!.id)).toEqual([]);
    expect(await bedsOf(data!.id)).toHaveLength(3);

    const edit = await owner.client.from("rooms").update({ floor: 2 }).eq("id", data!.id);
    expect(edit.error).toMatchObject({ code: RAISED, hint: "room_archived" });
    const restore = await owner.client
      .from("rooms")
      .update({ status: "active" })
      .eq("id", data!.id);
    expect(restore.error).toMatchObject({ code: RAISED, hint: "room_archived" });
  });

  it("keeps archived rooms out of the active inventory but in the table", async () => {
    const { data } = await createRoom("402", 2);
    await owner.client.from("rooms").update({ status: "archived" }).eq("id", data!.id);
    const { data: active } = await owner.client
      .from("room_inventory")
      .select("id")
      .eq("hostel_id", hostelId)
      .eq("status", "active");
    expect((active ?? []).map((row) => row.id)).not.toContain(data!.id);

    const { data: kept } = await owner.client
      .from("room_inventory")
      .select("room_number, status, total_beds")
      .eq("id", data!.id)
      .single();
    expect(kept).toEqual({ room_number: "402", status: "archived", total_beds: 0 });
  });

  it("refuses to archive a room with an occupied bed", async () => {
    const { data } = await createRoom("403", 2);
    const [bed] = await bedsOf(data!.id);
    await whileOccupied([bed.id], async (tx) => {
      const error =
        await tx`update public.rooms set status = 'archived' where id = ${data!.id}`.catch(
          (caught: { code: string; hint: string }) => caught,
        );
      expect(error).toMatchObject({ code: RAISED, hint: "room_occupied" });
    });
  });

  it("hard-deletes a room with no history together with its beds", async () => {
    const { data } = await createRoom("404", 2);
    const { error } = await owner.client.from("rooms").delete().eq("id", data!.id);
    expect(error).toBeNull();
    expect(await bedsOf(data!.id)).toEqual([]);
  });

  it("refuses to delete a room whose bed is referenced by history", async () => {
    // Stand-in for allocations (EP-06), which reference beds ON DELETE RESTRICT.
    const { data } = await createRoom("405", 1);
    const [bed] = await bedsOf(data!.id);
    const rollback = new Error("rollback");
    await sql
      .begin(async (tx) => {
        await tx`create table public.history_probe (bed_id uuid references public.beds (id) on delete restrict)`;
        await tx`alter table public.history_probe enable row level security`;
        await tx`insert into public.history_probe values (${bed.id})`;
        const error = await tx`delete from public.rooms where id = ${data!.id}`.catch(
          (caught: { code: string }) => caught,
        );
        expect(error).toMatchObject({ code: "23503" });
        throw rollback;
      })
      .catch((error: unknown) => {
        if (error !== rollback) throw error;
      });
    expect(await bedsOf(data!.id)).toHaveLength(1);
  });
});

describe("bed status", () => {
  it("records who changed a bed's status and when, and clears the reason on release", async () => {
    const { data } = await createRoom("501", 2);
    const [bed] = await bedsOf(data!.id);

    const blocked = await owner.client
      .from("beds")
      .update({ status: "blocked", status_reason: "Broken frame" })
      .eq("id", bed.id)
      .select("status, status_reason, status_changed_by, status_changed_at")
      .single();
    expect(blocked.error).toBeNull();
    expect(blocked.data).toMatchObject({
      status: "blocked",
      status_reason: "Broken frame",
      status_changed_by: owner.id,
    });
    expect(blocked.data?.status_changed_at).not.toBeNull();

    const released = await owner.client
      .from("beds")
      .update({ status: "available" })
      .eq("id", bed.id)
      .select("status, status_reason")
      .single();
    expect(released.data).toEqual({ status: "available", status_reason: null });
  });

  it("never stores occupied in the status column", async () => {
    const { data } = await createRoom("502", 1);
    const [bed] = await bedsOf(data!.id);
    const { error } = await owner.client
      .from("beds")
      .update({ status: "occupied" })
      .eq("id", bed.id);
    expect(error?.code).toBe(CHECK_VIOLATION);
  });

  it("refuses to block an occupied bed and shows it as occupied", async () => {
    const { data } = await createRoom("503", 2);
    const [bed] = await bedsOf(data!.id);
    await whileOccupied([bed.id], async (tx) => {
      const [state] = await tx`select status from public.bed_states where id = ${bed.id}`;
      expect(state.status).toBe("occupied");
      const error = await tx`update public.beds set status = 'blocked' where id = ${bed.id}`.catch(
        (caught: { code: string; hint: string }) => caught,
      );
      expect(error).toMatchObject({ code: RAISED, hint: "bed_occupied" });
    });
  });

  it("refuses status changes on retired beds", async () => {
    const { data } = await createRoom("504", 4);
    await owner.client
      .from("rooms")
      .update({ sharing_type: "triple", capacity: 3 })
      .eq("id", data!.id);
    const retired = (await bedsOf(data!.id)).find((bed) => bed.archived_at)!;
    const { error } = await owner.client
      .from("beds")
      .update({ status: "blocked" })
      .eq("id", retired.id);
    expect(error).toMatchObject({ code: RAISED, hint: "bed_retired" });
  });

  it("excludes blocked and maintenance beds from vacancies", async () => {
    const { data } = await createRoom("505", 4);
    const [a, b] = await bedsOf(data!.id);
    await owner.client.from("beds").update({ status: "blocked" }).eq("id", a.id);
    await owner.client.from("beds").update({ status: "maintenance" }).eq("id", b.id);
    const { data: row } = await owner.client
      .from("room_inventory")
      .select("total_beds, available_beds, out_of_service_beds")
      .eq("id", data!.id)
      .single();
    expect(row).toEqual({ total_beds: 4, available_beds: 2, out_of_service_beds: 2 });
  });
});

describe("bulk generation", () => {
  it("creates 50 rooms and their beds in one call within a few seconds", async () => {
    const started = performance.now();
    const { data, error } = await owner.client
      .rpc("create_rooms_bulk", {
        p_hostel_id: hostelId,
        p_from: 1001,
        p_to: 1050,
        p_floor: 10,
        p_sharing_type: "triple",
        p_capacity: 3,
      })
      .single();
    const elapsed = performance.now() - started;

    expect(error).toBeNull();
    expect(data).toEqual({ rooms_created: 50, beds_created: 150 });
    expect(elapsed).toBeLessThan(3_000);

    const [counts] = await sql`
      select count(distinct r.id)::int as rooms, count(b.id)::int as beds
      from public.rooms r join public.beds b on b.room_id = r.id
      where r.hostel_id = ${hostelId} and r.floor = 10`;
    expect(counts).toEqual({ rooms: 50, beds: 150 });
  });

  it("is all-or-nothing when any number in the range already exists", async () => {
    await createRoom("2005", 2);
    const { error } = await owner.client.rpc("create_rooms_bulk", {
      p_hostel_id: hostelId,
      p_from: 2001,
      p_to: 2010,
      p_floor: 20,
      p_sharing_type: "double",
      p_capacity: 2,
    });
    expect(error?.code).toBe(UNIQUE_VIOLATION);
    const [row] = await sql`
      select count(*)::int as n from public.rooms where hostel_id = ${hostelId} and floor = 20`;
    expect(row.n).toBe(0);
  });

  it("refuses ranges over 100 rooms", async () => {
    const { error } = await owner.client.rpc("create_rooms_bulk", {
      p_hostel_id: hostelId,
      p_from: 1,
      p_to: 101,
      p_floor: 0,
      p_sharing_type: "single",
      p_capacity: 1,
    });
    expect(error).toMatchObject({ code: RAISED, hint: "bulk_range" });
  });
});

it("cleans up fixture rooms through the hostel cascade", async () => {
  // Guards the test harness itself: cleanup() deletes hostels, which must
  // take their rooms and beds with them.
  const temp = await createUser();
  const hostel = await createHostel(temp.id);
  await temp.client.from("rooms").insert({
    hostel_id: hostel.id,
    room_number: "1",
    floor: 0,
    sharing_type: "single",
    capacity: 1,
  });
  const { error } = await admin.from("hostels").delete().eq("id", hostel.id);
  expect(error).toBeNull();
  const [row] =
    await sql`select count(*)::int as n from public.rooms where hostel_id = ${hostel.id}`;
  expect(row.n).toBe(0);
});
