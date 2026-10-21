import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { todayIst } from "@/lib/validation";

import { residentRow } from "../support/residents";
import { createUserFactory, type TestUser } from "../support/supabase";

/**
 * Subscription billing groundwork (ClickUp EP-14): plans, one subscription
 * per owner, trials, plan limits, read-only mode and revenue figures.
 */
const PERMISSION_DENIED = "42501";

const { admin, createUser, createPlatformAdmin, createHostel, cleanup } = createUserFactory();

afterAll(cleanup);

let platformAdmin: TestUser;
const yesterday = new Date(Date.parse(`${todayIst()}T00:00:00Z`) - 86_400_000)
  .toISOString()
  .slice(0, 10);

beforeAll(async () => {
  platformAdmin = await createPlatformAdmin();
  // A small plan for limit tests; placeholder prices are irrelevant here.
  const { error } = await platformAdmin.client.rpc("admin_save_plan", {
    p_id: "tiny_test",
    p_name: "Tiny",
    p_monthly_price: 10000,
    p_yearly_price: 100000,
    p_pricing_basis: "flat",
    p_max_beds: 2,
    p_max_hostels: 1,
    p_max_staff: 1,
    p_gst_inclusive: false,
    p_public: false,
    p_active: true,
    p_reason: "Test plan",
  });
  if (error) throw error;
});

afterAll(async () => {
  await admin.from("subscriptions").update({ plan_id: "pro" }).eq("plan_id", "tiny_test");
  await admin.from("plans").delete().eq("id", "tiny_test");
});

async function ownerWithHostel() {
  const owner = await createUser();
  const hostel = await createHostel(owner.id);
  return { owner, hostelId: hostel.id };
}

async function subscription(ownerId: string) {
  const { data } = await admin.from("subscriptions").select("*").eq("owner_id", ownerId).single();
  return data!;
}

const SHARING: Record<number, "single" | "double" | "triple"> = {
  1: "single",
  2: "double",
  3: "triple",
};

const room = (client: TestUser["client"], hostelId: string, number: string, capacity = 1) =>
  client
    .from("rooms")
    .insert({
      hostel_id: hostelId,
      room_number: number,
      floor: 1,
      sharing_type: SHARING[capacity],
      capacity,
    })
    .select("id")
    .single();

const setSubscription = (ownerId: string, extra: Record<string, unknown>) =>
  platformAdmin.client.rpc("admin_set_subscription", {
    p_owner_id: ownerId,
    p_plan_id: "pro",
    p_status: "active",
    p_reason: "Test",
    ...extra,
  });

describe("subscriptions", () => {
  it("start as a trial of the full product with an owner's first hostel", async () => {
    const { owner } = await ownerWithHostel();
    expect(await subscription(owner.id)).toMatchObject({ plan_id: "pro", status: "trialing" });
    const { data: own } = await owner.client.from("subscriptions").select("status");
    expect(own).toEqual([{ status: "trialing" }]);
    const { data: events } = await owner.client.from("subscription_events").select("to_status");
    expect(events).toEqual([{ to_status: "trialing" }]);
  });

  it("are changed only by platform admins, with a reason, and mirrored on the hostels", async () => {
    const { owner, hostelId } = await ownerWithHostel();
    const byOwner = await owner.client.rpc("admin_set_subscription", {
      p_owner_id: owner.id,
      p_plan_id: "pro",
      p_status: "active",
      p_reason: "Me",
    });
    expect(byOwner.error?.code).toBe(PERMISSION_DENIED);
    expect((await setSubscription(owner.id, { p_reason: " " })).error?.hint).toBe(
      "reason_required",
    );
    const { error } = await setSubscription(owner.id, { p_plan_id: "free" });
    expect(error).toBeNull();
    const { data: hostel } = await admin.from("hostels").select("plan").eq("id", hostelId).single();
    expect(hostel?.plan).toBe("free");
    const { data: audit } = await admin
      .from("admin_audit_log")
      .select("action, reason")
      .eq("target_user_id", owner.id);
    expect(audit).toContainEqual({ action: "subscription_changed", reason: "Test" });
  });

  it("keep their price when the plan's price changes later", async () => {
    const { owner } = await ownerWithHostel();
    await setSubscription(owner.id, { p_plan_id: "tiny_test" });
    expect((await subscription(owner.id)).price_monthly).toBe(10000);
    await platformAdmin.client.rpc("admin_save_plan", {
      p_id: "tiny_test",
      p_name: "Tiny",
      p_monthly_price: 20000,
      p_yearly_price: 200000,
      p_pricing_basis: "flat",
      p_max_beds: 2,
      p_max_hostels: 1,
      p_max_staff: 1,
      p_gst_inclusive: false,
      p_public: false,
      p_active: true,
      p_reason: "Price rise",
    });
    expect((await subscription(owner.id)).price_monthly).toBe(10000);
  });

  it("follow the per-hostel plan form", async () => {
    const { owner, hostelId } = await ownerWithHostel();
    await platformAdmin.client.rpc("admin_set_plan", {
      p_hostel_id: hostelId,
      p_plan: "paid",
      p_trial_ends_at: todayIst(),
      p_reason: "Paid by bank transfer",
    });
    expect(await subscription(owner.id)).toMatchObject({ status: "active", plan_id: "pro" });
  });
});

