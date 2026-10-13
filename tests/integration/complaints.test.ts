import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { todayIst } from "@/lib/validation";

import { connectToDatabase } from "../support/db";
import { daysFromToday, feeFixtures, monthStart } from "../support/fees";
import { anonClient, createUserFactory, type TestUser } from "../support/supabase";

/**
 * Complaints (EP-15): lifecycle, routing, targets, job links, costs and
 * scheduled maintenance, through the functions the app calls.
 */
const PERMISSION_DENIED = "42501";
const { admin, createUser, createHostel, cleanup } = createUserFactory();
const sql = connectToDatabase();
afterAll(async () => {
  await sql.end();
  await cleanup();
});

let owner: TestUser;
let staff: TestUser;
let staffHostelId: string;
const { resident, bed, stay, setRate, generate, invoiceFor } = feeFixtures(admin, () => owner);

beforeAll(async () => {
  owner = await createUser({ fullName: "Olive Owner" });
  staffHostelId = (await createHostel(owner.id)).id;
  staff = await createUser({
    fullName: "Sam Staff",
    profile: { role: "staff", hostel_id: staffHostelId },
  });
});

async function category(hostelId: string, name: string) {
  const { data } = await admin
    .from("complaint_categories")
    .select("id")
    .eq("hostel_id", hostelId)
    .eq("name", name)
    .single();
  return data!.id;
}

async function room(hostelId: string, roomNumber = "C1") {
  const { data, error } = await admin
    .from("rooms")
    .insert({
      hostel_id: hostelId,
      room_number: roomNumber,
      floor: 1,
      sharing_type: "double",
      capacity: 2,
    })
    .select("id")
    .single();
  if (error) throw error;
  const { data: beds } = await admin
    .from("beds")
    .select("id")
    .eq("room_id", data.id)
    .order("bed_label");
  return { roomId: data.id, beds: beds!.map((row) => row.id) };
}

async function worker(
  hostelIds: string[],
  fields: { kind?: "on_site" | "vendor"; name: string; trades: string[]; preferred?: string[] },
) {
  const { data, error } = await owner.client
    .from("workers")
    .insert({
      owner_id: owner.id,
      kind: fields.kind ?? "vendor",
      name: fields.name,
      phone: "9876543210",
      trades: fields.trades,
    })
    .select("id")
    .single();
  if (error) throw error;
  for (const hostelId of hostelIds) {
    const { error: linkError } = await owner.client.from("worker_hostels").insert({
      worker_id: data.id,
      hostel_id: hostelId,
      preferred_trades: fields.preferred ?? [],
    });
    if (linkError) throw linkError;
  }
  return data.id;
}

async function raise(
  user: TestUser,
  hostelId: string,
  categoryName: string,
  extra: Record<string, unknown> = {},
) {
  const where = extra.p_room_id ? {} : { p_area: "Terrace" };
  return user.client.rpc("raise_complaint", {
    p_hostel_id: hostelId,
    p_category_id: await category(hostelId, categoryName),
    p_title: `${categoryName} problem`,
    ...where,
    ...extra,
  });
}

async function complaint(id: string) {
  const { data } = await admin.from("complaint_list").select("*").eq("id", id).single();
  return data!;
}

async function events(id: string) {
  const { data } = await admin
    .from("complaint_events")
    .select("kind, from_status, to_status, note, actor_name, worker_id")
    .eq("complaint_id", id)
    .order("id");
  return data ?? [];
}

