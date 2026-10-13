import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { anonClient, createUserFactory, type TestUser } from "../support/supabase";

/**
 * Tenant isolation for complaints, their history, files, workers, costs and
 * job links (E15-T14). Owner B must reach nothing of hostel A's, and a job
 * link must reach only its own job.
 */
const PERMISSION_DENIED = "42501";
const { admin, createUser, createHostel, cleanup } = createUserFactory();

let ownerA: TestUser;
let ownerB: TestUser;
let staffB: TestUser;
let hostelA: string;
let hostelB: string;
let complaintA: string;
let workerA: string;
let token: string;

afterAll(cleanup);

beforeAll(async () => {
  [ownerA, ownerB] = await Promise.all([createUser(), createUser()]);
  hostelA = (await createHostel(ownerA.id)).id;
  hostelB = (await createHostel(ownerB.id)).id;
  staffB = await createUser({ profile: { role: "staff", hostel_id: hostelB } });

  const { data: worker, error: workerError } = await ownerA.client
    .from("workers")
    .insert({
      owner_id: ownerA.id,
      kind: "vendor",
      name: "A's Plumber",
      phone: "9876500001",
      trades: ["plumber"],
    })
    .select("id")
    .single();
  if (workerError) throw workerError;
  workerA = worker.id;
  await ownerA.client.from("worker_hostels").insert({ worker_id: workerA, hostel_id: hostelA });

  const { data: category } = await admin
    .from("complaint_categories")
    .select("id")
    .eq("hostel_id", hostelA)
    .eq("name", "Plumbing")
    .single();
  const { data, error } = await ownerA.client.rpc("raise_complaint", {
    p_hostel_id: hostelA,
    p_category_id: category!.id,
    p_title: "Tap leaking",
    p_area: "Kitchen",
  });
  if (error) throw error;
  complaintA = data;
  const link = await ownerA.client.rpc("create_job_link", { p_complaint_id: complaintA });
  if (link.error) throw link.error;
  token = link.data;
  await admin.storage
    .from("complaint-files")
    .upload(`${hostelA}/${complaintA}/leak.jpg`, new Uint8Array([0xff, 0xd8, 0xff, 0xe0]), {
      contentType: "image/jpeg",
    });
  await ownerA.client.rpc("add_complaint_attachment", {
    p_complaint_id: complaintA,
    p_path: `${hostelA}/${complaintA}/leak.jpg`,
    p_kind: "photo",
  });
});

describe("another hostel", () => {
  it("cannot read hostel A's complaints, history, files, workers or links", async () => {
    for (const user of [ownerB, staffB]) {
      for (const table of [
        "complaints",
        "complaint_list",
        "complaint_events",
        "complaint_attachments",
        "complaint_job_links",
        "vendor_payouts",
      ] as const) {
        const { data } = await user.client
          .from(table as "complaints")
          .select("id")
          .eq("hostel_id", hostelA);
        expect(data, `${table}`).toEqual([]);
      }
      const { data: workers } = await user.client.from("workers").select("id").eq("id", workerA);
      expect(workers).toEqual([]);
      const { data: categories } = await user.client
        .from("complaint_categories")
        .select("id")
        .eq("hostel_id", hostelA);
      expect(categories).toEqual([]);
    }
  });

  it("cannot act on hostel A's complaint through any function", async () => {
    const calls = [
      ownerB.client.rpc("assign_complaint", { p_complaint_id: complaintA }),
      ownerB.client.rpc("set_complaint_status", { p_complaint_id: complaintA, p_status: "closed" }),
      ownerB.client.rpc("comment_complaint", { p_complaint_id: complaintA, p_note: "hi" }),
      ownerB.client.rpc("route_complaint", { p_complaint_id: complaintA }),
      ownerB.client.rpc("create_job_link", { p_complaint_id: complaintA }),
      ownerB.client.rpc("update_complaint", {
        p_complaint_id: complaintA,
        p_priority: "urgent",
        p_share_resident_phone: true,
      }),
      ownerB.client.rpc("set_complaint_costs", {
        p_complaint_id: complaintA,
        p_labour: 1,
        p_material: 0,
        p_vendor_charge: 0,
        p_payer: "hostel",
      }),
      ownerB.client.rpc("add_complaint_attachment", {
        p_complaint_id: complaintA,
        p_path: `${hostelA}/${complaintA}/x.jpg`,
        p_kind: "photo",
      }),
      ownerB.client.rpc("complaints_report", {
        p_hostel_id: hostelA,
        p_from: "2026-01-01",
        p_to: "2026-12-31",
      }),
      ownerB.client.rpc("create_due_maintenance", { p_hostel_id: hostelA }),
    ];
    for (const call of calls) {
      expect((await call).error?.code).toBe(PERMISSION_DENIED);
    }
  });

  it("cannot open, list or upload hostel A's complaint files", async () => {
    const path = `${hostelA}/${complaintA}/leak.jpg`;
    const signed = await ownerB.client.storage.from("complaint-files").createSignedUrl(path, 60);
    expect(signed.data).toBeNull();
    const { data: listed } = await ownerB.client.storage
      .from("complaint-files")
      .list(`${hostelA}/${complaintA}`);
    expect(listed ?? []).toEqual([]);
    const upload = await ownerB.client.storage
      .from("complaint-files")
      .upload(`${hostelA}/${complaintA}/evil.jpg`, new Uint8Array([0xff, 0xd8, 0xff]));
    expect(upload.error).not.toBeNull();

    // The owner can.
    const own = await ownerA.client.storage.from("complaint-files").createSignedUrl(path, 60);
    expect(own.error).toBeNull();
  });

  it("cannot use a worker of hostel A or move one into its own hostel", async () => {
    const link = await ownerB.client
      .from("worker_hostels")
      .insert({ worker_id: workerA, hostel_id: hostelB });
    expect(link.error).not.toBeNull();
    const edit = await ownerB.client
      .from("workers")
      .update({ name: "Taken" })
      .eq("id", workerA)
      .select("id");
    expect(edit.data ?? []).toEqual([]);
  });
});

describe("job links", () => {
  it("never expose the token hash to members", async () => {
    const { error } = await ownerA.client.from("complaint_job_links").select("token_hash");
    expect(error?.code).toBe(PERMISSION_DENIED);
  });

  it("reach only their own job, and nothing with a guessed token", async () => {
    const anon = anonClient();
    const { data } = await anon.rpc("job_view", { p_token: token });
    expect(data).toMatchObject({ complaint_id: complaintA, title: "Tap leaking" });
    for (const guess of ["", "x", token.slice(0, -1), token.toUpperCase(), "0".repeat(48)]) {
      expect((await anon.rpc("job_view", { p_token: guess })).data).toBeNull();
      expect((await anon.rpc("job_act", { p_token: guess, p_action: "accept" })).error?.hint).toBe(
        "job_link_dead",
      );
    }
    // The anonymous role reads nothing directly.
    const { data: rows } = await anon.from("complaints").select("id");
    expect(rows ?? []).toEqual([]);
  });
});
