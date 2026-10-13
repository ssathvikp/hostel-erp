import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createUserFactory, anonClient, type Client, type TestUser } from "../support/supabase";
import { enrolTotp } from "../support/totp";

/**
 * The platform admin boundary (E10-T12): owners, staff, signed-out visitors
 * and an admin without MFA are refused every admin function; an admin at
 * aal2 gets through, every look is audited, and the support view cannot
 * write customer data.
 */
const PERMISSION_DENIED = "42501";
const RAISED = "P0001";

const { admin, createUser, createHostel, cleanup } = createUserFactory();

afterAll(cleanup);

let owner: TestUser;
let staff: TestUser;
let adminNoMfa: TestUser;
let platformAdmin: TestUser;
let hostelId: string;

async function makeAdmin(): Promise<TestUser> {
  const user = await createUser({ profile: { role: "platform_admin" } });
  return user;
}

beforeAll(async () => {
  owner = await createUser({ fullName: "Asha Owner" });
  hostelId = (await createHostel(owner.id, { name: "Admin Test PG" })).id;
  staff = await createUser({ profile: { role: "staff", hostel_id: hostelId } });
  adminNoMfa = await makeAdmin();
  platformAdmin = await makeAdmin();
  await enrolTotp(platformAdmin.client);
});

/** Every admin function, called with harmless arguments. */
function calls(client: Client) {
  return {
    admin_customers: () => client.rpc("admin_customers", {}),
    admin_hostels: () => client.rpc("admin_hostels", {}),
    admin_account: () => client.rpc("admin_account", { p_account_id: owner.id }),
    admin_view_hostel: () =>
      client.rpc("admin_view_hostel", { p_hostel_id: hostelId, p_reason: "Checking a ticket" }),
    admin_set_hostel_status: () =>
      client.rpc("admin_set_hostel_status", {
        p_hostel_id: hostelId,
        p_status: "suspended",
        p_reason: "Should be refused",
      }),
    admin_platform_metrics: () => client.rpc("admin_platform_metrics"),
    admin_support_action: () =>
      client.rpc("admin_support_action", {
        p_account_id: owner.id,
        p_action: "password_reset",
        p_reason: "Should be refused",
      }),
    admin_audit_search: () => client.rpc("admin_audit_search", {}),
    admin_create_announcement: () =>
      client.rpc("admin_create_announcement", {
        p_message: "Refused",
        p_severity: "info",
        p_starts_at: new Date().toISOString(),
        p_ends_at: new Date(Date.now() + 3_600_000).toISOString(),
      }),
    admin_data_requests: () => client.rpc("admin_data_requests", {}),
    admin_complete_closure: () =>
      client.rpc("admin_complete_closure", {
        p_request_id: "00000000-0000-0000-0000-000000000000",
        p_reason: "Should be refused",
      }),
    admin_end_announcement: () =>
      client.rpc("admin_end_announcement", {
        p_announcement_id: "00000000-0000-0000-0000-000000000000",
      }),
  };
}

describe("admin functions refuse everyone but an admin with MFA", () => {
  for (const who of ["owner", "staff", "admin without MFA", "signed-out visitor"] as const) {
    it(`refuses a ${who}`, async () => {
      const client =
        who === "owner"
          ? owner.client
          : who === "staff"
            ? staff.client
            : who === "admin without MFA"
              ? adminNoMfa.client
              : anonClient();
      for (const [name, call] of Object.entries(calls(client))) {
        const { error } = await call();
        expect(error?.code, name).toBe(PERMISSION_DENIED);
      }
      const { data: status } = await admin
        .from("hostels")
        .select("status")
        .eq("id", hostelId)
        .single();
      expect(status!.status).toBe("active");
    });
  }

  it("lets an admin at aal2 read the directory and metrics", async () => {
    const customers = await platformAdmin.client.rpc("admin_customers", { p_search: "Asha" });
    expect(customers.error).toBeNull();
    expect(customers.data).toMatchObject({ total: 1 });
    const hostels = await platformAdmin.client.rpc("admin_hostels", { p_search: "Admin Test" });
    expect((hostels.data as { rows: { id: string }[] }).rows.map((r) => r.id)).toContain(hostelId);
    const metrics = await platformAdmin.client.rpc("admin_platform_metrics");
    expect(metrics.error).toBeNull();
    expect(metrics.data).toHaveProperty("occupied_beds");
  });

  it("stops working the moment the role is removed", async () => {
    const extra = await makeAdmin();
    await enrolTotp(extra.client);
    expect((await extra.client.rpc("admin_platform_metrics")).error).toBeNull();
    await admin.from("profiles").update({ role: "owner" }).eq("id", extra.id);
    expect((await extra.client.rpc("admin_platform_metrics")).error?.code).toBe(PERMISSION_DENIED);
  });
});