describe("complaint records", () => {
  it("come with default categories, mapped to trades, for every new hostel", async () => {
    const hostelId = (await createHostel(owner.id)).id;
    const { data } = await staff.client.from("complaint_categories").select("name, trade");
    expect(data).toEqual(expect.arrayContaining([{ name: "Plumbing", trade: "plumber" }]));
    const { count } = await admin
      .from("complaint_categories")
      .select("id", { count: "exact", head: true })
      .eq("hostel_id", hostelId);
    expect(count).toBe(9);
  });

  it("are numbered per hostel and logged from the start", async () => {
    const hostelId = (await createHostel(owner.id)).id;
    const first = await raise(owner, hostelId, "Other");
    const second = await raise(owner, hostelId, "Other");
    expect(first.error).toBeNull();
    expect((await complaint(first.data!)).number).toBe(1);
    expect((await complaint(second.data!)).number).toBe(2);
    expect(await events(first.data!)).toEqual([
      expect.objectContaining({ kind: "created", to_status: "open", actor_name: "Olive Owner" }),
      expect.objectContaining({ kind: "routing", actor_name: "Automatic" }),
    ]);
  });

  it("are written only through the functions, and only by members", async () => {
    const outsider = await createUser();
    expect((await raise(outsider, staffHostelId, "Other")).error?.code).toBe(PERMISSION_DENIED);

    const { data: id } = await raise(staff, staffHostelId, "Other");
    const direct = await owner.client
      .from("complaints")
      .update({ status: "closed" })
      .eq("id", id!)
      .select("id");
    expect(direct.error?.code).toBe(PERMISSION_DENIED);
    const { data: seen } = await outsider.client.from("complaints").select("id").eq("id", id!);
    expect(seen).toEqual([]);

    const rewrite =
      await sql`update public.complaint_events set note = 'x' where complaint_id = ${id!}`.catch(
        (error: { message: string }) => error,
      );
    expect(String((rewrite as { message?: string }).message)).toMatch(/cannot be changed/);
  });

  it("can take the bed out of service, and put it back when fixed", async () => {
    const hostelId = (await createHostel(owner.id)).id;
    const { roomId, beds } = await room(hostelId);
    const { data: id, error } = await raise(owner, hostelId, "Carpentry", {
      p_room_id: roomId,
      p_bed_id: beds[0],
      p_bed_maintenance: true,
    });
    expect(error).toBeNull();
    const bedRow = async () =>
      (await admin.from("beds").select("status, status_reason").eq("id", beds[0]).single()).data;
    expect(await bedRow()).toEqual({ status: "maintenance", status_reason: "Complaint #1" });

    await owner.client.rpc("set_complaint_status", { p_complaint_id: id!, p_status: "resolved" });
    expect(await bedRow()).toEqual({ status: "available", status_reason: null });
  });
});

describe("lifecycle", () => {
  it("moves only along allowed paths, with reasons for holds and reopens", async () => {
    const hostelId = (await createHostel(owner.id)).id;
    const { data: id } = await raise(owner, hostelId, "Other");
    const to = (status: string, note?: string) =>
      owner.client.rpc("set_complaint_status", {
        p_complaint_id: id!,
        p_status: status,
        p_note: note,
      });

    expect((await to("on_hold")).error?.hint).toBe("reason_required");
    expect((await to("on_hold", "Waiting for a part")).error).toBeNull();
    expect((await complaint(id!)).hold_reason).toBe("Waiting for a part");
    expect((await to("in_progress")).error).toBeNull();
    expect((await to("resolved", "Fixed")).error).toBeNull();
    expect((await to("in_progress")).error?.hint).toBe("complaint_transition");
    expect((await to("closed")).error).toBeNull();
    expect((await to("reopened")).error?.hint).toBe("reason_required");
    expect((await to("reopened", "Leaking again")).error).toBeNull();

    const row = await complaint(id!);
    expect(row).toMatchObject({ status: "reopened", resolved_at: null, closed_at: null });
    expect(row.responded_at).not.toBeNull();
    expect((await events(id!)).filter((event) => event.kind === "status")).toHaveLength(5);
  });

  it("does not count time on hold against the targets", async () => {
    const hostelId = (await createHostel(owner.id)).id;
    const { data: id } = await raise(owner, hostelId, "Other", { p_priority: "urgent" });
    // Raised three hours ago, on hold for two of them: one hour used of two.
    await owner.client.rpc("set_complaint_status", {
      p_complaint_id: id!,
      p_status: "on_hold",
      p_note: "Waiting for a part",
    });
    await sql`update public.complaints set created_at = now() - interval '3 hours',
              held_since = now() - interval '2 hours' where id = ${id!}`;
    expect((await complaint(id!)).target_state).toBe("paused");
    await owner.client.rpc("set_complaint_status", { p_complaint_id: id!, p_status: "open" });
    const row = await complaint(id!);
    expect(row.target_state).toBe("on_track");
    const { data: raw } = await admin
      .from("complaints")
      .select("held_seconds")
      .eq("id", id!)
      .single();
    expect(raw!.held_seconds).toBeGreaterThanOrEqual(7200);
  });

  it("escalates a complaint past its target once, and shows it as overdue", async () => {
    const hostelId = (await createHostel(owner.id)).id;
    const { data: id } = await raise(owner, hostelId, "Other", { p_priority: "urgent" });
    await sql`update public.complaints set created_at = now() - interval '3 hours' where id = ${id!}`;
    expect((await complaint(id!)).target_state).toBe("overdue");

    await sql`select private.escalate_complaints()`;
    await sql`select private.escalate_complaints()`;
    const escalations = (await events(id!)).filter((event) => event.kind === "escalated");
    expect(escalations).toEqual([
      expect.objectContaining({ note: "Missed the response target", actor_name: "Automatic" }),
    ]);
  });

  it("uses the hostel's own targets when set", async () => {
    const hostelId = (await createHostel(owner.id)).id;
    const { error } = await owner.client.from("complaint_targets").insert({
      hostel_id: hostelId,
      priority: "low",
      respond_minutes: 10,
      resolve_minutes: 60,
    });
    expect(error).toBeNull();
    const { data: id } = await raise(owner, hostelId, "Other", { p_priority: "low" });
    await sql`update public.complaints set created_at = now() - interval '20 minutes' where id = ${id!}`;
    expect((await complaint(id!)).target_state).toBe("overdue");
  });
});

