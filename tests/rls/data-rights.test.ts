import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { residentRow } from "../support/residents";
import { createUserFactory, type TestUser } from "../support/supabase";

/**
 * Residents' data rights (DPDP Act, 2023): consent stamped by the
 * database, erasure only for settled former residents, and a log of
 * exports and erasures that owners read.
 */
const PERMISSION_DENIED = "42501";

const { admin, createUser, createHostel, cleanup } = createUserFactory();

afterAll(cleanup);

let owner: TestUser;
let staff: TestUser;
let hostelId: string;

beforeAll(async () => {
  owner = await createUser({ fullName: "Data Owner" });
  hostelId = (await createHostel(owner.id)).id;
  staff = await createUser({ profile: { role: "staff", hostel_id: hostelId } });
});

async function resident(overrides: Record<string, unknown> = {}) {
  const { data, error } = await admin
    .from("residents")
    .insert({ ...residentRow(hostelId), ...overrides })
    .select("id")
    .single();
  if (error) throw error;
  return data.id;
}

/** A resident who has left and owes nothing. */
async function formerResident() {
  return resident({ status: "vacated" });
}

describe("consent", () => {
  it("is stamped with the real time and the person recording it", async () => {
    const { data, error } = await staff.client
      .from("residents")
      .insert({ ...residentRow(hostelId), consent_at: "2001-01-01T00:00:00Z" })
      .select("consent_at, consent_recorded_by")
      .single();
    expect(error).toBeNull();
    expect(new Date(data!.consent_at!).getFullYear()).toBeGreaterThan(2020);
    expect(data!.consent_recorded_by).toBe(staff.id);
  });

  it("can be recorded later once, and never changed", async () => {
    const id = await resident();
    const first = await staff.client
      .from("residents")
      .update({ consent_at: new Date().toISOString() })
      .eq("id", id)
      .select("consent_recorded_by")
      .single();
    expect(first.data?.consent_recorded_by).toBe(staff.id);
    const again = await owner.client
      .from("residents")
      .update({ consent_at: new Date().toISOString() })
      .eq("id", id);
    expect(again.error?.hint).toBe("consent_recorded");
  });
});

describe("erasure", () => {
  it("is for owners only", async () => {
    const id = await formerResident();
    const { error } = await staff.client.rpc("erase_resident", {
      p_resident_id: id,
      p_reason: "Asked",
    });
    expect(error?.hint).toBe("resident_not_found");
  });

  it("needs a reason and a resident who has left", async () => {
    const living = await resident();
    expect(
      (await owner.client.rpc("erase_resident", { p_resident_id: living, p_reason: "Asked" })).error
        ?.hint,
    ).toBe("erase_not_vacated");
    const left = await formerResident();
    expect(
      (await owner.client.rpc("erase_resident", { p_resident_id: left, p_reason: " " })).error
        ?.hint,
    ).toBe("erase_reason_required");
  });

  it("waits until no deposit is held", async () => {
    const id = await formerResident();
    await admin.from("deposit_entries").insert({
      hostel_id: hostelId,
      resident_id: id,
      kind: "collected",
      amount: 500000,
      entry_date: "2026-06-01",
      mode: "cash",
      recorded_by: owner.id,
    });
    const { error } = await owner.client.rpc("erase_resident", {
      p_resident_id: id,
      p_reason: "Asked",
    });
    expect(error?.hint).toBe("erase_deposit_held");
  });

  it("removes personal details, keeps the record, logs it and freezes it", async () => {
    const id = await formerResident();
    const { error } = await owner.client.rpc("erase_resident", {
      p_resident_id: id,
      p_reason: "Requested by the resident",
    });
    expect(error).toBeNull();

    const { data } = await owner.client
      .from("residents")
      .select(
        "full_name, phone, email, dob, permanent_address, id_proof_last4, id_proof_hash, id_proof_path, guardian_name, notes, erased_at, erased_by, status",
      )
      .eq("id", id)
      .single();
    expect(data).toMatchObject({
      phone: null,
      email: null,
      dob: null,
      permanent_address: null,
      id_proof_last4: null,
      id_proof_hash: null,
      id_proof_path: null,
      guardian_name: null,
      notes: null,
      erased_by: owner.id,
      status: "vacated",
    });
    expect(data?.full_name).toMatch(/^Erased resident [0-9A-F]{6}$/);

    const { data: log } = await owner.client
      .from("data_rights_log")
      .select("action, reason, done_by_name")
      .eq("resident_id", id);
    expect(log).toEqual([
      { action: "erase", reason: "Requested by the resident", done_by_name: "Data Owner" },
    ]);

    const edit = await staff.client.from("residents").update({ notes: "Back" }).eq("id", id);
    expect(edit.error?.hint).toBe("resident_erased");
    const reactivate = await owner.client
      .from("residents")
      .update({ status: "active" })
      .eq("id", id);
    expect(reactivate.error?.hint).toBe("resident_erased");
    const twice = await owner.client.rpc("erase_resident", { p_resident_id: id, p_reason: "x" });
    expect(twice.error?.hint).toBe("resident_erased");
  });

  it("frees the mobile number for someone new", async () => {
    const phone = "9811122233";
    const id = await resident({ status: "vacated", phone });
    await owner.client.rpc("erase_resident", { p_resident_id: id, p_reason: "Asked" });
    const { error } = await owner.client.from("residents").insert(residentRow(hostelId, { phone }));
    expect(error).toBeNull();
  });
});

describe("data rights log", () => {
  it("lets owners record exports, and nobody forge an erasure", async () => {
    const id = await resident();
    const exported = await owner.client
      .from("data_rights_log")
      .insert({ hostel_id: hostelId, resident_id: id, action: "export" });
    expect(exported.error).toBeNull();
    const forged = await owner.client
      .from("data_rights_log")
      .insert({ hostel_id: hostelId, resident_id: id, action: "erase" });
    expect(forged.error?.code).toBe(PERMISSION_DENIED);
    const byStaff = await staff.client
      .from("data_rights_log")
      .insert({ hostel_id: hostelId, resident_id: id, action: "export" });
    expect(byStaff.error?.code).toBe(PERMISSION_DENIED);
    const read = await staff.client.from("data_rights_log").select("id");
    expect(read.data).toEqual([]);
  });
});
