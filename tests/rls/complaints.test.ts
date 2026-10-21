import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { shiftMonth } from "@/lib/money";
import { todayIst } from "@/lib/validation";

import { residentRow } from "../support/residents";
import { anonClient, createUserFactory, type TestUser } from "../support/supabase";

/**
 * Complaints and maintenance (ClickUp EP-15), with the access rules of
 * T14: members see only their hostel's complaints, workers and files, and a
 * job link reaches only its one job, and only while that worker holds it.
 */
const PERMISSION_DENIED = "42501";

const { admin, createUser, createHostel, cleanup } = createUserFactory();
const anon = anonClient();

afterAll(cleanup);

let owner: TestUser;
let staff: TestUser;
let other: TestUser;
let hostelId: string;
let otherHostelId: string;
let roomId: string;
let residentId: string;
const categories: Record<string, string> = {};
const workers: Record<string, string> = {};

beforeAll(async () => {
  [owner, other] = await Promise.all([createUser(), createUser()]);
  hostelId = (await createHostel(owner.id)).id;
  otherHostelId = (await createHostel(other.id)).id;
  staff = await createUser({ profile: { role: "staff", hostel_id: hostelId } });
  const { data: room } = await admin
    .from("rooms")
    .insert({
      hostel_id: hostelId,
      room_number: "101",
      floor: 1,
      sharing_type: "single",
      capacity: 1,
    })
    .select("id")
    .single();
  roomId = room!.id;
  const { data: resident } = await admin
    .from("residents")
    .insert(residentRow(hostelId, { full_name: "Complaining Kiran" }))
    .select("id")
    .single();
  residentId = resident!.id;
  const { data: cats } = await owner.client
    .from("complaint_categories")
    .select("id, name")
    .eq("hostel_id", hostelId);
  for (const cat of cats ?? []) categories[cat.name] = cat.id;

  const add = async (key: string, row: Record<string, unknown>) => {
    const { data, error } = await owner.client
      .from("workers")
      .insert({ phone: "9876500000", ...row } as never)
      .select("id")
      .single();
    if (error) throw error;
    workers[key] = data.id;
  };
  await add("electrician", {
    hostel_id: hostelId,
    kind: "on_site",
    full_name: "Eshwar Electric",
    trades: ["electrician"],
  });
  await add("plumberPreferred", {
    kind: "vendor",
    full_name: "Prakash Plumbing",
    trades: ["plumber"],
    preferred: true,
  });
  await add("plumber", { kind: "vendor", full_name: "Anil Pipes", trades: ["plumber"] });
  await add("carpenterA", { kind: "vendor", full_name: "Carpenter A", trades: ["carpenter"] });
  await add("carpenterB", { kind: "vendor", full_name: "Carpenter B", trades: ["carpenter"] });
});

async function raise(category: string, extra: Record<string, unknown> = {}, as = staff) {
  const { data, error } = await as.client
    .from("complaints")
    .insert({
      hostel_id: hostelId,
      room_id: roomId,
      category_id: categories[category],
      title: `${category} problem`,
      ...extra,
    })
    .select("id")
    .single();
  if (error) throw error;
  return data.id;
}

async function complaint(id: string) {
  const { data } = await owner.client.from("complaints").select("*").eq("id", id).single();
  return data!;
}

describe("records and routing", () => {
  it("are seeded with the default categories, each mapped to a trade", () => {
    expect(Object.keys(categories)).toHaveLength(9);
  });

  it("route to an on-site worker first and log every step", async () => {
    const id = await raise("Electrical");
    const row = await complaint(id);
    expect(row).toMatchObject({
      status: "assigned",
      worker_id: workers.electrician,
      raised_by: staff.id,
      raised_by_kind: "staff",
    });
    expect(row.number).toBeGreaterThan(0);
    const { data: events } = await staff.client
      .from("complaint_events")
      .select("kind")
      .eq("complaint_id", id)
      .order("created_at");
    expect(events?.map((event) => event.kind)).toEqual(["created", "assigned"]);
  });

  it("prefer the hostel's preferred vendor, then share jobs out by load", async () => {
    expect((await complaint(await raise("Plumbing"))).worker_id).toBe(workers.plumberPreferred);
    const first = (await complaint(await raise("Carpentry"))).worker_id;
    const second = (await complaint(await raise("Carpentry"))).worker_id;
    expect(new Set([first, second])).toEqual(new Set([workers.carpenterA, workers.carpenterB]));
  });

  it("skip workers on leave, and flag a complaint nobody can take", async () => {
    await owner.client.from("worker_unavailability").insert({
      worker_id: workers.electrician,
      from_date: todayIst(),
      to_date: todayIst(),
      reason: "Leave",
    });
    const id = await raise("Electrical");
    expect(await complaint(id)).toMatchObject({
      status: "open",
      worker_id: null,
      needs_worker: true,
    });
    await admin.from("worker_unavailability").delete().eq("worker_id", workers.electrician);
    expect((await complaint(await raise("Pest control"))).needs_worker).toBe(true);
  });

  it("can be raised on behalf of a resident for a common area", async () => {
    const id = await raise("Cleaning", { room_id: null, area: "Kitchen", resident_id: residentId });
    expect(await complaint(id)).toMatchObject({ area: "Kitchen", resident_id: residentId });
    const missing = await staff.client.from("complaints").insert({
      hostel_id: hostelId,
      category_id: categories.Other,
      title: "Nowhere",
    });
    expect(missing.error?.code).toBe("23514");
  });
});