describe("the admin role cannot be granted from the app", () => {
  it("is refused to a user changing their own profile", async () => {
    const { error } = await owner.client
      .from("profiles")
      .update({ role: "platform_admin" })
      .eq("id", owner.id);
    expect(error?.code).toBe(PERMISSION_DENIED);
  });

  it("is ignored in sign-up metadata", async () => {
    const user = await createUser({ metadata: { role: "platform_admin" } });
    const { data } = await admin.from("profiles").select("role").eq("id", user.id).single();
    expect(data!.role).toBe("owner");
  });
});

describe("support view (E10-T5)", () => {
  it("needs a reason, is logged, and is shown to the owner without the admin's name", async () => {
    const missing = await platformAdmin.client.rpc("admin_view_hostel", {
      p_hostel_id: hostelId,
      p_reason: "",
    });
    expect(missing.error?.hint).toBe("reason_required");

    const view = await platformAdmin.client.rpc("admin_view_hostel", {
      p_hostel_id: hostelId,
      p_reason: "Owner asked why a bed shows as blocked",
    });
    expect(view.error).toBeNull();
    expect(view.data).toMatchObject({ hostel: { id: hostelId, name: "Admin Test PG" } });

    const seen = await owner.client
      .from("admin_audit_log")
      .select("action, reason, created_at")
      .eq("hostel_id", hostelId);
    expect(seen.data).toContainEqual(
      expect.objectContaining({
        action: "view_hostel",
        reason: "Owner asked why a bed shows as blocked",
      }),
    );
    expect((await owner.client.from("admin_audit_log").select("actor_email")).error?.code).toBe(
      PERMISSION_DENIED,
    );
    // Staff and other owners see nothing.
    expect((await staff.client.from("admin_audit_log").select("id")).data ?? []).toEqual([]);
  });

  it("cannot write customer data, even at aal2", async () => {
    const insert = await platformAdmin.client.from("rooms").insert({
      hostel_id: hostelId,
      room_number: "X1",
      floor: 1,
      sharing_type: "single",
      capacity: 1,
    });
    expect(insert.error).not.toBeNull();
    const update = await platformAdmin.client
      .from("hostels")
      .update({ name: "Taken over" })
      .eq("id", hostelId)
      .select("id");
    expect(update.data ?? []).toEqual([]);
    const read = await platformAdmin.client
      .from("residents")
      .select("id")
      .eq("hostel_id", hostelId);
    expect(read.data ?? []).toEqual([]);
  });

  it("keeps the audit log immutable", async () => {
    const { error } = await admin.from("admin_audit_log").delete().eq("hostel_id", hostelId);
    expect(error?.hint).toBe("history_immutable");
  });
});

