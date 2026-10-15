import { randomUUID } from "node:crypto";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { TERMS_VERSION } from "@/lib/legal";

import { connectToDatabase } from "../support/db";
import { residentRow } from "../support/residents";
import { createUserFactory, type TestUser } from "../support/supabase";
import { enrolTotp } from "../support/totp";

/**
 * SaaS billing (EP-14) in the database: the trial, plan limits, read-only
 * mode, gateway webhooks (idempotent, with GST invoices and credit notes),
 * failed payments and dunning, the billing job, admin adjustments (E10-T7)
 * and revenue figures.
 */
const RAISED = "P0001";
const PERMISSION_DENIED = "42501";

const { admin, createUser, createHostel, cleanup } = createUserFactory();
const sql = connectToDatabase();

afterAll(async () => {
  await cleanup();
  await sql.end();
});

let platformAdmin: TestUser;

beforeAll(async () => {
  platformAdmin = await createUser({ profile: { role: "platform_admin" } });
  await enrolTotp(platformAdmin.client);
});

async function subscriptionOf(ownerId: string) {
  const { data, error } = await admin
    .from("subscriptions")
    .select("*, plans!subscriptions_plan_id_fkey(code)")
    .eq("owner_id", ownerId)
    .single();
  if (error) throw error;
  return data;
}

async function planId(code: string): Promise<string> {
  const { data } = await admin.from("plans").select("id").eq("code", code).single();
  return data!.id;
}

/** An owner with one active hostel, on a fresh trial. */
async function ownerWithHostel() {
  const owner = await createUser({ fullName: "Billing Owner" });
  const hostel = await createHostel(owner.id);
  return { owner, hostelId: hostel.id };
}

async function addRoom(owner: TestUser, hostelId: string, roomNumber: string, capacity = 2) {
  return owner.client
    .from("rooms")
    .insert({
      hostel_id: hostelId,
      room_number: roomNumber,
      floor: 1,
      sharing_type: capacity === 1 ? "single" : capacity === 2 ? "double" : "triple",
      capacity,
    })
    .select("id")
    .single();
}

/** Sends a normalised gateway event as the webhook route does. */
function gatewayEvent(
  kind: string,
  data: Record<string, unknown>,
  eventId = `evt_${randomUUID()}`,
) {
  return admin.rpc("billing_apply_gateway_event", {
    p_event_id: eventId,
    p_event_type: `subscription.${kind}`,
    p_kind: kind,
    p_data: data as never,
  });
}

/** Takes an owner through checkout to an active paid plan. */
async function subscribe(owner: TestUser, planCode = "starter", interval = "month") {
  const { data: checkout, error } = await owner.client.rpc("billing_prepare_checkout", {
    p_plan_code: planCode,
    p_interval: interval,
  });
  expect(error).toBeNull();
  const gatewaySub = `sub_${randomUUID().slice(0, 14)}`;
  const attached = await admin.rpc("billing_attach_checkout", {
    p_subscription_id: (checkout as { subscription_id: string }).subscription_id,
    p_gateway_subscription_id: gatewaySub,
    p_gateway_customer_id: "cust_test",
    p_gateway_plan_id: "plan_test",
  });
  expect(attached.error).toBeNull();
  const start = new Date();
  const end = new Date(start.getTime() + 30 * 86_400_000);
  const activated = await gatewayEvent("activated", {
    subscription_id: gatewaySub,
    current_start: start.toISOString(),
    current_end: end.toISOString(),
  });
  expect(activated.data).toBe("applied");
  return { gatewaySub, start, end, checkout: checkout as Record<string, unknown> };
}