describe("routing", () => {
  it("prefers on-site staff, then the preferred vendor, then the least busy", async () => {
    const hostelId = (await createHostel(owner.id)).id;
    const busy = await worker([hostelId], { name: "Busy Vendor", trades: ["plumber"] });
    const idle = await worker([hostelId], { name: "Idle Vendor", trades: ["plumber"] });
    // Busy has a job already.
    await raise(owner, hostelId, "Plumbing");
    await owner.client.rpc("assign_complaint", {
      p_complaint_id: (
        await admin.from("complaints").select("id").eq("hostel_id", hostelId).single()
      ).data!.id,
      p_worker_id: busy,
    });

    const { data: first } = await raise(owner, hostelId, "Plumbing");
    expect((await complaint(first!)).worker_id).toBe(idle);

    const preferred = await worker([hostelId], {
      name: "Preferred Vendor",
      trades: ["plumber"],
      preferred: ["plumber"],
    });
    const { data: second } = await raise(owner, hostelId, "Plumbing");
    expect((await complaint(second!)).worker_id).toBe(preferred);

    const onSite = await worker([hostelId], {
      kind: "on_site",
      name: "Own Plumber",
      trades: ["plumber"],
    });
    const { data: third } = await raise(owner, hostelId, "Plumbing");
    const routed = await complaint(third!);
    expect(routed).toMatchObject({ worker_id: onSite, status: "assigned", needs_worker: false });
    expect(await events(third!)).toContainEqual(
      expect.objectContaining({
        kind: "assigned",
        note: "Routed automatically",
        worker_id: onSite,
      }),
    );
  });

  it("skips unavailable workers, flags a complaint nobody can take, and honours manual-only categories", async () => {
    const hostelId = (await createHostel(owner.id)).id;
    const away = await worker([hostelId], {
      kind: "on_site",
      name: "Away",
      trades: ["electrician"],
    });
    await owner.client
      .from("worker_unavailability")
      .insert({ worker_id: away, from_date: daysFromToday(-1), to_date: daysFromToday(2) });

    const { data: id } = await raise(owner, hostelId, "Electrical");
    expect(await complaint(id!)).toMatchObject({
      worker_id: null,
      status: "open",
      needs_worker: true,
    });

    const internet = await category(hostelId, "Internet");
    await owner.client
      .from("complaint_categories")
      .update({ auto_route: false })
      .eq("id", internet);
    await worker([hostelId], { name: "Net Guy", trades: ["technician"] });
    const { data: manual } = await raise(owner, hostelId, "Internet");
    expect(await complaint(manual!)).toMatchObject({ worker_id: null, needs_worker: false });
  });

  it("assigns by hand only workers serving the hostel, and logs every change", async () => {
    const elsewhere = (await createHostel(owner.id)).id;
    const outsiderWorker = await worker([elsewhere], { name: "Other Hostel", trades: ["general"] });
    const local = await worker([staffHostelId], { name: "Local", trades: ["cleaner"] });
    const { data: id } = await raise(staff, staffHostelId, "Security");

    const wrong = await staff.client.rpc("assign_complaint", {
      p_complaint_id: id!,
      p_worker_id: outsiderWorker,
    });
    expect(wrong.error?.hint).toBe("complaint_worker");
    expect(
      (await staff.client.rpc("assign_complaint", { p_complaint_id: id!, p_worker_id: local }))
        .error,
    ).toBeNull();
    expect(
      (await staff.client.rpc("assign_complaint", { p_complaint_id: id!, p_worker_id: null }))
        .error,
    ).toBeNull();
    expect((await complaint(id!)).status).toBe("open");
    const kinds = (await events(id!)).map((event) => event.kind);
    expect(kinds).toEqual(expect.arrayContaining(["assigned", "unassigned"]));
  });

  it("refuses a worker linked to another owner's hostel", async () => {
    const otherOwner = await createUser();
    const theirHostel = (await createHostel(otherOwner.id)).id;
    const mine = await worker([], { name: "Mine", trades: ["general"] });
    const link = await owner.client
      .from("worker_hostels")
      .insert({ worker_id: mine, hostel_id: theirHostel });
    expect(link.error).not.toBeNull();
  });
});