describe("suspension (E10-T6)", () => {
  it("suspends with a reason, blocks new money, queues the email, and restores", async () => {
    const suspendHostel = (await createHostel(owner.id, { name: "Suspend Me PG" })).id;
    const noReason = await platformAdmin.client.rpc("admin_set_hostel_status", {
      p_hostel_id: suspendHostel,
      p_status: "suspended",
      p_reason: "",
    });
    expect(noReason.error?.hint).toBe("reason_required");

    const suspended = await platformAdmin.client.rpc("admin_set_hostel_status", {
      p_hostel_id: suspendHostel,
      p_status: "suspended",
      p_reason: "Unpaid for three months",
    });
    expect(suspended.error).toBeNull();
    const { data: row } = await admin
      .from("hostels")
      .select("status")
      .eq("id", suspendHostel)
      .single();
    expect(row!.status).toBe("suspended");

    // The trigger refuses before any other check runs.
    const invoice = await admin.from("invoices").insert({
      hostel_id: suspendHostel,
      resident_id: "00000000-0000-0000-0000-000000000000",
      period_month: "2026-10-01",
      amount: 100,
      due_date: "2026-10-05",
    });
    expect(invoice.error?.hint).toBe("hostel_suspended");

    const outbox = await platformAdmin.client
      .from("email_outbox")
      .select("kind, subject")
      .eq("kind", "hostel_suspended");
    expect(outbox.data).toContainEqual(
      expect.objectContaining({ subject: "Suspend Me PG has been suspended on Hostel ERP" }),
    );
    expect((await owner.client.from("email_outbox").select("id")).data ?? []).toEqual([]);

    const twice = await platformAdmin.client.rpc("admin_set_hostel_status", {
      p_hostel_id: suspendHostel,
      p_status: "suspended",
      p_reason: "Again, by mistake",
    });
    expect(twice.error?.code).toBe(RAISED);

    const restored = await platformAdmin.client.rpc("admin_set_hostel_status", {
      p_hostel_id: suspendHostel,
      p_status: "active",
      p_reason: "Paid in full",
    });
    expect(restored.error).toBeNull();

    const log = await platformAdmin.client.rpc("admin_audit_search", {
      p_hostel_id: suspendHostel,
    });
    const actions = (
      log.data as { rows: { action: string; request_id: string | null }[] }
    ).rows.map((r) => r.action);
    expect(actions).toEqual(["restore_hostel", "suspend_hostel"]);
  });
});

describe("support actions (E10-T9)", () => {
  it("records each action with a reason and signs an owner out everywhere", async () => {
    const target = await createUser();
    const before = await admin.auth.admin.getUserById(target.id);
    expect(before.data.user).not.toBeNull();

    const email = await platformAdmin.client.rpc("admin_support_action", {
      p_account_id: target.id,
      p_action: "sign_out_everywhere",
      p_reason: "Owner lost their phone",
    });
    expect(email.data).toBe(target.email);
    // The refresh token is gone, so the session cannot be renewed.
    const { error } = await target.client.auth.refreshSession();
    expect(error).not.toBeNull();

    const confirmed = await platformAdmin.client.rpc("admin_support_action", {
      p_account_id: target.id,
      p_action: "resend_confirmation",
      p_reason: "Says the email never came",
    });
    expect(confirmed.error?.hint).toBe("already_confirmed");
  });
});

describe("announcements (E10-T11)", () => {
  it("are shown while current and dismissed per user", async () => {
    const { data: id, error } = await platformAdmin.client.rpc("admin_create_announcement", {
      p_message: "Maintenance tonight from 11 pm",
      p_severity: "warning",
      p_starts_at: new Date(Date.now() - 1000).toISOString(),
      p_ends_at: new Date(Date.now() + 3_600_000).toISOString(),
    });
    expect(error).toBeNull();
    const seen = await owner.client.from("announcements").select("id, message").eq("id", id!);
    expect(seen.data).toHaveLength(1);
    expect(
      (await owner.client.from("announcement_dismissals").insert({ announcement_id: id! })).error,
    ).toBeNull();
    const mine = await owner.client.from("announcement_dismissals").select("announcement_id");
    expect(mine.data).toHaveLength(1);
    expect(
      (await staff.client.from("announcement_dismissals").select("announcement_id")).data,
    ).toEqual([]);
    expect(
      (
        await owner.client
          .from("announcements")
          .insert({ message: "x", ends_at: new Date().toISOString() })
      ).error?.code,
    ).toBe(PERMISSION_DENIED);

    await platformAdmin.client.rpc("admin_end_announcement", { p_announcement_id: id! });
    expect((await owner.client.from("announcements").select("id").eq("id", id!)).data).toEqual([]);
  });
});