describe("trial and subscription", () => {
  it("starts a trial of the trial plan when an owner creates their first hostel", async () => {
    const owner = await createUser();
    const { data: none } = await admin.from("subscriptions").select("id").eq("owner_id", owner.id);
    expect(none).toEqual([]);

    await createHostel(owner.id);
    const sub = await subscriptionOf(owner.id);
    expect(sub.status).toBe("trialing");
    expect(sub.plans.code).toBe("pro");
    const days = (new Date(sub.trial_ends_at!).getTime() - Date.now()) / 86_400_000;
    expect(days).toBeGreaterThan(13.9);
    expect(days).toBeLessThanOrEqual(14);

    const { data: events } = await admin
      .from("subscription_events")
      .select("source, to_status")
      .eq("subscription_id", sub.id);
    expect(events).toEqual([{ source: "signup", to_status: "trialing" }]);
  });

  it("gives staff and admin accounts no subscription of their own", async () => {
    const { owner, hostelId } = await ownerWithHostel();
    const staff = await createUser({ profile: { role: "staff", hostel_id: hostelId } });
    const { data } = await admin
      .from("subscriptions")
      .select("owner_id")
      .in("owner_id", [staff.id, platformAdmin.id]);
    expect(data).toEqual([]);
    expect((await subscriptionOf(owner.id)).status).toBe("trialing");
  });

  it("moves statuses only along allowed paths", async () => {
    const { owner } = await ownerWithHostel();
    const sub = await subscriptionOf(owner.id);
    await admin.from("subscriptions").update({ status: "cancelled" }).eq("id", sub.id);
    const { error } = await admin
      .from("subscriptions")
      .update({ status: "past_due", past_due_since: new Date().toISOString() })
      .eq("id", sub.id);
    expect(error?.code).toBe(RAISED);
    expect(error?.hint).toBe("subscription_status_transition");
  });

  it("keeps the subscription history immutable", async () => {
    const { owner } = await ownerWithHostel();
    const sub = await subscriptionOf(owner.id);
    const rows = await sql`
      select id from public.subscription_events where subscription_id = ${sub.id} limit 1`;
    await expect(
      sql`update public.subscription_events set reason = 'x' where id = ${rows[0].id}`,
    ).rejects.toThrow(/cannot be changed/);
  });
});

describe("read-only mode", () => {
  let owner: TestUser;
  let staff: TestUser;
  let hostelId: string;
  let residentId: string;

  beforeAll(async () => {
    ({ owner, hostelId } = await ownerWithHostel());
    staff = await createUser({ profile: { role: "staff", hostel_id: hostelId } });
    expect((await addRoom(owner, hostelId, "101")).error).toBeNull();
    const { data } = await owner.client
      .from("residents")
      .insert(residentRow(hostelId))
      .select("id")
      .single();
    residentId = data!.id;
    for (const status of ["notice", "vacated"] as const) {
      const { error } = await owner.client
        .from("residents")
        .update({ status })
        .eq("id", residentId);
      expect(error).toBeNull();
    }
    // The trial ended an hour ago; the billing job has not run yet.
    await admin
      .from("subscriptions")
      .update({ trial_ends_at: new Date(Date.now() - 3_600_000).toISOString() })
      .eq("owner_id", owner.id);
  });

  it("refuses writes as soon as the trial ends, for the owner and staff", async () => {
    const room = await addRoom(owner, hostelId, "102");
    expect(room.error?.code).toBe(RAISED);
    expect(room.error?.hint).toBe("account_read_only");

    const resident = await staff.client
      .from("residents")
      .insert(residentRow(hostelId))
      .select("id")
      .single();
    expect(resident.error?.hint).toBe("account_read_only");

    const hostel = await owner.client.from("hostels").update({ floors: 4 }).eq("id", hostelId);
    expect(hostel.error?.hint).toBe("account_read_only");

    const bulk = await owner.client.rpc("create_rooms_bulk", {
      p_hostel_id: hostelId,
      p_from: 201,
      p_to: 203,
      p_floor: 2,
      p_sharing_type: "double",
      p_capacity: 2,
    });
    expect(bulk.error?.hint).toBe("account_read_only");
  });

  it("keeps reads, export and resident erasure working", async () => {
    const rooms = await owner.client.from("rooms").select("room_number").eq("hostel_id", hostelId);
    expect(rooms.data).toEqual([{ room_number: "101" }]);

    const exported = await owner.client.rpc("export_hostel_data", { p_hostel_id: hostelId });
    expect(exported.error).toBeNull();

    const erased = await owner.client.rpc("erase_resident", {
      p_resident_id: residentId,
      p_reason: "Resident asked us to erase their data",
    });
    expect(erased.error).toBeNull();
  });

  it("tells staff and the owner why, without showing staff any prices", async () => {
    const { data } = await staff.client.rpc("hostel_account_state", { p_hostel_id: hostelId });
    expect(data).toMatchObject({ status: "trialing", can_write: false });
    const subs = await staff.client.from("subscriptions").select("id");
    expect(subs.data).toEqual([]);
  });

  it("does not stop the service role recording money paid through the gateway", async () => {
    const { error } = await admin.from("rooms").insert({
      hostel_id: hostelId,
      room_number: "900",
      floor: 9,
      sharing_type: "single",
      capacity: 1,
    });
    expect(error).toBeNull();
  });

  it("lets the owner keep their billing details up to date", async () => {
    const { error } = await owner.client.from("billing_profiles").insert({
      legal_name: "Sunrise Hospitality LLP",
      address: "12 MG Road, Bengaluru",
      state_code: "29",
      gstin: "29ABCDE1234F1Z5",
    });
    expect(error).toBeNull();
  });
});