describe("job links", () => {
  it("show one job to its worker, take their updates, and die on reassignment", async () => {
    const hostelId = (await createHostel(owner.id)).id;
    const { roomId } = await room(hostelId, "J1");
    const residentId = await resident(hostelId, {
      full_name: "Ravi Resident",
      phone: "9123456780",
    });
    const vendor = await worker([hostelId], { name: "Vijay Vendor", trades: ["plumber"] });
    const backup = await worker([hostelId], { name: "Backup Vendor", trades: ["plumber"] });
    const { data: id } = await raise(owner, hostelId, "Plumbing", {
      p_room_id: roomId,
      p_resident_id: residentId,
    });
    await owner.client.rpc("assign_complaint", { p_complaint_id: id!, p_worker_id: vendor });

    const { data: token, error } = await staff.client.rpc("create_job_link", {
      p_complaint_id: id!,
    });
    expect(error?.code).toBe(PERMISSION_DENIED);
    const created = await owner.client.rpc("create_job_link", { p_complaint_id: id! });
    expect(created.error).toBeNull();
    expect(token).toBeNull();
    const jobToken = created.data!;
    expect(jobToken).toMatch(/^[0-9a-f]{48}$/);

    // Anyone with the link, signed in or not.
    const anon = anonClient();
    const { data: view } = await anon.rpc("job_view", { p_token: jobToken });
    expect(view).toMatchObject({
      number: 1,
      room_number: "J1",
      worker_name: "Vijay Vendor",
      resident_phone: null,
      accepted: false,
    });
    expect((await anon.rpc("job_view", { p_token: "0".repeat(48) })).data).toBeNull();

    await owner.client.rpc("update_complaint", {
      p_complaint_id: id!,
      p_priority: "high",
      p_share_resident_phone: true,
    });
    expect((await anon.rpc("job_view", { p_token: jobToken })).data).toMatchObject({
      resident_phone: "9123456780",
    });

    expect((await anon.rpc("job_act", { p_token: jobToken, p_action: "accept" })).error).toBeNull();
    expect((await anon.rpc("job_act", { p_token: jobToken, p_action: "start" })).error).toBeNull();
    expect((await complaint(id!)).status).toBe("in_progress");
    expect(
      (
        await anon.rpc("job_act", {
          p_token: jobToken,
          p_action: "done",
          p_note: "Replaced the washer",
          p_charge: 35000,
        })
      ).error,
    ).toBeNull();
    const done = await complaint(id!);
    expect(done).toMatchObject({ status: "resolved", total_cost: 35000 });
    expect(await events(id!)).toContainEqual(
      expect.objectContaining({
        kind: "status",
        to_status: "resolved",
        actor_name: "Vijay Vendor (job link)",
      }),
    );

    // Reopened and given to someone else: the old link stops working.
    await owner.client.rpc("set_complaint_status", {
      p_complaint_id: id!,
      p_status: "reopened",
      p_note: "Still dripping",
    });
    await owner.client.rpc("assign_complaint", { p_complaint_id: id!, p_worker_id: backup });
    expect((await anon.rpc("job_view", { p_token: jobToken })).data).toBeNull();
    expect((await anon.rpc("job_act", { p_token: jobToken, p_action: "accept" })).error?.hint).toBe(
      "job_link_dead",
    );
  });

  it("send a declined job back to routing, never to the same worker", async () => {
    const hostelId = (await createHostel(owner.id)).id;
    const first = await worker([hostelId], {
      name: "First",
      trades: ["pest_control"],
      preferred: ["pest_control"],
    });
    const second = await worker([hostelId], { name: "Second", trades: ["pest_control"] });
    const { data: id } = await raise(owner, hostelId, "Pest control");
    expect((await complaint(id!)).worker_id).toBe(first);
    const { data: jobToken } = await owner.client.rpc("create_job_link", { p_complaint_id: id! });

    const anon = anonClient();
    expect(
      (await anon.rpc("job_act", { p_token: jobToken!, p_action: "decline" })).error?.hint,
    ).toBe("reason_required");
    expect(
      (
        await anon.rpc("job_act", {
          p_token: jobToken!,
          p_action: "decline",
          p_note: "Out of town",
        })
      ).error,
    ).toBeNull();
    expect((await complaint(id!)).worker_id).toBe(second);
    expect((await anon.rpc("job_view", { p_token: jobToken! })).data).toBeNull();
  });

  it("accept completion photos only inside their own job's folder", async () => {
    const hostelId = (await createHostel(owner.id)).id;
    const vendor = await worker([hostelId], { name: "Photo Vendor", trades: ["general"] });
    const { data: id } = await raise(owner, hostelId, "Other");
    const { data: other } = await raise(owner, hostelId, "Other");
    await owner.client.rpc("assign_complaint", { p_complaint_id: id!, p_worker_id: vendor });
    const { data: jobToken } = await owner.client.rpc("create_job_link", { p_complaint_id: id! });

    const anon = anonClient();
    const elsewhere = await anon.rpc("job_add_attachment", {
      p_token: jobToken!,
      p_path: `${hostelId}/${other}/x.jpg`,
    });
    expect(elsewhere.error?.code).toBe(PERMISSION_DENIED);
    const own = await anon.rpc("job_add_attachment", {
      p_token: jobToken!,
      p_path: `${hostelId}/${id}/done.jpg`,
    });
    expect(own.error).toBeNull();
  });
});