describe("the lifecycle", () => {
  it("allows only the defined moves, with reasons for hold and reopen", async () => {
    const id = await raise("Security");
    const move = (status: string, note?: string) =>
      staff.client.rpc("complaint_set_status", {
        p_complaint_id: id,
        p_status: status,
        p_note: note,
      });

    expect((await move("on_hold")).error?.hint).toBe("hold_reason");
    expect((await move("on_hold", "Waiting for a part")).error).toBeNull();
    expect((await move("resolved")).error).toBeNull();
    expect((await move("in_progress")).error?.hint).toBe("complaint_transition");
    expect((await move("reopened")).error?.hint).toBe("reopen_reason");
    expect((await move("reopened", "Still broken")).error).toBeNull();
    const row = await complaint(id);
    expect(row).toMatchObject({ status: "reopened", reopened_count: 1, resolved_at: null });
    expect(row.first_response_at).not.toBeNull();
    expect(row.hold_seconds).toBeGreaterThanOrEqual(0);
  });

  it("keeps its history append-only", async () => {
    const id = await raise("Other");
    await staff.client.rpc("complaint_comment", { p_complaint_id: id, p_body: "Looked at it" });
    const { data: event } = await staff.client
      .from("complaint_events")
      .select("id")
      .eq("complaint_id", id)
      .eq("kind", "comment")
      .single();
    expect(event).not.toBeNull();
    const edit = await owner.client
      .from("complaint_events")
      .update({ body: "x" })
      .eq("id", event!.id);
    expect(edit.error?.code).toBe(PERMISSION_DENIED);
    // Status cannot be written directly, only through the functions.
    const direct = await owner.client.from("complaints").update({ status: "closed" }).eq("id", id);
    expect(direct.error?.code).toBe(PERMISSION_DENIED);
  });
});