describe("plan limits", () => {
  let owner: TestUser;
  let hostelId: string;

  beforeAll(async () => {
    ({ owner, hostelId } = await ownerWithHostel());
    // Starter: 50 beds, 1 hostel, 2 staff.
    await admin
      .from("subscriptions")
      .update({ plan_id: await planId("starter") })
      .eq("owner_id", owner.id);
  });

  it("refuses beds past the limit, a whole bulk range at once", async () => {
    const bulk = await owner.client.rpc("create_rooms_bulk", {
      p_hostel_id: hostelId,
      p_from: 101,
      p_to: 126,
      p_floor: 1,
      p_sharing_type: "double",
      p_capacity: 2,
    });
    expect(bulk.error?.code).toBe(RAISED);
    expect(bulk.error?.hint).toBe("plan_limit_beds");
    expect(bulk.error?.message).toBe("Your Starter plan allows up to 50 beds");
    const { count } = await admin
      .from("rooms")
      .select("id", { count: "exact", head: true })
      .eq("hostel_id", hostelId);
    expect(count).toBe(0);

    const fits = await owner.client.rpc("create_rooms_bulk", {
      p_hostel_id: hostelId,
      p_from: 101,
      p_to: 125,
      p_floor: 1,
      p_sharing_type: "double",
      p_capacity: 2,
    });
    expect(fits.error).toBeNull();
    const oneMore = await addRoom(owner, hostelId, "301", 1);
    expect(oneMore.error?.hint).toBe("plan_limit_beds");
  });

  it("refuses a second hostel", async () => {
    const { error } = await owner.client
      .from("hostels")
      .insert({
        name: "Second PG",
        type: "co_ed",
        phone: "9876543210",
        address: "4 Brigade Road",
        city: "Bengaluru",
        state: "Karnataka",
        pincode: "560001",
        floors: 2,
      })
      .select("id")
      .single();
    expect(error?.hint).toBe("plan_limit_hostels");
  });

  it("refuses a third staff account, even from the service role", async () => {
    await createUser({ profile: { role: "staff", hostel_id: hostelId } });
    await createUser({ profile: { role: "staff", hostel_id: hostelId } });
    await expect(
      createUser({ profile: { role: "staff", hostel_id: hostelId } }),
    ).rejects.toMatchObject({ hint: "plan_limit_staff" });
  });

  it("never removes data above a limit when the plan shrinks", async () => {
    await admin.from("plans").update({ max_beds: 10 }).eq("code", "starter");
    try {
      const { count } = await admin
        .from("beds")
        .select("id", { count: "exact", head: true })
        .eq("hostel_id", hostelId)
        .is("archived_at", null);
      expect(count).toBe(50);
    } finally {
      await admin.from("plans").update({ max_beds: 50 }).eq("code", "starter");
    }
  });

  it("refuses checkout of a plan the account does not fit, saying what to remove", async () => {
    await admin.from("plans").update({ max_beds: 10 }).eq("code", "starter");
    try {
      const { error } = await owner.client.rpc("billing_prepare_checkout", {
        p_plan_code: "starter",
        p_interval: "month",
      });
      expect(error?.hint).toBe("plan_too_small");
      expect(JSON.parse(error!.details)).toEqual([{ what: "beds", limit: 10, used: 50 }]);
    } finally {
      await admin.from("plans").update({ max_beds: 50 }).eq("code", "starter");
    }
  });
});

