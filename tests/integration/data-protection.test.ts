import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { residentRow } from "../support/residents";
import { createUserFactory, type TestUser } from "../support/supabase";
import { enrolTotp } from "../support/totp";

/**
 * Data export, resident erasure and account closure (E10-T10), run as the
 * owner, a staff member and another owner.
 */
const PERMISSION_DENIED = "42501";

const { admin, createUser, createHostel, cleanup } = createUserFactory();

afterAll(cleanup);

let owner: TestUser;
let otherOwner: TestUser;
let staff: TestUser;
let hostelId: string;

beforeAll(async () => {
  [owner, otherOwner] = await Promise.all([createUser(), createUser()]);
  hostelId = (await createHostel(owner.id, { name: "Privacy PG" })).id;
  await createHostel(otherOwner.id);
  staff = await createUser({ profile: { role: "staff", hostel_id: hostelId } });
});

async function resident(overrides: Parameters<typeof residentRow>[1] = {}) {
  const { data, error } = await admin
    .from("residents")
    .insert(residentRow(hostelId, overrides))
    .select("id")
    .single();
  if (error) throw error;
  return data.id;
}

describe("export", () => {
  it("gives the owner every table of their hostel, without the ID hash, and records it", async () => {
    await resident({ full_name: "Exported Person" });
    const { data, error } = await owner.client.rpc("export_hostel_data", { p_hostel_id: hostelId });
    expect(error).toBeNull();
    const archive = data as { hostel: { name: string }; residents: Record<string, unknown>[] };
    expect(archive.hostel.name).toBe("Privacy PG");
    expect(archive.residents.map((r) => r.full_name)).toContain("Exported Person");
    expect(archive.residents[0]).not.toHaveProperty("id_proof_hash");
    for (const key of ["rooms", "beds", "allocations", "invoices", "payments", "complaints"]) {
      expect(archive).toHaveProperty(key);
    }

    const { data: log } = await owner.client.from("data_requests").select("kind, status");
    expect(log).toContainEqual({ kind: "export", status: "done" });
  });

  it("is refused to staff and to other owners", async () => {
    for (const client of [staff.client, otherOwner.client]) {
      const { error } = await client.rpc("export_hostel_data", { p_hostel_id: hostelId });
      expect(error?.code).toBe(PERMISSION_DENIED);
    }
  });
});

describe("erasure", () => {
  it("removes personal fields of a resident who left and keeps the record", async () => {
    const id = await resident({
      status: "vacated",
      email: "gone@example.com",
      guardian_name: "Parent",
      notes: "Allergic to dust",
    });
    const noReason = await owner.client.rpc("erase_resident", { p_resident_id: id, p_reason: "" });
    expect(noReason.error?.hint).toBe("reason_required");

    const { error } = await owner.client.rpc("erase_resident", {
      p_resident_id: id,
      p_reason: "Resident asked to be forgotten",
    });
    expect(error).toBeNull();

    const { data } = await admin.from("residents").select("*").eq("id", id).single();
    expect(data).toMatchObject({
      full_name: "Erased resident",
      phone: null,
      email: null,
      dob: null,
      gender: null,
      guardian_name: null,
      notes: null,
      id_proof_hash: null,
      id_proof_last4: null,
      permanent_address: null,
      status: "vacated",
    });
    expect(data!.erased_at).not.toBeNull();

    // It cannot be edited back, or erased twice.
    const edit = await owner.client
      .from("residents")
      .update({ notes: "back" })
      .eq("id", id)
      .select("id");
    expect(edit.error?.hint).toBe("resident_erased");
    const again = await owner.client.rpc("erase_resident", {
      p_resident_id: id,
      p_reason: "Asked again",
    });
    expect(again.error?.hint).toBe("resident_erased");
  });

  it("refuses a resident who has not left, staff, and other owners", async () => {
    const id = await resident({ status: "active" });
    const active = await owner.client.rpc("erase_resident", {
      p_resident_id: id,
      p_reason: "Too early to erase",
    });
    expect(active.error?.hint).toBe("resident_not_vacated");
    for (const client of [staff.client, otherOwner.client]) {
      const { error } = await client.rpc("erase_resident", {
        p_resident_id: id,
        p_reason: "Not allowed to do this",
      });
      expect(error?.code).toBe(PERMISSION_DENIED);
    }
  });

  it("still refuses an incomplete resident who was never erased", async () => {
    const { error } = await admin.from("residents").insert(residentRow(hostelId, { phone: null }));
    expect(error?.code).toBe("23514");
  });
});

describe("account closure", () => {
  it("is scheduled after the notice period, once, can be cancelled, and is seen by admins", async () => {
    const leaving = await createUser();
    const { data: due, error } = await leaving.client.rpc("request_account_closure", {
      p_reason: "Selling the hostel",
    });
    expect(error).toBeNull();
    const expected = new Date(Date.now() + 30 * 86_400_000).toISOString().slice(0, 10);
    expect([expected, new Date(Date.now() + 31 * 86_400_000).toISOString().slice(0, 10)]).toContain(
      due,
    );

    const twice = await leaving.client.rpc("request_account_closure", {});
    expect(twice.error?.hint).toBe("closure_scheduled");
    expect((await staff.client.rpc("request_account_closure", {})).error?.code).toBe(
      PERMISSION_DENIED,
    );

    const platformAdmin = await createUser({ profile: { role: "platform_admin" } });
    await enrolTotp(platformAdmin.client);
    const list = await platformAdmin.client.rpc("admin_data_requests", {});
    const rows = (list.data as { rows: { owner_id: string; status: string }[] }).rows;
    expect(rows).toContainEqual(
      expect.objectContaining({ owner_id: leaving.id, status: "scheduled" }),
    );
    expect((await owner.client.rpc("admin_data_requests", {})).error?.code).toBe(PERMISSION_DENIED);

    await leaving.client.rpc("cancel_account_closure");
    const { data: after } = await leaving.client
      .from("data_requests")
      .select("status")
      .eq("kind", "account_closure");
    expect(after).toEqual([{ status: "cancelled" }]);
  });
});