describe("job links", () => {
  async function linkFor(category: string) {
    const id = await raise(category, { resident_id: residentId });
    const { data: token, error } = await staff.client.rpc("complaint_job_link", {
      p_complaint_id: id,
    });
    expect(error).toBeNull();
    return { id, token: token as string };
  }

  it("show one job without the resident's phone, and take the worker's updates", async () => {
    const { id, token } = await linkFor("Plumbing");
    const { data: view } = await anon.rpc("job_view", { p_token: token });
    expect(view).toMatchObject({
      title: "Plumbing problem",
      room: "101",
      resident_name: "Complaining Kiran",
      resident_phone: null,
      worker: "Prakash Plumbing",
    });
    for (const action of ["accept", "on_the_way", "started"]) {
      expect((await anon.rpc("job_update", { p_token: token, p_action: action })).error).toBeNull();
    }
    expect((await complaint(id)).status).toBe("in_progress");
    const done = await anon.rpc("job_update", {
      p_token: token,
      p_action: "done",
      p_note: "Replaced the tap",
      p_charge: 45000,
    });
    expect(done.error).toBeNull();
    expect((await complaint(id)).status).toBe("resolved");
    const { data: costs } = await owner.client
      .from("complaint_costs")
      .select("kind, amount, recorded_via_job")
      .eq("complaint_id", id);
    expect(costs).toEqual([{ kind: "vendor_charge", amount: 45000, recorded_via_job: true }]);
    // A finished job's link stops working.
    expect((await anon.rpc("job_view", { p_token: token })).data).toBeNull();
    expect((await anon.rpc("job_update", { p_token: token, p_action: "accept" })).error?.hint).toBe(
      "job_link_invalid",
    );
  });

  it("stop working when the job is reassigned, and refuse guessed tokens", async () => {
    const { id, token } = await linkFor("Plumbing");
    await owner.client.rpc("complaint_assign", {
      p_complaint_id: id,
      p_worker_id: workers.plumber,
    });
    expect((await anon.rpc("job_view", { p_token: token })).data).toBeNull();
    expect((await anon.rpc("job_view", { p_token: "0".repeat(64) })).data).toBeNull();
    expect((await anon.rpc("job_view", { p_token: "not-a-token" })).data).toBeNull();
  });

  it("send a declined job to the next worker", async () => {
    const { id, token } = await linkFor("Plumbing");
    expect(
      (await anon.rpc("job_update", { p_token: token, p_action: "decline" })).error,
    ).toBeNull();
    expect((await complaint(id)).worker_id).toBe(workers.plumber);
  });

  it("show the resident's phone only when the owner allows it", async () => {
    await admin
      .from("hostels")
      .update({ complaints_share_resident_phone: true })
      .eq("id", hostelId);
    const { token } = await linkFor("Plumbing");
    const { data: view } = await anon.rpc("job_view", { p_token: token });
    expect((view as { resident_phone: string | null }).resident_phone).toMatch(/^[6-9]\d{9}$/);
    await admin
      .from("hostels")
      .update({ complaints_share_resident_phone: false })
      .eq("id", hostelId);
  });

  it("take at most 20 updates an hour", async () => {
    const { token } = await linkFor("Plumbing");
    const { data: row } = await admin
      .from("complaint_job_tokens")
      .select("id")
      .is("revoked_at", null)
      .order("created_at", { ascending: false })
      .limit(1)
      .single();
    await admin
      .from("complaint_job_hits")
      .insert(Array.from({ length: 20 }, () => ({ token_id: row!.id })));
    expect((await anon.rpc("job_update", { p_token: token, p_action: "accept" })).error?.hint).toBe(
      "job_rate_limited",
    );
  });
});

describe("costs", () => {
  it("charge the resident on their next invoice when they pay, and undo it when voided", async () => {
    const id = await raise("Carpentry", { resident_id: residentId });
    const { data: costId, error } = await staff.client.rpc("complaint_add_cost", {
      p_complaint_id: id,
      p_kind: "material",
      p_amount: 120000,
      p_payer: "resident",
      p_description: "Broken cupboard door",
    });
    expect(error).toBeNull();
    const { data: cost } = await owner.client
      .from("complaint_costs")
      .select("charge_id")
      .eq("id", costId!)
      .single();
    const { data: charge } = await owner.client
      .from("resident_charges")
      .select("category, amount, description")
      .eq("id", cost!.charge_id!)
      .single();
    expect(charge).toMatchObject({ category: "repair", amount: 120000 });
    expect(
      (await staff.client.rpc("complaint_void_cost", { p_cost_id: costId!, p_reason: "Wrong" }))
        .error?.hint,
    ).toBe("cost_not_found");
    expect(
      (await owner.client.rpc("complaint_void_cost", { p_cost_id: costId!, p_reason: "Wrong" }))
        .error,
    ).toBeNull();
    const { data: voided } = await owner.client
      .from("resident_charges")
      .select("voided_at")
      .eq("id", cost!.charge_id!)
      .single();
    expect(voided?.voided_at).not.toBeNull();
  });
});

describe("preventive maintenance", () => {
  it("creates a scheduled complaint once per due date", async () => {
    const { data: schedule, error } = await owner.client
      .from("maintenance_schedules")
      .insert({
        hostel_id: hostelId,
        title: "Clean water tank",
        category_id: categories.Cleaning,
        area: "Terrace",
        every_n: 1,
        unit: "month",
        next_due: shiftMonth(todayIst(), -1),
      })
      .select("id")
      .single();
    expect(error).toBeNull();
    expect((await staff.client.rpc("create_due_maintenance", { p_hostel_id: hostelId })).data).toBe(
      1,
    );
    expect((await staff.client.rpc("create_due_maintenance", { p_hostel_id: hostelId })).data).toBe(
      0,
    );
    const { data: made } = await owner.client
      .from("complaints")
      .select("kind, raised_by_kind, title")
      .eq("schedule_id", schedule!.id);
    expect(made).toEqual([
      { kind: "scheduled", raised_by_kind: "schedule", title: "Clean water tank" },
    ]);
    const { data: after } = await owner.client
      .from("maintenance_schedules")
      .select("next_due")
      .eq("id", schedule!.id)
      .single();
    expect(after!.next_due > todayIst()).toBe(true);
  });
});