describe("costs", () => {
  it("charge the resident on their next invoice, and replace the charge until billed", async () => {
    const hostelId = (await createHostel(owner.id)).id;
    await setRate(hostelId, "single", 500000, monthStart(-12));
    const residentId = await resident(hostelId);
    await stay(hostelId, residentId, await bed(hostelId), monthStart(-3));
    const vendor = await worker([hostelId], { name: "Glass Vendor", trades: ["carpenter"] });
    const { data: id } = await raise(owner, hostelId, "Carpentry", { p_resident_id: residentId });
    await owner.client.rpc("assign_complaint", { p_complaint_id: id!, p_worker_id: vendor });

    const costs = (labour: number, payer: string) =>
      owner.client.rpc("set_complaint_costs", {
        p_complaint_id: id!,
        p_labour: labour,
        p_material: 20000,
        p_vendor_charge: 0,
        p_payer: payer,
      });
    expect(
      (
        await staff.client.rpc("set_complaint_costs", {
          p_complaint_id: id!,
          p_labour: 1,
          p_material: 0,
          p_vendor_charge: 0,
          p_payer: "hostel",
        })
      ).error?.code,
    ).toBe(PERMISSION_DENIED);

    expect((await costs(30000, "resident")).error).toBeNull();
    expect((await costs(40000, "resident")).error).toBeNull();
    const charges = async () =>
      (
        await admin
          .from("resident_charges")
          .select("amount, status, description")
          .eq("resident_id", residentId)
          .order("created_at")
      ).data;
    expect(await charges()).toEqual([
      expect.objectContaining({ amount: 50000, status: "void" }),
      expect.objectContaining({
        amount: 60000,
        status: "pending",
        description: "Repair: Carpentry problem (complaint #1)",
      }),
    ]);

    await generate(hostelId, monthStart(0));
    expect((await invoiceFor(residentId, monthStart(0)))!.amount).toBe(500000 + 60000);
    expect((await costs(10000, "hostel")).error?.hint).toBe("complaint_cost_billed");

    const payout = await owner.client.rpc("record_vendor_payout", {
      p_complaint_id: id!,
      p_amount: 60000,
      p_paid_at: todayIst(),
      p_mode: "upi",
      p_reference: "UPI-1",
    });
    expect(payout.error).toBeNull();
  });
});

