import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { anonClient, createUserFactory, type TestUser } from "../support/supabase";

/**
 * Billing data is per account (EP-14): an owner sees only their own
 * subscription, history, business details and tax invoices; staff and other
 * owners see none of it; nobody signed in can write billing state directly.
 */
const PERMISSION_DENIED = "42501";

const { admin, createUser, createHostel, cleanup } = createUserFactory();

afterAll(cleanup);

let ownerA: TestUser;
let ownerB: TestUser;
let staffA: TestUser;
let hostelA: string;

beforeAll(async () => {
  [ownerA, ownerB] = await Promise.all([createUser(), createUser()]);
  hostelA = (await createHostel(ownerA.id)).id;
  await createHostel(ownerB.id);
  staffA = await createUser({ profile: { role: "staff", hostel_id: hostelA } });
  for (const owner of [ownerA, ownerB]) {
    const { error } = await owner.client.from("billing_profiles").insert({
      legal_name: `Business of ${owner.email}`,
      address: "12 MG Road, Bengaluru",
      state_code: "29",
    });
    expect(error).toBeNull();
  }
});

describe("billing isolation", () => {
  it("shows an owner only their own subscription and history", async () => {
    const subs = await ownerA.client.from("subscriptions").select("owner_id");
    expect(subs.data).toEqual([{ owner_id: ownerA.id }]);
    const events = await ownerA.client.from("subscription_events").select("owner_id");
    expect(new Set(events.data?.map((row) => row.owner_id))).toEqual(new Set([ownerA.id]));
  });

  it("shows staff no subscription, history or business details", async () => {
    for (const table of ["subscriptions", "subscription_events", "billing_profiles"] as const) {
      const { data } = await staffA.client.from(table).select("*");
      expect(data).toEqual([]);
    }
    const overview = await staffA.client.rpc("billing_overview");
    expect(overview.error?.code).toBe(PERMISSION_DENIED);
  });

  it("keeps business details per owner", async () => {
    const { data } = await ownerA.client.from("billing_profiles").select("owner_id");
    expect(data).toEqual([{ owner_id: ownerA.id }]);
    const stolen = await ownerB.client
      .from("billing_profiles")
      .update({ legal_name: "Hijacked" })
      .eq("owner_id", ownerA.id)
      .select();
    expect(stolen.data).toEqual([]);
    const forged = await ownerB.client.from("billing_profiles").insert({
      owner_id: ownerA.id,
      legal_name: "Forged",
      address: "Nowhere road",
      state_code: "29",
    });
    expect(forged.error).not.toBeNull();
  });

  it("refuses direct writes to subscriptions, plans and invoices", async () => {
    const sub = await ownerA.client
      .from("subscriptions")
      .update({ status: "active" })
      .eq("owner_id", ownerA.id);
    expect(sub.error?.code).toBe(PERMISSION_DENIED);
    const plan = await ownerA.client
      .from("plans")
      .update({ monthly_price: 1 })
      .eq("code", "starter");
    expect(plan.error?.code).toBe(PERMISSION_DENIED);
    const invoice = await ownerA.client.from("platform_invoices").insert({} as never);
    expect(invoice.error?.code).toBe(PERMISSION_DENIED);
  });

  it("answers hostel_account_state only for members of the hostel", async () => {
    const member = await staffA.client.rpc("hostel_account_state", { p_hostel_id: hostelA });
    expect(member.data).toMatchObject({ status: "trialing", can_write: true });
    const stranger = await ownerB.client.rpc("hostel_account_state", { p_hostel_id: hostelA });
    expect(stranger.data).toBeNull();
  });

  it("gives signed-out visitors nothing", async () => {
    const anon = anonClient();
    for (const table of [
      "plans",
      "subscriptions",
      "platform_invoices",
      "billing_settings",
    ] as const) {
      const { data, error } = await anon.from(table).select("*");
      expect(data ?? []).toEqual([]);
      if (error) expect(error.code).toBe(PERMISSION_DENIED);
    }
    const { error } = await anon.rpc("billing_overview");
    expect(error).not.toBeNull();
  });

  it("refuses an owner's checkout of a hidden plan", async () => {
    const { error } = await ownerA.client.rpc("billing_prepare_checkout", {
      p_plan_code: "founder",
      p_interval: "month",
    });
    expect(error?.hint).toBe("plan_not_found");
    // The admin client only reads, to prove the plan exists.
    const { data } = await admin.from("plans").select("code").eq("code", "founder");
    expect(data).toHaveLength(1);
  });
});
