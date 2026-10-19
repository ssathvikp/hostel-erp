import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { todayIst } from "@/lib/validation";

import { anonClient, createUserFactory, type Client, type TestUser } from "../support/supabase";

/**
 * ClickUp E10-T12: tenants can never reach admin functions. Every admin
 * function is called as an owner, a staff member, a signed-out visitor and
 * an admin who has not completed the second factor; all are refused.
 */
const PERMISSION_DENIED = "42501";

const { admin, createUser, createPlatformAdmin, createHostel, cleanup } = createUserFactory();

afterAll(cleanup);

let owner: TestUser;
let staff: TestUser;
let passwordOnlyAdmin: TestUser;
let hostelId: string;

beforeAll(async () => {
  owner = await createUser();
  hostelId = (await createHostel(owner.id)).id;
  staff = await createUser({ profile: { role: "staff", hostel_id: hostelId } });
  passwordOnlyAdmin = await createUser({ profile: { role: "platform_admin" } });
});

/** Every admin function, with arguments that would succeed for a real admin. */
function calls(client: Client) {
  const id = hostelId;
  const today = todayIst();
  return {
    admin_hostels: () => client.rpc("admin_hostels"),
    admin_metrics: () => client.rpc("admin_metrics"),
    admin_owners: () => client.rpc("admin_owners", {}),
    admin_list_admins: () => client.rpc("admin_list_admins"),
    admin_audit_entries: () => client.rpc("admin_audit_entries", {}),
    admin_announcements: () => client.rpc("admin_announcements"),
    admin_set_plan: () =>
      client.rpc("admin_set_plan", {
        p_hostel_id: id,
        p_plan: "free",
        p_trial_ends_at: today,
        p_reason: "x",
      }),
    admin_set_suspended: () =>
      client.rpc("admin_set_suspended", { p_hostel_id: id, p_suspend: true, p_reason: "x" }),
    admin_set_trial_days: () => client.rpc("admin_set_trial_days", { p_days: 14 }),
    admin_open_support_view: () =>
      client.rpc("admin_open_support_view", { p_hostel_id: id, p_reason: "x" }),
    admin_support_snapshot: () => client.rpc("admin_support_snapshot", { p_hostel_id: id }),
    admin_sign_out_everywhere: () =>
      client.rpc("admin_sign_out_everywhere", { p_user_id: owner.id, p_reason: "x" }),
    admin_record_email_action: () =>
      client.rpc("admin_record_email_action", {
        p_action: "password_reset_sent",
        p_user_id: owner.id,
        p_reason: "x",
      }),
    admin_create_announcement: () =>
      client.rpc("admin_create_announcement", {
        p_message: "x",
        p_severity: "info",
        p_starts_at: new Date().toISOString(),
        p_ends_at: undefined,
      }),
    admin_end_announcement: () =>
      client.rpc("admin_end_announcement", { p_id: "00000000-0000-0000-0000-000000000000" }),
  };
}

describe("every admin function", () => {
  it.each([
    ["an owner", () => owner.client, "not_platform_admin"],
    ["a staff member", () => staff.client, "not_platform_admin"],
    ["an admin without the second factor", () => passwordOnlyAdmin.client, "mfa_required"],
  ])("refuses %s", async (_who, client, hint) => {
    for (const [name, call] of Object.entries(calls(client()))) {
      const { error } = await call();
      expect({ name, code: error?.code, hint: error?.hint }).toEqual({
        name,
        code: PERMISSION_DENIED,
        hint,
      });
    }
  });

  it("refuses a signed-out visitor", async () => {
    for (const [name, call] of Object.entries(calls(anonClient()))) {
      const { error } = await call();
      expect({ name, refused: error !== null }).toEqual({ name, refused: true });
    }
  });

  it("changed nothing while refusing", async () => {
    const { data } = await admin.from("hostels").select("plan, status").eq("id", hostelId).single();
    expect(data).toEqual({ plan: "trial", status: "active" });
    const { count } = await admin
      .from("admin_audit_log")
      .select("id", { count: "exact", head: true })
      .or(`hostel_id.eq.${hostelId},target_user_id.eq.${owner.id}`);
    expect(count).toBe(0);
  });
});

describe("the admin tables", () => {
  it("are closed to every signed-in user, admins included", async () => {
    const fullAdmin = await createPlatformAdmin();
    for (const client of [owner.client, staff.client, fullAdmin.client]) {
      for (const table of ["admin_audit_log", "plan_events", "platform_settings"] as const) {
        const { data } = await client.from(table).select("*");
        expect(data ?? []).toEqual([]);
      }
      const write = await client.from("admin_audit_log").insert({
        actor_id: owner.id,
        actor_email: "x",
        action: "plan_changed",
        reason: "x",
      });
      expect(write.error?.code).toBe(PERMISSION_DENIED);
    }
  });

  it("keep audit entries even against the service role", async () => {
    const fullAdmin = await createPlatformAdmin();
    await fullAdmin.client.rpc("admin_set_trial_days", { p_days: 30 });
    const { data: entry } = await admin
      .from("admin_audit_log")
      .select("id")
      .eq("actor_id", fullAdmin.id)
      .limit(1)
      .single();
    const update = await admin.from("admin_audit_log").update({ reason: "y" }).eq("id", entry!.id);
    expect(update.error?.hint).toBe("audit_immutable");
    const remove = await admin.from("admin_audit_log").delete().eq("id", entry!.id);
    expect(remove.error?.hint).toBe("audit_immutable");
  });
});