describe("prices", () => {
  it("prices flat, per-bed and tiered plans from the bed count", async () => {
    const amount = async (code: string, interval: string, beds: number) => {
      const [row] = await sql<{ amount: number }[]>`
        select private.plan_amount(${await planId(code)}, ${interval}, ${beds}) as amount`;
      return row.amount;
    };
    expect(await amount("starter", "month", 40)).toBe(99900);
    expect(await amount("starter", "year", 40)).toBe(999000);
    // Per bed with a 20-bed minimum.
    expect(await amount("growth", "month", 5)).toBe(20 * 2500);
    expect(await amount("growth", "month", 120)).toBe(120 * 2500);
    expect(await amount("pro", "month", 500)).toBe(999900);
    expect(await amount("pro", "month", 501)).toBe(1799900);
  });

  it("rejects tiers that do not go up", async () => {
    const { error } = await platformAdmin.client.rpc("admin_save_plan", {
      p_plan: {
        code: `bad_${randomUUID().slice(0, 6)}`,
        name: "Bad tiers",
        pricing_basis: "tiered",
        tiers: [
          { up_to_beds: 100, monthly_price: 1, annual_price: 1 },
          { up_to_beds: 50, monthly_price: 2, annual_price: 2 },
        ],
      },
    });
    expect(error?.hint).toBe("plan_tiers_invalid");
  });

  it("splits GST by place of supply", async () => {
    const [intra] = await sql`select * from private.gst_split(118000, 1800, '29', '29')`;
    expect(intra).toEqual({ taxable_value: 100000, cgst: 9000, sgst: 9000, igst: 0 });
    const [inter] = await sql`select * from private.gst_split(118000, 1800, '27', '29')`;
    expect(inter).toEqual({ taxable_value: 100000, cgst: 0, sgst: 0, igst: 18000 });
    const [odd] = await sql`select * from private.gst_split(117999, 1800, '29', '29')`;
    expect(odd.taxable_value + odd.cgst + odd.sgst).toBe(117999);
  });

  it("numbers invoices by financial year", async () => {
    const [row] = await sql`
      select private.financial_year('2026-03-31T18:29:00Z') as before_april,
             private.financial_year('2026-03-31T18:31:00Z') as april_first`;
    expect(row).toEqual({ before_april: "25-26", april_first: "26-27" });
  });
});