describe("reports", () => {
  it("count complaints by category and room", async () => {
    const { data } = await owner.client.rpc("complaint_report", {
      p_hostel_id: hostelId,
      p_from: shiftMonth(todayIst(), -1),
      p_to: todayIst(),
    });
    const report = data as { total: number; by_category: { name: string }[]; repeats: unknown[] };
    expect(report.total).toBeGreaterThan(5);
    expect(report.by_category.map((row) => row.name)).toContain("Plumbing");
    expect(report.repeats.length).toBeGreaterThan(0);
    expect(
      (
        await other.client.rpc("complaint_report", {
          p_hostel_id: hostelId,
          p_from: "2020-01-01",
          p_to: todayIst(),
        })
      ).data,
    ).toBeNull();
  });
});

describe("tenant isolation", () => {
  it("hides complaints, workers, history and costs from other hostels", async () => {
    const id = await raise("Other");
    for (const table of [
      "complaints",
      "complaint_events",
      "complaint_costs",
      "complaint_attachments",
    ] as const) {
      const { data } = await other.client.from(table).select("id").eq("hostel_id", hostelId);
      expect(data).toEqual([]);
    }
    const { data: theirWorkers } = await other.client.from("workers").select("id");
    expect(theirWorkers).toEqual([]);
    expect(
      (await other.client.rpc("complaint_set_status", { p_complaint_id: id, p_status: "closed" }))
        .error?.hint,
    ).toBe("complaint_not_found");
    expect((await other.client.rpc("complaint_job_link", { p_complaint_id: id })).error?.hint).toBe(
      "complaint_not_found",
    );
    const intoTheirs = await other.client.from("complaints").insert({
      hostel_id: hostelId,
      room_id: roomId,
      category_id: categories.Other,
      title: "Sneaky",
    });
    expect(intoTheirs.error).not.toBeNull();
  });

  it("keeps workers and setup in the owner's hands", async () => {
    const byStaff = await staff.client.from("workers").insert({
      kind: "vendor",
      full_name: "Staff Vendor",
      phone: "9876500001",
      trades: ["general"],
    });
    expect(byStaff.error?.code).toBe(PERMISSION_DENIED);
    // Another owner cannot put a worker in this hostel.
    const intoTheirs = await other.client.from("workers").insert({
      hostel_id: hostelId,
      kind: "on_site",
      full_name: "Intruder",
      phone: "9876500002",
      trades: ["general"],
    });
    expect(intoTheirs.error?.hint).toBe("hostel_not_found");
    // Nor assign one of their own workers to this hostel's complaints.
    const { data: theirs } = await other.client
      .from("workers")
      .insert({
        kind: "vendor",
        full_name: "Their Vendor",
        phone: "9876500003",
        trades: ["general"],
      })
      .select("id")
      .single();
    const id = await raise("Other");
    expect(
      (await owner.client.rpc("complaint_assign", { p_complaint_id: id, p_worker_id: theirs!.id }))
        .error?.hint,
    ).toBe("worker_not_found");
    void otherHostelId;
  });

  it("limits files to 5 photos and 1 video, under the hostel's own folder", async () => {
    const id = await raise("Other");
    const row = (n: number, mime = "image/jpeg") => ({
      hostel_id: hostelId,
      complaint_id: id,
      path: `${hostelId}/${id}/${n}.jpg`,
      mime_type: mime,
      size_bytes: 1000,
    });
    for (let n = 1; n <= 5; n++) {
      expect((await staff.client.from("complaint_attachments").insert(row(n))).error).toBeNull();
    }
    expect((await staff.client.from("complaint_attachments").insert(row(6))).error?.hint).toBe(
      "attachment_limit",
    );
    expect(
      (await staff.client.from("complaint_attachments").insert({ ...row(7, "video/mp4") })).error,
    ).toBeNull();
    expect(
      (await staff.client.from("complaint_attachments").insert({ ...row(8, "video/mp4") })).error
        ?.hint,
    ).toBe("attachment_limit");
    const upload = await other.client.storage
      .from("complaint-media")
      .upload(`${hostelId}/${id}/sneaky.jpg`, new Blob(["x"], { type: "image/jpeg" }));
    expect(upload.error).not.toBeNull();
  });
});
