import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createUserFactory, type TestUser } from "../support/supabase";

/**
 * Staff invitations and removal (EP-12). Invitations are visible to the
 * owner of the hostel only and written only by the service role; a removed
 * (deactivated) staff member is a member of no hostel.
 */
const PERMISSION_DENIED = "42501";

const { admin, createUser, createHostel, cleanup } = createUserFactory();

afterAll(cleanup);

describe("staff invitations", () => {
  let ownerA: TestUser;
  let ownerB: TestUser;
  let staffA: TestUser;
  let hostelA: string;
  let invitationId: string;

  beforeAll(async () => {
    [ownerA, ownerB] = await Promise.all([createUser(), createUser()]);
    hostelA = (await createHostel(ownerA.id)).id;
    await createHostel(ownerB.id);
    staffA = await createUser({ profile: { role: "staff", hostel_id: hostelA } });

    const { data, error } = await admin
      .from("staff_invitations")
      .insert({
        hostel_id: hostelA,
        email: staffA.email,
        full_name: "Warden A",
        profile_id: staffA.id,
        invited_by: ownerA.id,
      })
      .select("id")
      .single();
    if (error) throw error;
    invitationId = data.id;
  });

  it("are visible to the hostel's owner", async () => {
    const { data, error } = await ownerA.client.from("staff_invitations").select("id");
    expect(error).toBeNull();
    expect(data?.map((row) => row.id)).toEqual([invitationId]);
  });

  it("are hidden from other owners and from staff", async () => {
    for (const user of [ownerB, staffA]) {
      const { data, error } = await user.client.from("staff_invitations").select("id");
      expect(error).toBeNull();
      expect(data).toEqual([]);
    }
  });

  it("cannot be written by signed-in users, owners included", async () => {
    const insert = await ownerA.client.from("staff_invitations").insert({
      hostel_id: hostelA,
      email: "someone@example.com",
      full_name: "Someone",
      invited_by: ownerA.id,
    });
    expect(insert.error?.code).toBe(PERMISSION_DENIED);

    const update = await ownerA.client
      .from("staff_invitations")
      .update({ accepted_at: new Date().toISOString() })
      .eq("id", invitationId);
    expect(update.error?.code).toBe(PERMISSION_DENIED);

    const remove = await ownerA.client.from("staff_invitations").delete().eq("id", invitationId);
    expect(remove.error?.code).toBe(PERMISSION_DENIED);
  });

  it("allow one open invitation per hostel and email", async () => {
    const { error } = await admin.from("staff_invitations").insert({
      hostel_id: hostelA,
      email: staffA.email,
      full_name: "Again",
      invited_by: ownerA.id,
    });
    expect(error?.code).toBe("23505");
  });

  it("store emails in lower case only", async () => {
    const { error } = await admin.from("staff_invitations").insert({
      hostel_id: hostelA,
      email: "Mixed@Example.com",
      full_name: "Mixed",
      invited_by: ownerA.id,
    });
    expect(error?.code).toBe("23514");
  });

  it("keep the email lookup away from signed-in users", async () => {
    const { error } = await ownerA.client.rpc("account_by_email", { p_email: staffA.email });
    expect(error?.code).toBe(PERMISSION_DENIED);

    const { data } = await admin.rpc("account_by_email", { p_email: staffA.email.toUpperCase() });
    expect(data?.[0]).toMatchObject({ user_id: staffA.id, role: "staff", hostel_id: hostelA });
  });
});

describe("removed staff", () => {
  let owner: TestUser;
  let staff: TestUser;
  let hostel: string;

  beforeAll(async () => {
    owner = await createUser();
    hostel = (await createHostel(owner.id)).id;
    staff = await createUser({ profile: { role: "staff", hostel_id: hostel } });
  });

  it("lose access to the hostel as soon as they are deactivated", async () => {
    const before = await staff.client.from("hostels").select("id");
    expect(before.data?.map((row) => row.id)).toEqual([hostel]);

    const { error } = await admin
      .from("profiles")
      .update({ deactivated_at: new Date().toISOString() })
      .eq("id", staff.id);
    expect(error).toBeNull();

    const after = await staff.client.from("hostels").select("id");
    expect(after.data).toEqual([]);
    const rooms = await staff.client.from("rooms").select("id");
    expect(rooms.data).toEqual([]);
  });

  it("cannot reactivate themselves", async () => {
    const { error } = await staff.client
      .from("profiles")
      .update({ deactivated_at: null })
      .eq("id", staff.id);
    expect(error?.code).toBe(PERMISSION_DENIED);
  });

  it("stay visible to the owner, for history", async () => {
    const { data } = await owner.client
      .from("profiles")
      .select("id, deactivated_at")
      .eq("id", staff.id)
      .single();
    expect(data?.deactivated_at).not.toBeNull();
  });
});
