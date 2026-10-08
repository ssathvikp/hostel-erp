import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { todayIst } from "@/lib/validation";

import { residentRow } from "../support/residents";
import { anonClient, createUserFactory, type TestUser } from "../support/supabase";

/**
 * Tenant isolation for residents, allocations, the resident directory and
 * ID proof files (E5-T1, E6-T1, E5-T7).
 */
const PERMISSION_DENIED = "42501";
const BUCKET = "id-proofs";
const PDF = new TextEncoder().encode("%PDF-1.4\n% test document\n");

const { admin, createUser, createHostel, cleanup } = createUserFactory();

let ownerA: TestUser;
let ownerB: TestUser;
let staffA: TestUser;
let hostelA: string;
let hostelB: string;
let residentA: string;
let residentB: string;
let roomA: string;
let bedA: string;
let filePath: string;

afterAll(async () => {
  await admin.storage.from(BUCKET).remove([filePath]);
  await cleanup();
});

beforeAll(async () => {
  [ownerA, ownerB] = await Promise.all([createUser(), createUser()]);
  hostelA = (await createHostel(ownerA.id)).id;
  hostelB = (await createHostel(ownerB.id)).id;
  staffA = await createUser({ profile: { role: "staff", hostel_id: hostelA } });

  residentA = (await admin.from("residents").insert(residentRow(hostelA)).select("id").single())
    .data!.id;
  residentB = (await admin.from("residents").insert(residentRow(hostelB)).select("id").single())
    .data!.id;

  const { data: room } = await admin
    .from("rooms")
    .insert({
      hostel_id: hostelA,
      room_number: "101",
      floor: 1,
      sharing_type: "single",
      capacity: 1,
    })
    .select("id")
    .single();
  roomA = room!.id;
  bedA = (await admin.from("beds").select("id").eq("room_id", roomA).single()).data!.id;
  await admin.from("allocations").insert({
    hostel_id: hostelA,
    resident_id: residentA,
    bed_id: bedA,
    room_id: roomA,
    start_date: todayIst(),
    created_by: ownerA.id,
  });

  filePath = `${hostelA}/${residentA}/proof.pdf`;
  const upload = await ownerA.client.storage
    .from(BUCKET)
    .upload(filePath, PDF, { contentType: "application/pdf" });
  if (upload.error) throw upload.error;
});

describe("residents", () => {
  it("shows each hostel only its own residents", async () => {
    const a = await ownerA.client.from("residents").select("id");
    expect(a.data?.map((row) => row.id)).toEqual([residentA]);
    const staff = await staffA.client.from("residents").select("id");
    expect(staff.data?.map((row) => row.id)).toEqual([residentA]);
    const b = await ownerB.client.from("residents").select("id").eq("id", residentA);
    expect(b.data).toEqual([]);
  });

  it("does not let another hostel register, edit or change the status of a resident", async () => {
    const insert = await ownerB.client.from("residents").insert(residentRow(hostelA));
    expect(insert.error?.code).toBe(PERMISSION_DENIED);

    const edit = await ownerB.client
      .from("residents")
      .update({ notes: "taken over" })
      .eq("id", residentA)
      .select("id");
    expect(edit.data).toEqual([]);
    const status = await ownerB.client
      .from("residents")
      .update({ status: "blocked" })
      .eq("id", residentA)
      .select("id");
    expect(status.data).toEqual([]);
  });

  it("does not let a resident be moved to another hostel", async () => {
    const { error } = await ownerA.client
      .from("residents")
      .update({ hostel_id: hostelB } as never)
      .eq("id", residentA);
    expect(error?.code).toBe(PERMISSION_DENIED);
  });

  it("keeps the directory view isolated", async () => {
    const { data } = await ownerB.client.from("resident_directory").select("id");
    expect(data?.map((row) => row.id)).toEqual([residentB]);
  });
});

