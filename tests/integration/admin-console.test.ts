import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { todayIst } from "@/lib/validation";

import { residentRow } from "../support/residents";
import { createUserFactory, type TestUser } from "../support/supabase";

/**
 * Admin console hardening (ClickUp EP-10): audit log, reasons, owner
 * directory, support view, support actions and announcements.
 */
const PERMISSION_DENIED = "42501";

const { admin, createUser, createPlatformAdmin, createHostel, cleanup } = createUserFactory();

afterAll(cleanup);

let platformAdmin: TestUser;
let owner: TestUser;
let hostelId: string;
const tag = `zq${Date.now()}`;

beforeAll(async () => {
  platformAdmin = await createPlatformAdmin({ fullName: "Support Sam" });
  owner = await createUser({ fullName: `Owner ${tag}` });
  hostelId = (await createHostel(owner.id, { name: `Audit PG ${tag}`, city: "Warangal" })).id;
});

async function auditFor(id: string) {
  const { data, error } = await platformAdmin.client.rpc("admin_audit_entries", {
    p_hostel_id: id,
  });
  if (error) throw error;
  return data;
}

describe("audit log", () => {
  it("records plan changes and suspensions with the reason, and requires one", async () => {
    const noReason = await platformAdmin.client.rpc("admin_set_plan", {
      p_hostel_id: hostelId,
      p_plan: "paid",
      p_trial_ends_at: todayIst(),
      p_reason: " ",
    });
    expect(noReason.error?.hint).toBe("reason_required");

    await platformAdmin.client.rpc("admin_set_plan", {
      p_hostel_id: hostelId,
      p_plan: "paid",
      p_trial_ends_at: todayIst(),
      p_reason: "Paid by UPI for a year",
    });
    await platformAdmin.client.rpc("admin_set_suspended", {
      p_hostel_id: hostelId,
      p_suspend: true,
      p_reason: "Chargeback",
    });
    const restoreNoReason = await platformAdmin.client.rpc("admin_set_suspended", {
      p_hostel_id: hostelId,
      p_suspend: false,
      p_reason: "",
    });
    expect(restoreNoReason.error?.hint).toBe("reason_required");
    await platformAdmin.client.rpc("admin_set_suspended", {
      p_hostel_id: hostelId,
      p_suspend: false,
      p_reason: "Resolved with the bank",
    });

    const entries = await auditFor(hostelId);
    expect(entries.map((entry) => [entry.action, entry.reason])).toEqual([
      ["hostel_restored", "Resolved with the bank"],
      ["hostel_suspended", "Chargeback"],
      ["plan_changed", "Paid by UPI for a year"],
    ]);
    expect(entries[2]).toMatchObject({
      actor_email: platformAdmin.email,
      hostel_name: `Audit PG ${tag}`,
      details: expect.objectContaining({ from: "trial", to: "paid" }),
      total: 3,
    });
  });
});

describe("owner directory", () => {
  it("searches owners by name, e-mail, hostel or city, a page at a time", async () => {
    for (const search of [tag, owner.email, `audit pg ${tag}`]) {
      const { data, error } = await platformAdmin.client.rpc("admin_owners", { p_search: search });
      expect(error).toBeNull();
      expect(data?.map((row) => row.id)).toEqual([owner.id]);
      expect(data?.[0]).toMatchObject({ hostels: 1, active_hostels: 1, total: 1 });
    }
    const page = await platformAdmin.client.rpc("admin_owners", { p_limit: 1 });
    expect(page.data).toHaveLength(1);
    expect(Number(page.data?.[0].total)).toBeGreaterThanOrEqual(1);
    // A search pattern is matched literally.
    const wild = await platformAdmin.client.rpc("admin_owners", { p_search: "%" });
    expect(wild.data ?? []).toEqual([]);
  });
});

