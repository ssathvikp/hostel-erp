import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { anonClient, createUserFactory, type TestUser } from "../support/supabase";

/**
 * Tenant isolation for hostels (E3-T2) and the integrity rules on the table
 * itself (E3-T1, E3-T6). Every assertion runs as a real signed-in user.
 */
const PERMISSION_DENIED = "42501";
const UNIQUE_VIOLATION = "23505";
const CHECK_VIOLATION = "23514";
const RAISED = "P0001";

const { admin, createUser, createHostel, cleanup } = createUserFactory();

afterAll(cleanup);

const basics = { name: "Sunrise PG", type: "boys", phone: "9876543210" } as const;
const complete = {
  address: "4 Residency Road",
  city: "Bengaluru",
  state: "Karnataka",
  pincode: "560025",
  floors: 4,
};

describe("hostel isolation between tenants", () => {
  let ownerA: TestUser;
  let ownerB: TestUser;
  let staffA: TestUser;
  let hostelA: string;
  let hostelB: string;

  beforeAll(async () => {
    [ownerA, ownerB] = await Promise.all([createUser(), createUser()]);
    hostelA = (await createHostel(ownerA.id, { name: "Alpha Residency" })).id;
    hostelB = (await createHostel(ownerB.id, { name: "Beta Residency" })).id;
    staffA = await createUser({ profile: { role: "staff", hostel_id: hostelA } });
  });

  async function visibleHostels(user: TestUser) {
    const { data, error } = await user.client.from("hostels").select("id");
    expect(error).toBeNull();
    return (data ?? []).map((row) => row.id);
  }

  it("shows each owner only their own hostels", async () => {
    expect(await visibleHostels(ownerA)).toEqual([hostelA]);
    expect(await visibleHostels(ownerB)).toEqual([hostelB]);
  });

  it("shows staff only the hostel they belong to", async () => {
    expect(await visibleHostels(staffA)).toEqual([hostelA]);
  });

  it("returns nothing when another tenant's hostel is requested by id", async () => {
    const { data, error } = await ownerB.client.from("hostels").select("*").eq("id", hostelA);
    expect(error).toBeNull();
    expect(data).toEqual([]);
  });

  it("does not let another owner update a hostel", async () => {
    const { data, error } = await ownerB.client
      .from("hostels")
      .update({ name: "Taken over" })
      .eq("id", hostelA)
      .select("id");
    expect(error).toBeNull();
    expect(data).toEqual([]);

    const { data: row } = await admin.from("hostels").select("name").eq("id", hostelA).single();
    expect(row?.name).toBe("Alpha Residency");
  });

  it("does not let staff edit their hostel", async () => {
    const { data } = await staffA.client
      .from("hostels")
      .update({ phone: "9123456789" })
      .eq("id", hostelA)
      .select("id");
    expect(data).toEqual([]);
  });

  it("does not let anyone delete a hostel", async () => {
    const { error } = await ownerA.client.from("hostels").delete().eq("id", hostelA);
    expect(error?.code).toBe(PERMISSION_DENIED);
  });

  it("denies a signed-out visitor all access", async () => {
    const { error } = await anonClient().from("hostels").select("id");
    expect(error?.code).toBe(PERMISSION_DENIED);
  });

  it("lets an owner see their own staff but not another tenant's", async () => {
    const { data } = await ownerA.client.from("profiles").select("id");
    expect((data ?? []).map((row) => row.id).sort()).toEqual([ownerA.id, staffA.id].sort());

    const { data: fromB } = await ownerB.client.from("profiles").select("id").eq("id", staffA.id);
    expect(fromB).toEqual([]);
  });
});