describe("allocations", () => {
  it("shows each hostel only its own allocations", async () => {
    const a = await ownerA.client.from("allocations").select("resident_id");
    expect(a.data?.map((row) => row.resident_id)).toEqual([residentA]);
    const b = await ownerB.client.from("allocations").select("id");
    expect(b.data).toEqual([]);
  });

  it("does not let another hostel record or close allocations", async () => {
    const insert = await ownerB.client.from("allocations").insert({
      hostel_id: hostelA,
      resident_id: residentA,
      bed_id: bedA,
      room_id: roomA,
      start_date: todayIst(),
    });
    expect(insert.error?.code).toBe(PERMISSION_DENIED);

    const close = await ownerB.client
      .from("allocations")
      .update({ end_date: todayIst(), vacate_reason: "evicted" })
      .eq("resident_id", residentA)
      .select("id");
    expect(close.data).toEqual([]);
  });

  it("cannot point an allocation at another hostel's bed", async () => {
    // B's own hostel_id and resident, but a free bed in A: RLS would allow
    // the row's hostel_id, so it is the composite key that rejects it.
    const { data: room } = await admin
      .from("rooms")
      .insert({
        hostel_id: hostelA,
        room_number: "102",
        floor: 1,
        sharing_type: "single",
        capacity: 1,
      })
      .select("id")
      .single();
    const { data: bed } = await admin.from("beds").select("id").eq("room_id", room!.id).single();
    const { error } = await ownerB.client.from("allocations").insert({
      hostel_id: hostelB,
      resident_id: residentB,
      bed_id: bed!.id,
      room_id: room!.id,
      start_date: todayIst(),
    });
    expect(error?.code).toBe("23503");
  });

  it("does not reveal another hostel's occupancy", async () => {
    const { data } = await ownerB.client.from("bed_states").select("id").eq("id", bedA);
    expect(data).toEqual([]);
  });
});

describe("ID proof files", () => {
  it("lets the hostel's own members open the file through a signed URL", async () => {
    for (const user of [ownerA, staffA]) {
      const { data, error } = await user.client.storage.from(BUCKET).createSignedUrl(filePath, 60);
      expect(error).toBeNull();
      const response = await fetch(data!.signedUrl);
      expect(response.status).toBe(200);
    }
  });

  it("does not let another hostel read the file even with the exact path", async () => {
    const signed = await ownerB.client.storage.from(BUCKET).createSignedUrl(filePath, 60);
    expect(signed.data).toBeNull();
    const download = await ownerB.client.storage.from(BUCKET).download(filePath);
    expect(download.data).toBeNull();
    const list = await ownerB.client.storage.from(BUCKET).list(`${hostelA}/${residentA}`);
    expect(list.data ?? []).toEqual([]);
  });

  it("does not let another hostel upload into, overwrite or delete the folder", async () => {
    const upload = await ownerB.client.storage
      .from(BUCKET)
      .upload(`${hostelA}/${residentA}/planted.pdf`, PDF, { contentType: "application/pdf" });
    expect(upload.error).not.toBeNull();

    const overwrite = await ownerB.client.storage
      .from(BUCKET)
      .update(filePath, PDF, { contentType: "application/pdf" });
    expect(overwrite.error).not.toBeNull();

    await ownerB.client.storage.from(BUCKET).remove([filePath]);
    const stillThere = await ownerA.client.storage.from(BUCKET).download(filePath);
    expect(stillThere.error).toBeNull();
  });

  it("does not accept files outside a resident folder, even in the user's own hostel", async () => {
    const loose = await ownerA.client.storage
      .from(BUCKET)
      .upload(`${hostelA}/not-a-resident/file.pdf`, PDF, { contentType: "application/pdf" });
    expect(loose.error).not.toBeNull();
  });

  it("serves nothing to a signed-out visitor", async () => {
    const anon = anonClient();
    const signed = await anon.storage.from(BUCKET).createSignedUrl(filePath, 60);
    expect(signed.data).toBeNull();
    const publicUrl = anon.storage.from(BUCKET).getPublicUrl(filePath).data.publicUrl;
    expect((await fetch(publicUrl)).status).toBeGreaterThanOrEqual(400);
  });

  it("enforces the type and size limits in the bucket itself", async () => {
    const text = await ownerA.client.storage
      .from(BUCKET)
      .upload(`${hostelA}/${residentA}/note.txt`, new TextEncoder().encode("hello"), {
        contentType: "text/plain",
      });
    expect(text.error).not.toBeNull();

    const big = await ownerA.client.storage
      .from(BUCKET)
      .upload(`${hostelA}/${residentA}/big.pdf`, new Uint8Array(5 * 1024 * 1024 + 1), {
        contentType: "application/pdf",
      });
    expect(big.error).not.toBeNull();
  });
});

describe("signed-out visitors", () => {
  it("cannot read residents, allocations or the directory", async () => {
    const anon = anonClient();
    const results = await Promise.all([
      anon.from("residents").select("id"),
      anon.from("allocations").select("id"),
      anon.from("resident_directory").select("id"),
    ]);
    expect(results.map((result) => result.error?.code)).toEqual(Array(3).fill(PERMISSION_DENIED));
  });
});
