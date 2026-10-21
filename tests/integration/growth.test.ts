import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { todayIst } from "@/lib/validation";

import { createUserFactory, type TestUser } from "../support/supabase";

/**
 * Trial length, plan history, referrals, empty-bed cost and platform
 * metrics (20261019090000_growth.sql).
 */
const PERMISSION_DENIED = "42501";

const { admin, createUser, createPlatformAdmin, createHostel, cleanup } = createUserFactory();

afterAll(async () => {
  // Leave the platform default as the migration set it.
  await admin.from("platform_settings").update({ trial_days: 30 }).eq("id", true);
  await cleanup();
});

let platformAdmin: TestUser;
let owner: TestUser;
let staff: TestUser;
let hostelId: string;

function addDays(date: string, days: number): string {
  const value = new Date(`${date}T00:00:00Z`);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}

beforeAll(async () => {
  platformAdmin = await createPlatformAdmin();
  owner = await createUser();
  hostelId = (await createHostel(owner.id)).id;
  staff = await createUser({ profile: { role: "staff", hostel_id: hostelId } });
});

describe("trial length", () => {
  it("is set by platform admins only, and used for owners who start afterwards", async () => {
    for (const user of [owner, staff]) {
      const { error } = await user.client.rpc("admin_set_trial_days", { p_days: 45 });
      expect(error?.code).toBe(PERMISSION_DENIED);
    }
    const tooLong = await platformAdmin.client.rpc("admin_set_trial_days", { p_days: 365 });
    expect(tooLong.error?.hint).toBe("trial_days_range");

    expect(
      (await platformAdmin.client.rpc("admin_set_trial_days", { p_days: 45 })).error,
    ).toBeNull();
    // The trial belongs to the owner's account (ClickUp EP-14): a new owner's
    // first hostel starts it (tests/integration/subscriptions.test.ts covers more).
    const newcomer = await createUser();
    const { data, error } = await newcomer.client
      .from("hostels")
      .insert({ name: `Trial length ${Date.now()}`, type: "boys", phone: "9876543210" })
      .select("trial_ends_at")
      .single();
    expect(error).toBeNull();
    expect(data?.trial_ends_at).toBe(addDays(todayIst(), 45));

    const settings = await owner.client.from("platform_settings").select("trial_days");
    expect(settings.data ?? []).toEqual([]);
  });
});

describe("plan history", () => {
  it("logs the first plan and every change, with who made it", async () => {
    const id = (await createHostel(owner.id)).id;
    await platformAdmin.client.rpc("admin_set_plan", {
      p_hostel_id: id,
      p_plan: "paid",
      p_trial_ends_at: todayIst(),
      p_reason: "Agreed with the owner",
    });
    const { data } = await admin
      .from("plan_events")
      .select("plan, changed_by")
      .eq("hostel_id", id)
      .order("id");
    expect(data).toEqual([
      { plan: "trial", changed_by: null },
      { plan: "paid", changed_by: platformAdmin.id },
    ]);
    // Users never read it directly.
    expect((await owner.client.from("plan_events").select("id")).data ?? []).toEqual([]);
  });
});

describe("referrals", () => {
  it("gives each owner one stable code and links the owners who sign up with it", async () => {
    const first = await owner.client.rpc("my_referral_code");
    const again = await owner.client.rpc("my_referral_code");
    expect(first.error).toBeNull();
    expect(first.data).toMatch(/^[A-HJ-NP-Z2-9]{8}$/);
    expect(again.data).toBe(first.data);

    const referred = await createUser({ metadata: { referral_code: first.data!.toLowerCase() } });
    const stranger = await createUser({ metadata: { referral_code: "NOTACODE" } });
    const { data: profiles } = await admin
      .from("profiles")
      .select("id, referred_by")
      .in("id", [referred.id, stranger.id]);
    expect(profiles).toEqual(
      expect.arrayContaining([
        { id: referred.id, referred_by: owner.id },
        { id: stranger.id, referred_by: null },
      ]),
    );

    expect((await owner.client.rpc("my_referrals")).data).toEqual({
      signed_up: 1,
      set_up: 0,
      paying: 0,
    });
    const paying = await createHostel(referred.id, { plan: "paid" });
    expect(paying.plan).toBe("paid");
    expect((await owner.client.rpc("my_referrals")).data).toEqual({
      signed_up: 1,
      set_up: 1,
      paying: 1,
    });
  });

  it("gives staff no code, and never lets anyone write a code or referrer", async () => {
    const { error } = await staff.client.rpc("my_referral_code");
    expect(error?.code).toBe(PERMISSION_DENIED);
    const write = await owner.client
      .from("profiles")
      .update({ referral_code: "AAAAAAAA" })
      .eq("id", owner.id);
    expect(write.error?.code).toBe(PERMISSION_DENIED);
  });
});

describe("empty-bed cost", () => {
  it("prices vacant beds at today's rate and counts unpriced ones separately", async () => {
    const id = (await createHostel(owner.id)).id;
    for (const [room_number, sharing_type, capacity] of [
      ["1", "double", 2],
      ["2", "single", 1],
    ] as const) {
      const { error } = await admin
        .from("rooms")
        .insert({ hostel_id: id, room_number, floor: 1, sharing_type, capacity });
      if (error) throw error;
    }
    await admin.from("fee_structures").insert({
      hostel_id: id,
      sharing_type: "double",
      monthly_amount: 600000,
      effective_from: "2020-01-01",
    });
    const { data, error } = await owner.client.rpc("vacancy_cost", { p_hostel_id: id });
    expect(error).toBeNull();
    expect(data).toEqual({ vacant_beds: 3, monthly_value: 1200000, unpriced_beds: 1 });

    // Another owner's hostel shows nothing.
    const other = await createUser();
    expect((await other.client.rpc("vacancy_cost", { p_hostel_id: id })).data).toEqual({
      vacant_beds: 0,
      monthly_value: 0,
      unpriced_beds: 0,
    });
  });
});

describe("admin metrics and hostel list", () => {
  it("are refused to owners and staff", async () => {
    for (const user of [owner, staff]) {
      expect((await user.client.rpc("admin_metrics")).error?.code).toBe(PERMISSION_DENIED);
      expect((await user.client.rpc("admin_hostels")).error?.code).toBe(PERMISSION_DENIED);
    }
  });

  it("return aggregates with no names, and set-up and referral columns per hostel", async () => {
    const { data, error } = await platformAdmin.client.rpc("admin_metrics");
    expect(error).toBeNull();
    const metrics = data as Record<string, unknown>;
    expect(Object.keys(metrics).sort()).toEqual(
      [
        "beds",
        "hostels",
        "hostels_active_30_days",
        "left_paid_30_days",
        "monthly",
        "occupied_beds",
        "owners",
        "owners_set_up",
        "paying_30_days_ago",
        "plans",
        "residents",
        "signups_by_week",
        "trial_days",
        "trials_converted",
        "trials_lapsed",
      ].sort(),
    );
    expect(metrics.signups_by_week).toHaveLength(8);
    expect(metrics.monthly).toHaveLength(6);
    expect(JSON.stringify(metrics)).not.toContain(owner.email);

    const hostels = await platformAdmin.client.rpc("admin_hostels");
    const row = hostels.data?.find((hostel) => hostel.id === hostelId);
    expect(row).toMatchObject({
      rates_set: false,
      allocations_ever: 0,
      first_invoice_on: null,
      first_payment_on: null,
      referrals: 1,
      paying_referrals: 1,
    });
    expect(row!.owner_hostels).toBeGreaterThanOrEqual(1);
  });
});
