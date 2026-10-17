import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { todayIst } from "@/lib/validation";

import { createUserFactory, type TestUser } from "../support/supabase";

/**
 * Platform admin, plans and suspension (EP-10). Admin functions refuse
 * everyone else; owners read but never change their plan; a suspended
 * hostel has no members until it is restored.
 */
const PERMISSION_DENIED = "42501";

const { admin, createUser, createHostel, cleanup } = createUserFactory();

afterAll(cleanup);

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
  platformAdmin = await createUser({ profile: { role: "platform_admin" } });
  owner = await createUser();
  hostelId = (await createHostel(owner.id, { name: "Admin Test PG" })).id;
  staff = await createUser({ profile: { role: "staff", hostel_id: hostelId } });
  await admin.from("rooms").insert({
    hostel_id: hostelId,
    room_number: "1",
    floor: 1,
    sharing_type: "double",
    capacity: 2,
  });
});

describe("plans and trials", () => {
  it("start every new hostel on a 90-day trial", async () => {
    const { data } = await owner.client
      .from("hostels")
      .select("plan, trial_ends_at")
      .eq("id", hostelId)
      .single();
    expect(data).toEqual({ plan: "trial", trial_ends_at: addDays(todayIst(), 90) });
  });

  it("cannot be changed by owners", async () => {
    for (const change of [
      { plan: "paid" },
      { trial_ends_at: "2099-01-01" },
      { suspension_reason: "x" },
    ]) {
      const { error } = await owner.client.from("hostels").update(change).eq("id", hostelId);
      expect(error?.code).toBe(PERMISSION_DENIED);
    }
  });
});

describe("admin functions", () => {
  it("refuse owners and staff", async () => {
    for (const user of [owner, staff]) {
      const list = await user.client.rpc("admin_hostels");
      expect(list.error?.code).toBe(PERMISSION_DENIED);
      const plan = await user.client.rpc("admin_set_plan", {
        p_hostel_id: hostelId,
        p_plan: "free",
        p_trial_ends_at: todayIst(),
      });
      expect(plan.error?.code).toBe(PERMISSION_DENIED);
      const suspend = await user.client.rpc("admin_set_suspended", {
        p_hostel_id: hostelId,
        p_suspend: true,
        p_reason: "x",
      });
      expect(suspend.error?.code).toBe(PERMISSION_DENIED);
    }
  });

  it("list every hostel with its owner and usage, but no resident rows", async () => {
    const { data, error } = await platformAdmin.client.rpc("admin_hostels");
    expect(error).toBeNull();
    const row = data?.find((hostel) => hostel.id === hostelId);
    expect(row).toMatchObject({
      name: "Admin Test PG",
      owner_email: owner.email,
      plan: "trial",
      status: "active",
      staff: 1,
      rooms: 1,
      beds: 2,
      occupied_beds: 0,
    });
    // Admins are members of no hostel: tenant tables stay closed.
    const rooms = await platformAdmin.client.from("rooms").select("id");
    expect(rooms.data).toEqual([]);
    const residents = await platformAdmin.client.from("residents").select("id");
    expect(residents.data).toEqual([]);
  });

  it("set a plan, and require an end date for a trial", async () => {
    const missing = await platformAdmin.client.rpc("admin_set_plan", {
      p_hostel_id: hostelId,
      p_plan: "bogus",
      p_trial_ends_at: todayIst(),
    });
    expect(missing.error?.hint).toBe("plan_invalid");

    const extended = addDays(todayIst(), 120);
    expect(
      (
        await platformAdmin.client.rpc("admin_set_plan", {
          p_hostel_id: hostelId,
          p_plan: "trial",
          p_trial_ends_at: extended,
        })
      ).error,
    ).toBeNull();
    expect(
      (
        await platformAdmin.client.rpc("admin_set_plan", {
          p_hostel_id: hostelId,
          p_plan: "paid",
          p_trial_ends_at: todayIst(),
        })
      ).error,
    ).toBeNull();
    const { data } = await owner.client
      .from("hostels")
      .select("plan, trial_ends_at")
      .eq("id", hostelId)
      .single();
    // The trial end is kept for the record when a hostel starts paying.
    expect(data).toEqual({ plan: "paid", trial_ends_at: extended });
  });

  it("refuse to suspend a hostel still being set up, or without a reason", async () => {
    const draft = await createHostel(owner.id, { status: "draft" });
    const result = await platformAdmin.client.rpc("admin_set_suspended", {
      p_hostel_id: draft.id,
      p_suspend: true,
      p_reason: "Unpaid",
    });
    expect(result.error?.hint).toBe("hostel_draft");

    const noReason = await platformAdmin.client.rpc("admin_set_suspended", {
      p_hostel_id: hostelId,
      p_suspend: true,
      p_reason: "  ",
    });
    expect(noReason.error?.hint).toBe("suspension_reason_required");
  });
});

describe("suspension", () => {
  it("closes the hostel to its owner and staff, and restoring reopens it", async () => {
    expect((await staff.client.from("rooms").select("id")).data).toHaveLength(1);

    const suspend = await platformAdmin.client.rpc("admin_set_suspended", {
      p_hostel_id: hostelId,
      p_suspend: true,
      p_reason: "Payment overdue since August",
    });
    expect(suspend.error).toBeNull();

    // The owner still sees the hostel and why; nothing inside it.
    const { data: hostel } = await owner.client
      .from("hostels")
      .select("status, suspension_reason")
      .eq("id", hostelId)
      .single();
    expect(hostel).toEqual({
      status: "suspended",
      suspension_reason: "Payment overdue since August",
    });
    expect((await owner.client.from("rooms").select("id")).data).toEqual([]);
    expect((await staff.client.from("rooms").select("id")).data).toEqual([]);
    expect((await staff.client.from("hostels").select("id")).data).toEqual([]);
    const write = await owner.client.from("rooms").insert({
      hostel_id: hostelId,
      room_number: "2",
      floor: 1,
      sharing_type: "single",
      capacity: 1,
    });
    expect(write.error?.code).toBe(PERMISSION_DENIED);
    // And the owner cannot lift it themselves.
    const lift = await owner.client.from("hostels").update({ status: "active" }).eq("id", hostelId);
    expect(lift.error?.hint).toBe("hostel_status_transition");

    const restore = await platformAdmin.client.rpc("admin_set_suspended", {
      p_hostel_id: hostelId,
      p_suspend: false,
      p_reason: "",
    });
    expect(restore.error).toBeNull();
    expect((await staff.client.from("rooms").select("id")).data).toHaveLength(1);
    const { data: restored } = await owner.client
      .from("hostels")
      .select("status, suspension_reason")
      .eq("id", hostelId)
      .single();
    expect(restored).toEqual({ status: "active", suspension_reason: null });
  });
});