describe("creating hostels", () => {
  it("creates a draft owned by the caller with a generated slug", async () => {
    const owner = await createUser();
    const { data, error } = await owner.client
      .from("hostels")
      .insert({ ...basics, name: "Green Valley PG" })
      .select("owner_id, status, slug")
      .single();
    expect(error).toBeNull();
    expect(data).toEqual({ owner_id: owner.id, status: "draft", slug: "green-valley-pg" });
  });

  it("suffixes the slug when the name is already taken platform-wide", async () => {
    const [first, second] = await Promise.all([createUser(), createUser()]);
    const name = `Lotus Stay ${Date.now()}`;
    const a = await first.client
      .from("hostels")
      .insert({ ...basics, name })
      .select("slug")
      .single();
    const b = await second.client
      .from("hostels")
      .insert({ ...basics, name })
      .select("slug")
      .single();
    expect(b.data?.slug).toBe(`${a.data?.slug}-2`);
  });

  it("refuses a hostel created on behalf of another owner", async () => {
    const [owner, victim] = await Promise.all([createUser(), createUser()]);
    const { error } = await owner.client
      .from("hostels")
      .insert({ ...basics, owner_id: victim.id } as never);
    expect(error?.code).toBe(PERMISSION_DENIED);
  });

  it("refuses a hostel inserted directly as active or with a chosen slug", async () => {
    const owner = await createUser();
    const active = await owner.client
      .from("hostels")
      .insert({ ...basics, ...complete, status: "active" } as never);
    expect(active.error?.code).toBe(PERMISSION_DENIED);

    const slug = await owner.client.from("hostels").insert({ ...basics, slug: "chosen" } as never);
    expect(slug.error?.code).toBe(PERMISSION_DENIED);
  });

  it("does not let staff create hostels", async () => {
    const owner = await createUser();
    const hostel = await createHostel(owner.id);
    const staff = await createUser({ profile: { role: "staff", hostel_id: hostel.id } });
    const { error } = await staff.client.from("hostels").insert(basics);
    expect(error?.code).toBe(PERMISSION_DENIED);
  });

  it("allows only one unfinished draft per owner", async () => {
    const owner = await createUser();
    const first = await owner.client.from("hostels").insert({ ...basics, name: "First Draft" });
    expect(first.error).toBeNull();
    const second = await owner.client.from("hostels").insert({ ...basics, name: "Second Draft" });
    expect(second.error?.code).toBe(UNIQUE_VIOLATION);
  });

  it("rejects a second hostel with the same name for one owner, ignoring case", async () => {
    const owner = await createUser();
    await createHostel(owner.id, { name: "Comfort Inn" });
    const { error } = await owner.client
      .from("hostels")
      .insert({ ...basics, name: "  comfort INN " });
    expect(error?.code).toBe(UNIQUE_VIOLATION);
  });
});

describe("hostel status and identity", () => {
  it("activates a draft only once its address and capacity are complete", async () => {
    const owner = await createUser();
    const { data: draft } = await owner.client.from("hostels").insert(basics).select("id").single();

    const early = await owner.client
      .from("hostels")
      .update({ status: "active" })
      .eq("id", draft!.id);
    expect(early.error?.code).toBe(CHECK_VIOLATION);

    const done = await owner.client
      .from("hostels")
      .update({ ...complete, status: "active" })
      .eq("id", draft!.id)
      .select("status")
      .single();
    expect(done.error).toBeNull();
    expect(done.data?.status).toBe("active");
  });

  it("never lets an owner move a hostel back to draft or suspend it", async () => {
    const owner = await createUser();
    const hostel = await createHostel(owner.id);

    for (const status of ["draft", "suspended"]) {
      const { error } = await owner.client.from("hostels").update({ status }).eq("id", hostel.id);
      expect(error?.code).toBe(RAISED);
    }
  });

  it("never lets an owner change the owner or slug", async () => {
    const [owner, other] = await Promise.all([createUser(), createUser()]);
    const hostel = await createHostel(owner.id);

    const reassign = await owner.client
      .from("hostels")
      .update({ owner_id: other.id } as never)
      .eq("id", hostel.id);
    expect(reassign.error?.code).toBe(PERMISSION_DENIED);

    const reslug = await owner.client
      .from("hostels")
      .update({ slug: "new-slug" } as never)
      .eq("id", hostel.id);
    expect(reslug.error?.code).toBe(PERMISSION_DENIED);
  });

  it("maintains updated_at on every edit", async () => {
    const owner = await createUser();
    const hostel = await createHostel(owner.id);
    const { data } = await owner.client
      .from("hostels")
      .update({ city: "Mysuru" })
      .eq("id", hostel.id)
      .select("updated_at")
      .single();
    expect(new Date(data!.updated_at).getTime()).toBeGreaterThan(
      new Date(hostel.updated_at).getTime(),
    );
  });
});

describe("slug generation under concurrency", () => {
  it("gives simultaneous hostels with the same name distinct slugs", async () => {
    const owners = await Promise.all(Array.from({ length: 5 }, () => createUser()));
    const name = `Twin Towers ${Date.now()}`;

    const results = await Promise.all(
      owners.map((owner) =>
        owner.client
          .from("hostels")
          .insert({ ...basics, name })
          .select("slug")
          .single(),
      ),
    );

    expect(results.map((result) => result.error)).toEqual([null, null, null, null, null]);
    const slugs = results.map((result) => result.data?.slug);
    expect(new Set(slugs).size).toBe(5);
  });
});
