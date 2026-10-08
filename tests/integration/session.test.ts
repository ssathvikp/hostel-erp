import { afterAll, describe, expect, it } from "vitest";

import { assertRole, AuthorizationError, loadSessionUser } from "@/lib/auth/roles";

import { anonClient, createUserFactory } from "../support/supabase";

/** The role guard resolving real users through RLS (E2-T6). */
const { createUser, createHostel, cleanup } = createUserFactory();

afterAll(cleanup);

describe("loadSessionUser", () => {
  it("resolves an owner from their own session", async () => {
    const owner = await createUser({ fullName: "Kiran Shah" });
    expect(await loadSessionUser(owner.client)).toEqual({
      id: owner.id,
      email: owner.email,
      fullName: "Kiran Shah",
      role: "owner",
      hostelId: null,
    });
  });

  it("resolves staff with their hostel", async () => {
    const owner = await createUser();
    const hostelId = (await createHostel(owner.id)).id;
    const staff = await createUser({ profile: { role: "staff", hostel_id: hostelId } });
    expect(await loadSessionUser(staff.client)).toMatchObject({ role: "staff", hostelId });
  });

  it("returns null for a signed-out visitor", async () => {
    expect(await loadSessionUser(anonClient())).toBeNull();
  });

  it("blocks staff from an owner-only action before anything else runs", async () => {
    const owner = await createUser();
    const hostel = await createHostel(owner.id);
    const staff = await createUser({ profile: { role: "staff", hostel_id: hostel.id } });
    const user = await loadSessionUser(staff.client);

    let write = false;
    const ownerOnlyAction = () => {
      assertRole(user, ["owner"]);
      write = true;
    };

    expect(ownerOnlyAction).toThrow(AuthorizationError);
    expect(write).toBe(false);
  });
});