describe("read-only mode", () => {
  it("refuses every write once a trial ends, for owner and staff, but keeps reads and erasure", async () => {
    const { owner, hostelId } = await ownerWithHostel();
    const staff = await createUser({ profile: { role: "staff", hostel_id: hostelId } });
    const { data: vacated } = await admin
      .from("residents")
      .insert(residentRow(hostelId, { status: "vacated" }))
      .select("id")
      .single();
    await admin.from("subscriptions").update({ trial_ends_at: yesterday }).eq("owner_id", owner.id);

    for (const user of [owner, staff]) {
      const { error } = await room(user.client, hostelId, `R${user.id.slice(0, 4)}`);
      expect(error?.hint).toBe("account_read_only");
    }
    const resident = await staff.client.from("residents").insert(residentRow(hostelId));
    expect(resident.error?.hint).toBe("account_read_only");
    expect(
      (await owner.client.from("residents").select("id").eq("hostel_id", hostelId)).data,
    ).toHaveLength(1);

    const { data: status } = await staff.client.rpc("account_status", { p_hostel_id: hostelId });
    expect(status).toMatchObject({ can_write: false, effective_status: "read_only" });

    const erase = await owner.client.rpc("erase_resident", {
      p_resident_id: vacated!.id,
      p_reason: "Asked",
    });
    expect(erase.error).toBeNull();

    // An admin lifting it opens writes again.
    await setSubscription(owner.id, { p_status: "active" });
    expect((await room(owner.client, hostelId, "A1")).error).toBeNull();
  });

  it("applies to a cancelled account too, and to writes made inside the app's functions", async () => {
    const { owner, hostelId } = await ownerWithHostel();
    await setSubscription(owner.id, { p_status: "cancelled" });
    const { error } = await owner.client.rpc("generate_invoices", {
      p_hostel_id: hostelId,
      p_period_month: `${todayIst().slice(0, 7)}-01`,
      p_due_day: 5,
    });
    // Nothing to bill is not an error; a write that happens would be refused.
    expect(error === null || error.hint === "account_read_only").toBe(true);
    expect((await room(owner.client, hostelId, "C1")).error?.hint).toBe("account_read_only");
    const check = await owner.client.rpc("check_account_can_add", {
      p_hostel_id: hostelId,
      p_kind: "staff",
    });
    expect(check.error?.hint).toBe("account_read_only");
  });
});

describe("plan limits", () => {
  it("refuse beds, hostels and staff past the plan, naming the limit", async () => {
    const { owner, hostelId } = await ownerWithHostel();
    await setSubscription(owner.id, { p_plan_id: "tiny_test" });
    expect((await room(owner.client, hostelId, "L1", 2)).error).toBeNull();
    const third = await room(owner.client, hostelId, "L2", 1);
    expect(third.error?.hint).toBe("plan_limit");
    expect(third.error?.message).toContain("Tiny plan allows 2 beds");

    const hostel = await owner.client
      .from("hostels")
      .insert({ name: "Second", type: "boys", phone: "9876543210" });
    expect(hostel.error?.hint).toBe("plan_limit");

    await admin.from("staff_invitations").insert({
      hostel_id: hostelId,
      email: `limit-${Date.now()}@example.com`,
      full_name: "First Staff",
      invited_by: owner.id,
    });
    const staffCheck = await owner.client.rpc("check_account_can_add", {
      p_hostel_id: hostelId,
      p_kind: "staff",
    });
    expect(staffCheck.error?.hint).toBe("plan_limit");
  });

  it("refuse a downgrade below what is in use, listing what to remove", async () => {
    const { owner, hostelId } = await ownerWithHostel();
    await room(owner.client, hostelId, "D1", 3);
    const { error } = await setSubscription(owner.id, { p_plan_id: "tiny_test" });
    expect(error?.hint).toBe("plan_downgrade");
    expect(error?.message).toContain("3 beds in use; Tiny allows 2");
    // Nothing is removed by the attempt.
    const { count } = await admin
      .from("beds")
      .select("id", { count: "exact", head: true })
      .eq("hostel_id", hostelId);
    expect(count).toBe(3);
  });
});

describe("admin-only functions", () => {
  it("refuse owners and give admins revenue figures", async () => {
    const { owner } = await ownerWithHostel();
    for (const call of [
      owner.client.rpc("admin_revenue"),
      owner.client.rpc("admin_subscription", { p_owner_id: owner.id }),
    ]) {
      expect((await call).error?.code).toBe(PERMISSION_DENIED);
    }
    await setSubscription(owner.id, { p_plan_id: "pro" });
    const { data, error } = await platformAdmin.client.rpc("admin_revenue");
    expect(error).toBeNull();
    const revenue = data as { mrr: number; arr: number; by_status: Record<string, number> };
    expect(revenue.mrr).toBeGreaterThan(0);
    expect(revenue.arr).toBe(revenue.mrr * 12);
    expect(revenue.by_status.active).toBeGreaterThan(0);
    const { data: one } = await platformAdmin.client.rpc("admin_subscription", {
      p_owner_id: owner.id,
    });
    expect(one).toMatchObject({ plan_id: "pro", status: "active" });
  });
});

describe("terms", () => {
  it("record the version accepted at sign-up", async () => {
    const user = await createUser({ metadata: { terms_version: "2026-10-draft" } });
    const { data } = await admin
      .from("profiles")
      .select("terms_version, terms_accepted_at")
      .eq("id", user.id)
      .single();
    expect(data?.terms_version).toBe("2026-10-draft");
    expect(data?.terms_accepted_at).not.toBeNull();
  });
});