describe("gateway webhooks", () => {
  let owner: TestUser;
  let hostelId: string;
  let gatewaySub: string;
  let end: Date;

  beforeAll(async () => {
    ({ owner, hostelId } = await ownerWithHostel());
    ({ gatewaySub, end } = await subscribe(owner, "starter", "month"));
  });

  it("activates the plan the owner checked out", async () => {
    const sub = await subscriptionOf(owner.id);
    expect(sub).toMatchObject({
      status: "active",
      billing_interval: "month",
      amount: 99900,
      checkout_plan_id: null,
      gateway_subscription_id: gatewaySub,
    });
    expect(sub.plans.code).toBe("starter");
    const outbox = await sql`
      select kind from public.email_outbox where dedupe_key = ${`subscription_activated:${gatewaySub}`}`;
    expect(outbox).toHaveLength(1);
  });

  it("issues one GST invoice per payment, however often the event arrives", async () => {
    await admin
      .from("billing_settings")
      .update({ seller_state_code: "29", seller_legal_name: "Hostel ERP Test Pvt Ltd" })
      .eq("id", true);
    await owner.client.from("billing_profiles").insert({
      legal_name: "Sunrise PG",
      address: "1 Residency Road, Bengaluru",
      state_code: "29",
    });
    const paymentId = `pay_${randomUUID().slice(0, 14)}`;
    const event = {
      subscription_id: gatewaySub,
      current_start: new Date().toISOString(),
      current_end: end.toISOString(),
      payment: { id: paymentId, amount: 117882 },
    };
    const eventId = `evt_${randomUUID()}`;
    expect((await gatewayEvent("charged", event, eventId)).data).toBe("applied");
    expect((await gatewayEvent("charged", event, eventId)).data).toBe("duplicate");
    // A different event id for the same payment still makes one invoice.
    expect((await gatewayEvent("charged", event)).data).toBe("applied");

    const { data: invoices } = await owner.client
      .from("platform_invoices")
      .select("*")
      .eq("gateway_payment_id", paymentId);
    expect(invoices).toHaveLength(1);
    const invoice = invoices![0];
    expect(invoice.number).toMatch(/^HE\/\d{2}-\d{2}\/\d{5}$/);
    expect(invoice.number.length).toBeLessThanOrEqual(16);
    expect(invoice).toMatchObject({
      total: 117882,
      taxable_value: 99900,
      cgst: 8991,
      sgst: 8991,
      igst: 0,
      place_of_supply: "29",
    });
    expect(invoice.buyer).toMatchObject({ legal_name: "Sunrise PG" });
    expect(invoice.seller).toMatchObject({ legal_name: "Hostel ERP Test Pvt Ltd" });

    const change = await admin.from("platform_invoices").update({ total: 1 }).eq("id", invoice.id);
    expect(change.error?.hint).toBe("history_immutable");
  });

  it("credits a refund once, never more than was paid", async () => {
    const { data: invoice } = await admin
      .from("platform_invoices")
      .select("gateway_payment_id, total")
      .eq("owner_id", owner.id)
      .eq("kind", "invoice")
      .single();
    const refund = {
      subscription_id: gatewaySub,
      refund: {
        id: `rfnd_${randomUUID().slice(0, 10)}`,
        payment_id: invoice!.gateway_payment_id,
        amount: 999999,
      },
    };
    expect((await gatewayEvent("refunded", refund)).data).toBe("applied");
    expect((await gatewayEvent("refunded", refund)).data).toBe("applied");
    const { data: notes } = await admin
      .from("platform_invoices")
      .select("number, total")
      .eq("owner_id", owner.id)
      .eq("kind", "credit_note");
    expect(notes).toHaveLength(1);
    expect(notes![0].total).toBe(invoice!.total);
    expect(notes![0].number).toMatch(/^HC\//);
  });

  it("marks a failed charge past due, emails once, and keeps access through the grace period", async () => {
    const failed = { subscription_id: gatewaySub };
    expect((await gatewayEvent("pending", failed)).data).toBe("applied");
    expect((await gatewayEvent("pending", failed)).data).toBe("ignored");
    const sub = await subscriptionOf(owner.id);
    expect(sub.status).toBe("past_due");
    const canWrite = await addRoom(owner, hostelId, "501");
    expect(canWrite.error).toBeNull();
    const emails = await sql`
      select count(*)::int as n from public.email_outbox
       where kind = 'payment_failed' and dedupe_key like ${`payment_failed:${sub.id}:%`}`;
    expect(emails[0].n).toBe(1);
  });

  it("becomes read-only after the grace period and comes back the moment it is paid", async () => {
    await admin
      .from("subscriptions")
      .update({ past_due_since: new Date(Date.now() - 8 * 86_400_000).toISOString() })
      .eq("owner_id", owner.id);
    expect((await addRoom(owner, hostelId, "502")).error?.hint).toBe("account_read_only");

    await sql`select private.billing_run()`;
    expect((await subscriptionOf(owner.id)).status).toBe("read_only");

    const paid = await gatewayEvent("charged", {
      subscription_id: gatewaySub,
      current_start: end.toISOString(),
      current_end: new Date(end.getTime() + 30 * 86_400_000).toISOString(),
      payment: { id: `pay_${randomUUID().slice(0, 14)}`, amount: 117882 },
    });
    expect(paid.data).toBe("applied");
    const sub = await subscriptionOf(owner.id);
    expect(sub.status).toBe("active");
    expect(sub.past_due_since).toBeNull();
    expect((await addRoom(owner, hostelId, "502")).error).toBeNull();
  });

  it("ignores events for subscriptions it does not know", async () => {
    const { data } = await gatewayEvent("activated", { subscription_id: "sub_unknown" });
    expect(data).toBe("unknown_subscription");
  });

  it("refuses the gateway functions to signed-in users", async () => {
    const { error } = await owner.client.rpc("billing_apply_gateway_event", {
      p_event_id: "evt_forged",
      p_event_type: "subscription.activated",
      p_kind: "activated",
      p_data: { subscription_id: gatewaySub },
    });
    expect(error?.code).toBe(PERMISSION_DENIED);
  });

  it("ends the plan when the gateway cancels it", async () => {
    expect((await gatewayEvent("cancelled", { subscription_id: gatewaySub })).data).toBe("applied");
    expect((await subscriptionOf(owner.id)).status).toBe("cancelled");
    expect((await addRoom(owner, hostelId, "503")).error?.hint).toBe("account_read_only");
  });
});

describe("plan changes", () => {
  it("upgrades now with proration and downgrades at renewal", async () => {
    const { owner } = await ownerWithHostel();
    await subscribe(owner, "starter", "month");

    const up = await owner.client.rpc("billing_quote_change", {
      p_plan_code: "growth",
      p_interval: "month",
    });
    expect(up.error).toBeNull();
    // Growth at the 20-bed minimum is 50,000 paise, less than Starter: a downgrade.
    expect(up.data).toMatchObject({ effect: "renewal", amount: 50000 });

    const pro = await owner.client.rpc("billing_quote_change", {
      p_plan_code: "pro",
      p_interval: "month",
    });
    expect(pro.data).toMatchObject({ effect: "now", amount: 999900 });
    expect((pro.data as { proration: number }).proration).toBeGreaterThan(0);

    const same = await owner.client.rpc("billing_quote_change", {
      p_plan_code: "starter",
      p_interval: "month",
    });
    expect(same.error?.hint).toBe("plan_unchanged");
  });

  it("applies a pending downgrade when the next period is charged", async () => {
    const { owner } = await ownerWithHostel();
    const { gatewaySub, end } = await subscribe(owner, "starter", "month");
    await admin.rpc("billing_apply_plan_change", {
      p_owner_id: owner.id,
      p_plan_id: await planId("growth"),
      p_interval: "month",
      p_effect: "renewal",
      p_gateway_plan_id: "plan_growth_test",
    });
    expect((await subscriptionOf(owner.id)).plans.code).toBe("starter");
    await gatewayEvent("charged", {
      subscription_id: gatewaySub,
      current_start: end.toISOString(),
      current_end: new Date(end.getTime() + 30 * 86_400_000).toISOString(),
      payment: { id: `pay_${randomUUID().slice(0, 14)}`, amount: 59000 },
    });
    const sub = await subscriptionOf(owner.id);
    expect(sub.plans.code).toBe("growth");
    expect(sub.pending_plan_id).toBeNull();
    expect(sub.amount).toBe(50000);
  });

  it("tells the app what the gateway should charge from the next cycle", async () => {
    const { owner } = await ownerWithHostel();
    const { gatewaySub } = await subscribe(owner, "growth", "month");
    const before = await admin.rpc("billing_renewal_target", {
      p_gateway_subscription_id: gatewaySub,
    });
    expect(before.data).toMatchObject({
      plan_code: "growth",
      amount: 20 * 2500,
      amount_with_gst: 59000,
      current_gateway_plan_id: "plan_test",
      gateway_plan_id: null,
    });
    // A growing hostel pays per bed from its next cycle, not this one.
    const hostel = (await admin.from("hostels").select("id").eq("owner_id", owner.id).single())
      .data!;
    await owner.client.rpc("create_rooms_bulk", {
      p_hostel_id: hostel.id,
      p_from: 101,
      p_to: 115,
      p_floor: 1,
      p_sharing_type: "double",
      p_capacity: 2,
    });
    const after = await admin.rpc("billing_renewal_target", {
      p_gateway_subscription_id: gatewaySub,
    });
    expect(after.data).toMatchObject({ amount: 30 * 2500 });
    expect((await subscriptionOf(owner.id)).amount).toBe(20 * 2500);
  });

  it("cancels at the end of the period, then the job ends the plan", async () => {
    const { owner, hostelId } = await ownerWithHostel();
    await subscribe(owner, "starter", "month");
    expect((await owner.client.rpc("billing_cancel_target")).error).toBeNull();
    await admin.rpc("billing_mark_cancel", { p_owner_id: owner.id, p_reason: "Closing the PG" });
    expect((await addRoom(owner, hostelId, "101")).error).toBeNull();

    await admin
      .from("subscriptions")
      .update({
        current_period_start: new Date(Date.now() - 31 * 86_400_000).toISOString(),
        current_period_end: new Date(Date.now() - 60_000).toISOString(),
      })
      .eq("owner_id", owner.id);
    expect((await addRoom(owner, hostelId, "102")).error?.hint).toBe("account_read_only");
    await sql`select private.billing_run()`;
    expect((await subscriptionOf(owner.id)).status).toBe("cancelled");
  });
});

describe("the billing job", () => {
  it("sends each trial reminder once and ends an expired trial as read-only", async () => {
    const { owner } = await ownerWithHostel();
    await admin
      .from("subscriptions")
      .update({ trial_ends_at: new Date(Date.now() + 2.5 * 86_400_000).toISOString() })
      .eq("owner_id", owner.id);
    await sql`select private.billing_run()`;
    await sql`select private.billing_run()`;
    const sub = await subscriptionOf(owner.id);
    const reminders = await sql`
      select subject from public.email_outbox where dedupe_key like ${`trial_reminder:${sub.id}:%`}`;
    expect(reminders.map((r) => r.subject)).toEqual(["Your Hostel ERP trial ends in 3 days"]);

    await admin
      .from("subscriptions")
      .update({ trial_ends_at: new Date(Date.now() - 1000).toISOString() })
      .eq("owner_id", owner.id);
    await sql`select private.billing_run()`;
    expect((await subscriptionOf(owner.id)).status).toBe("read_only");
    const { data: events } = await admin
      .from("subscription_events")
      .select("source, from_status, to_status")
      .eq("subscription_id", sub.id)
      .order("created_at");
    expect(events!.at(-1)).toEqual({
      source: "job",
      from_status: "trialing",
      to_status: "read_only",
    });
  });
});

describe("coupons", () => {
  it("accepts a valid coupon once per owner and refuses one the gateway cannot apply", async () => {
    const code = `LAUNCH${randomUUID().slice(0, 4).toUpperCase()}`;
    const offline = `OFF${randomUUID().slice(0, 4).toUpperCase()}`;
    for (const coupon of [
      {
        code,
        percent_off: 20,
        duration: "repeating",
        duration_cycles: 3,
        gateway_offer_id: "offer_test",
      },
      { code: offline, amount_off: 10000, duration: "once" },
    ]) {
      const { error } = await platformAdmin.client.rpc("admin_save_coupon", { p_coupon: coupon });
      expect(error).toBeNull();
    }

    const { owner } = await ownerWithHostel();
    const refused = await owner.client.rpc("billing_prepare_checkout", {
      p_plan_code: "starter",
      p_interval: "year",
      p_coupon_code: offline,
    });
    expect(refused.error?.hint).toBe("coupon_not_online");

    const { data: checkout, error } = await owner.client.rpc("billing_prepare_checkout", {
      p_plan_code: "starter",
      p_interval: "year",
      p_coupon_code: code.toLowerCase(),
    });
    expect(error).toBeNull();
    expect(checkout).toMatchObject({ offer_id: "offer_test", amount: 999000, coupon_code: code });

    const gatewaySub = `sub_${randomUUID().slice(0, 14)}`;
    await admin.rpc("billing_attach_checkout", {
      p_subscription_id: (checkout as { subscription_id: string }).subscription_id,
      p_gateway_subscription_id: gatewaySub,
      p_gateway_customer_id: "cust_test",
      p_gateway_plan_id: "plan_test",
    });
    await gatewayEvent("activated", { subscription_id: gatewaySub });
    const sub = await subscriptionOf(owner.id);
    expect(sub.coupon_cycles_left).toBe(3);
    expect(sub.billing_interval).toBe("year");

    const { count } = await admin
      .from("coupon_redemptions")
      .select("id", { count: "exact", head: true })
      .eq("owner_id", owner.id);
    expect(count).toBe(1);
  });
});

describe("admin adjustments (E10-T7)", () => {
  it("extends a trial that ran out, with a reason, and audits it", async () => {
    const { owner, hostelId } = await ownerWithHostel();
    await admin
      .from("subscriptions")
      .update({ trial_ends_at: new Date(Date.now() - 1000).toISOString() })
      .eq("owner_id", owner.id);
    await sql`select private.billing_run()`;

    const noReason = await platformAdmin.client.rpc("admin_billing_adjust", {
      p_account_id: owner.id,
      p_action: "extend_trial",
      p_reason: "",
      p_days: 7,
    });
    expect(noReason.error?.hint).toBe("reason_required");

    const { error } = await platformAdmin.client.rpc("admin_billing_adjust", {
      p_account_id: owner.id,
      p_action: "extend_trial",
      p_reason: "Owner was travelling during the trial",
      p_days: 7,
    });
    expect(error).toBeNull();
    const sub = await subscriptionOf(owner.id);
    expect(sub.status).toBe("trialing");
    expect((await addRoom(owner, hostelId, "101")).error).toBeNull();

    const { data: audit } = await admin
      .from("admin_audit_log")
      .select("action, reason, details")
      .eq("account_id", owner.id)
      .eq("action", "billing_adjustment");
    expect(audit).toEqual([
      {
        action: "billing_adjustment",
        reason: "Owner was travelling during the trial",
        details: expect.objectContaining({ action: "extend_trial", days: 7 }),
      },
    ]);
  });

  it("applies a complimentary plan without touching the gateway, and corrects a plan", async () => {
    const { owner } = await ownerWithHostel();
    const comp = await platformAdmin.client.rpc("admin_billing_adjust", {
      p_account_id: owner.id,
      p_action: "complimentary",
      p_reason: "Pilot customer for six months",
      p_plan_code: "growth",
      p_until: "2099-01-01",
    });
    expect(comp.error).toBeNull();
    let sub = await subscriptionOf(owner.id);
    expect(sub).toMatchObject({
      status: "active",
      complimentary: true,
      amount: 0,
      cancel_at_period_end: true,
      gateway_subscription_id: null,
    });

    const correct = await platformAdmin.client.rpc("admin_billing_adjust", {
      p_account_id: owner.id,
      p_action: "correct_plan",
      p_reason: "Wrong plan chosen at setup",
      p_plan_code: "pro",
    });
    expect(correct.error).toBeNull();
    sub = await subscriptionOf(owner.id);
    expect(sub.plans.code).toBe("pro");
    expect(sub.amount).toBe(0);

    const { data } = await platformAdmin.client.rpc("admin_account_billing", {
      p_account_ids: [owner.id],
    });
    expect((data as Record<string, { plan_code: string }>)[owner.id].plan_code).toBe("pro");
  });

  it("refuses adjustments and revenue figures to owners", async () => {
    const { owner } = await ownerWithHostel();
    const adjust = await owner.client.rpc("admin_billing_adjust", {
      p_account_id: owner.id,
      p_action: "extend_trial",
      p_reason: "Giving myself more time",
      p_days: 30,
    });
    expect(adjust.error?.code).toBe(PERMISSION_DENIED);
    const revenue = await owner.client.rpc("admin_revenue_metrics");
    expect(revenue.error?.code).toBe(PERMISSION_DENIED);
  });

  it("reports revenue figures to admins", async () => {
    const { data, error } = await platformAdmin.client.rpc("admin_revenue_metrics");
    expect(error).toBeNull();
    const metrics = data as {
      mrr: number;
      arr: number;
      paying: number;
      by_status: Record<string, number>;
    };
    expect(metrics.arr).toBe(metrics.mrr * 12);
    expect(metrics.paying).toBeGreaterThanOrEqual(1);
    expect(metrics.by_status).toHaveProperty("trialing");
  });
});

describe("terms acceptance", () => {
  it("records the same terms version the sign-up form shows", async () => {
    const { data } = await admin.from("billing_settings").select("terms_version").single();
    expect(data!.terms_version).toBe(TERMS_VERSION);
  });

  it("records the current terms version accepted at sign-up and ignores any other", async () => {
    const { data: settings } = await admin
      .from("billing_settings")
      .select("terms_version")
      .single();
    const accepted = await createUser({ metadata: { terms_version: settings!.terms_version } });
    const stale = await createUser({ metadata: { terms_version: "2001-01-01" } });
    const { data } = await admin
      .from("terms_acceptances")
      .select("user_id, terms_version")
      .in("user_id", [accepted.id, stale.id]);
    expect(data).toEqual([{ user_id: accepted.id, terms_version: settings!.terms_version }]);
  });
});
