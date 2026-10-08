import { randomUUID } from "node:crypto";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { anonClient, createUserFactory, type TestUser } from "../support/supabase";

/** Postgres "insufficient_privilege": the grant or policy refused the call. */
const PERMISSION_DENIED = "42501";

const { admin, createUser, createHostel, cleanup } = createUserFactory();

afterAll(cleanup);

describe("profile creation on signup", () => {
  it("creates exactly one owner profile per signup", async () => {
    const user = await createUser({ fullName: "Asha Rao" });

    const { data, error } = await admin.from("profiles").select("*").eq("id", user.id);
    expect(error).toBeNull();
    expect(data).toHaveLength(1);
    expect(data?.[0]).toMatchObject({ full_name: "Asha Rao", role: "owner", hostel_id: null });
  });

  it("ignores a role smuggled in through signup metadata", async () => {
    const user = await createUser({
      metadata: { role: "platform_admin", hostel_id: randomUUID() },
    });

    const { data } = await admin.from("profiles").select("role, hostel_id").eq("id", user.id);
    expect(data?.[0]).toEqual({ role: "owner", hostel_id: null });
  });

  it("trims the name and falls back to the email name when it is blank", async () => {
    const padded = await createUser({ fullName: "  Ravi Kumar  " });
    const blank = await createUser({ fullName: "   " });

    const { data } = await admin
      .from("profiles")
      .select("id, full_name")
      .in("id", [padded.id, blank.id]);
    const names = Object.fromEntries((data ?? []).map((row) => [row.id, row.full_name]));
    expect(names[padded.id]).toBe("Ravi Kumar");
    expect(names[blank.id]).toBe(blank.email.split("@")[0]);
  });
});

describe("profiles row-level security", () => {
  let hostelA: string;
  let hostelB: string;
  let owner: TestUser;
  let otherOwner: TestUser;
  let staffA1: TestUser;
  let staffA2: TestUser;
  let staffB: TestUser;

  beforeAll(async () => {
    [owner, otherOwner] = await Promise.all([createUser(), createUser()]);
    hostelA = (await createHostel(owner.id)).id;
    hostelB = (await createHostel(otherOwner.id)).id;
    [staffA1, staffA2, staffB] = await Promise.all([
      createUser({ profile: { role: "staff", hostel_id: hostelA } }),
      createUser({ profile: { role: "staff", hostel_id: hostelA } }),
      createUser({ profile: { role: "staff", hostel_id: hostelB } }),
    ]);
  });

  async function visibleIds(user: TestUser) {
    const { data, error } = await user.client.from("profiles").select("id");
    expect(error).toBeNull();
    return (data ?? []).map((row) => row.id).sort();
  }

  it("lets an owner read their own profile and their hostel's staff, nobody else", async () => {
    expect(await visibleIds(owner)).toEqual([owner.id, staffA1.id, staffA2.id].sort());
    expect(await visibleIds(otherOwner)).toEqual([otherOwner.id, staffB.id].sort());
  });

  it("lets staff read peers in their own hostel and no one else", async () => {
    expect(await visibleIds(staffA1)).toEqual([staffA1.id, staffA2.id].sort());
    expect(await visibleIds(staffB)).toEqual([staffB.id]);
  });

  it("lets a user update their own name and phone", async () => {
    const { data, error } = await owner.client
      .from("profiles")
      .update({ full_name: "Renamed Owner", phone: "9876543210" })
      .eq("id", owner.id)
      .select("full_name, phone");
    expect(error).toBeNull();
    expect(data).toEqual([{ full_name: "Renamed Owner", phone: "9876543210" }]);
  });

  it("refuses to let a user change their own role", async () => {
    const { error } = await owner.client
      .from("profiles")
      .update({ role: "platform_admin" })
      .eq("id", owner.id);
    expect(error?.code).toBe(PERMISSION_DENIED);

    const { data } = await admin.from("profiles").select("role").eq("id", owner.id);
    expect(data?.[0]?.role).toBe("owner");
  });

  it("refuses to let staff move themselves to another hostel", async () => {
    const { error } = await staffA1.client
      .from("profiles")
      .update({ hostel_id: hostelB })
      .eq("id", staffA1.id);
    expect(error?.code).toBe(PERMISSION_DENIED);
  });

  it("does not let a user update someone else's profile", async () => {
    const { data, error } = await staffA1.client
      .from("profiles")
      .update({ full_name: "Hijacked" })
      .eq("id", staffA2.id)
      .select("id");
    expect(error).toBeNull();
    expect(data).toEqual([]);

    const { data: peer } = await admin.from("profiles").select("full_name").eq("id", staffA2.id);
    expect(peer?.[0]?.full_name).not.toBe("Hijacked");
  });

  it("does not let a user insert or delete profiles", async () => {
    const insert = await owner.client
      .from("profiles")
      .insert({ id: otherOwner.id, full_name: "Forged" });
    expect(insert.error?.code).toBe(PERMISSION_DENIED);

    const remove = await owner.client.from("profiles").delete().eq("id", owner.id);
    expect(remove.error?.code).toBe(PERMISSION_DENIED);
  });

  it("denies a signed-out visitor all access", async () => {
    const { data, error } = await anonClient().from("profiles").select("id");
    expect(error?.code).toBe(PERMISSION_DENIED);
    expect(data).toBeNull();
  });
});