describe("scheduled maintenance", () => {
  it("becomes a scheduled complaint when due, routed like any other, and moves on", async () => {
    const hostelId = (await createHostel(owner.id)).id;
    const cleaner = await worker([hostelId], {
      kind: "on_site",
      name: "Tank Cleaner",
      trades: ["cleaner"],
    });
    const { error } = await owner.client.from("maintenance_schedules").insert({
      hostel_id: hostelId,
      title: "Clean the water tank",
      category_id: await category(hostelId, "Cleaning"),
      area: "Terrace tank",
      every: 3,
      unit: "month",
      next_due: daysFromToday(-1),
    });
    expect(error).toBeNull();

    expect(
      (await staff.client.rpc("create_due_maintenance", { p_hostel_id: hostelId })).error?.code,
    ).toBe(PERMISSION_DENIED);
    expect((await owner.client.rpc("create_due_maintenance", { p_hostel_id: hostelId })).data).toBe(
      1,
    );
    expect((await owner.client.rpc("create_due_maintenance", { p_hostel_id: hostelId })).data).toBe(
      0,
    );

    const { data: created } = await admin
      .from("complaint_list")
      .select("kind, title, worker_id, area")
      .eq("hostel_id", hostelId);
    expect(created).toEqual([
      {
        kind: "scheduled",
        title: "Clean the water tank",
        worker_id: cleaner,
        area: "Terrace tank",
      },
    ]);
    const { data: schedule } = await admin
      .from("maintenance_schedules")
      .select("next_due")
      .eq("hostel_id", hostelId)
      .single();
    expect(schedule!.next_due > todayIst()).toBe(true);
  });
});

describe("reports", () => {
  it("count complaints by category and flag rooms with the same problem again", async () => {
    const hostelId = (await createHostel(owner.id)).id;
    const { roomId } = await room(hostelId, "R9");
    for (let i = 0; i < 2; i += 1) {
      await raise(owner, hostelId, "Plumbing", { p_room_id: roomId });
    }
    await raise(owner, hostelId, "Electrical");
    const { data } = await owner.client.rpc("complaints_report", {
      p_hostel_id: hostelId,
      p_from: daysFromToday(-1),
      p_to: todayIst(),
    });
    expect(data).toMatchObject({
      total: 3,
      repeat_rooms: [{ room_number: "R9", category: "Plumbing", count: 2 }],
    });
    const { data: csv } = await owner.client.rpc("complaints_csv", {
      p_hostel_id: hostelId,
      p_from: daysFromToday(-1),
      p_to: todayIst(),
    });
    expect((csv as string).trim().split("\n")).toHaveLength(4);
  });
});