describe("support view", () => {
  it("opens with a reason, shows masked details, and tells the owner", async () => {
    const id = (await createHostel(owner.id)).id;
    await admin.from("rooms").insert({
      hostel_id: id,
      room_number: "7",
      floor: 1,
      sharing_type: "single",
      capacity: 1,
    });
    await admin
      .from("residents")
      .insert(
        residentRow(id, { full_name: "Masked Mary", phone: "9876501234", id_proof_last4: "4321" }),
      );

    const closed = await platformAdmin.client.rpc("admin_support_snapshot", { p_hostel_id: id });
    expect(closed.error?.hint).toBe("support_view_closed");
    const noReason = await platformAdmin.client.rpc("admin_open_support_view", {
      p_hostel_id: id,
      p_reason: "",
    });
    expect(noReason.error?.hint).toBe("reason_required");

    const opened = await platformAdmin.client.rpc("admin_open_support_view", {
      p_hostel_id: id,
      p_reason: "Owner says invoices are missing",
    });
    expect(opened.error).toBeNull();
    const { data } = await platformAdmin.client.rpc("admin_support_snapshot", { p_hostel_id: id });
    const snapshot = data as {
      rooms: { room_number: string; beds: unknown[] }[];
      residents: { full_name: string; phone: string; id_proof: string }[];
    };
    expect(snapshot.rooms).toEqual([expect.objectContaining({ room_number: "7" })]);
    expect(snapshot.residents).toEqual([
      expect.objectContaining({ full_name: "Masked Mary", phone: "••••••1234", id_proof: "4321" }),
    ]);
    expect(JSON.stringify(data)).not.toContain("9876501234");

    // Still no direct access to the tenant tables, for reading or writing.
    expect(
      (await platformAdmin.client.from("residents").select("id").eq("hostel_id", id)).data,
    ).toEqual([]);
    const write = await platformAdmin.client
      .from("rooms")
      .insert({ hostel_id: id, room_number: "8", floor: 1, sharing_type: "single", capacity: 1 });
    expect(write.error).not.toBeNull();

    const { data: notices } = await owner.client
      .from("support_access")
      .select("admin_name, reason")
      .eq("hostel_id", id);
    expect(notices).toEqual([
      { admin_name: "Support Sam", reason: "Owner says invoices are missing" },
    ]);
    const stranger = await createUser();
    expect((await stranger.client.from("support_access").select("id")).data).toEqual([]);
  });
});

describe("support actions", () => {
  it("signs an owner out of every device", async () => {
    const target = await createUser();
    const { data: before } = await target.client.auth.getSession();
    expect(before.session).not.toBeNull();

    const { error } = await platformAdmin.client.rpc("admin_sign_out_everywhere", {
      p_user_id: target.id,
      p_reason: "Lost their phone",
    });
    expect(error).toBeNull();
    const refreshed = await target.client.auth.refreshSession();
    expect(refreshed.error).not.toBeNull();

    const self = await platformAdmin.client.rpc("admin_sign_out_everywhere", {
      p_user_id: platformAdmin.id,
      p_reason: "x",
    });
    expect(self.error?.hint).toBe("account_not_found");
  });

  it("records e-mail actions, and only the known ones", async () => {
    const ok = await platformAdmin.client.rpc("admin_record_email_action", {
      p_action: "password_reset_sent",
      p_user_id: owner.id,
      p_reason: "Forgot password",
    });
    expect(ok.error).toBeNull();
    const bad = await platformAdmin.client.rpc("admin_record_email_action", {
      p_action: "plan_changed",
      p_user_id: owner.id,
      p_reason: "x",
    });
    expect(bad.error?.hint).toBe("action_invalid");
  });
});

describe("announcements", () => {
  it("show to signed-in users while live, can be dismissed, and end", async () => {
    const created = await platformAdmin.client.rpc("admin_create_announcement", {
      p_message: `Maintenance tonight ${tag}`,
      p_severity: "warning",
    });
    expect(created.error).toBeNull();
    const id = created.data!;

    const seen = await owner.client.from("announcements").select("id, message").eq("id", id);
    expect(seen.data).toEqual([{ id, message: `Maintenance tonight ${tag}` }]);

    const dismissed = await owner.client
      .from("announcement_dismissals")
      .insert({ user_id: owner.id, announcement_id: id });
    expect(dismissed.error).toBeNull();
    const forSomeoneElse = await owner.client
      .from("announcement_dismissals")
      .insert({ user_id: platformAdmin.id, announcement_id: id });
    expect(forSomeoneElse.error?.code).toBe(PERMISSION_DENIED);

    expect((await owner.client.from("announcements").insert({ message: "x" })).error?.code).toBe(
      PERMISSION_DENIED,
    );

    expect(
      (await platformAdmin.client.rpc("admin_end_announcement", { p_id: id })).error,
    ).toBeNull();
    expect((await owner.client.from("announcements").select("id").eq("id", id)).data).toEqual([]);
    const list = await platformAdmin.client.rpc("admin_announcements");
    expect(list.data?.find((row) => row.id === id)).toMatchObject({ dismissals: 1 });
  });
});
