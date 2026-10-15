import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { connectToDatabase } from "../support/db";
import { feeFixtures, monthStart } from "../support/fees";
import { randomMobile } from "../support/residents";
import { anonClient, createUserFactory, type TestUser } from "../support/supabase";

/**
 * Residents report problems from their room's QR code and follow them
 * (E15-T3, T4): one-time codes, rate limits that never reveal who lives
 * where, short sessions, the status link, confirming or reopening a fix,
 * SMS updates and automatic closing.
 */
const RAISED = "P0001";
const PERMISSION_DENIED = "42501";

const { admin, createUser, createHostel, cleanup } = createUserFactory();
const sql = connectToDatabase();
let owner: TestUser;
let staff: TestUser;
let hostelId: string;
const fees = feeFixtures(admin, () => owner);

afterAll(async () => {
  await cleanup();
  await sql.end();
});

beforeAll(async () => {
  owner = await createUser({ fullName: "Complaints Owner" });
  hostelId = (await createHostel(owner.id, { name: "QR Test PG" })).id;
  staff = await createUser({ profile: { role: "staff", hostel_id: hostelId } });
});

/** A resident living in a room of their own, and that room's QR token. */
async function residentInRoom() {
  const phone = randomMobile();
  const residentId = await fees.resident(hostelId, { phone, full_name: "Kiran Rao" });
  const bedId = await fees.bed(hostelId);
  await fees.stay(hostelId, residentId, bedId, monthStart(-1));
  const { data: bed } = await admin.from("beds").select("room_id").eq("id", bedId).single();
  const { data: token, error } = await staff.client.rpc("room_report_token", {
    p_room_id: bed!.room_id,
  });
  expect(error).toBeNull();
  return { phone, residentId, roomId: bed!.room_id, token: token as string };
}

async function codeFor(token: string, phone: string) {
  const { data } = await admin.rpc("resident_request_code", { p_token: token, p_phone: phone });
  return (data as { code: string } | null)?.code ?? null;
}

async function signedIn(token: string, phone: string) {
  const code = await codeFor(token, phone);
  expect(code).toMatch(/^\d{6}$/);
  const { data } = await admin.rpc("resident_verify_code", {
    p_token: token,
    p_phone: phone,
    p_code: code!,
  });
  expect(data).toMatch(/^[0-9a-f]{48}$/);
  return data as string;
}

async function categoryId() {
  const { data } = await admin
    .from("complaint_categories")
    .select("id")
    .eq("hostel_id", hostelId)
    .eq("name", "Plumbing")
    .single();
  return data!.id;
}

describe("room codes", () => {
  it("gives each room one code, and only the owner can replace it", async () => {
    const { roomId, token } = await residentInRoom();
    const again = await owner.client.rpc("room_report_token", { p_room_id: roomId });
    expect(again.data).toBe(token);

    const byStaff = await staff.client.rpc("room_report_token", {
      p_room_id: roomId,
      p_regenerate: true,
    });
    expect(byStaff.error?.code).toBe(PERMISSION_DENIED);

    const fresh = await owner.client.rpc("room_report_token", {
      p_room_id: roomId,
      p_regenerate: true,
    });
    expect(fresh.data).not.toBe(token);
    const dead = await admin.rpc("resident_room", { p_token: token });
    expect(dead.data).toBeNull();
    const live = await admin.rpc("resident_room", { p_token: fresh.data as string });
    expect(live.data).toMatchObject({ hostel_name: "QR Test PG", enabled: true });
  });

  it("does not show another hostel's room codes", async () => {
    const { roomId } = await residentInRoom();
    const stranger = await createUser();
    const { error } = await stranger.client.rpc("room_report_token", { p_room_id: roomId });
    expect(error?.code).toBe(PERMISSION_DENIED);
    const { data } = await stranger.client.from("room_report_tokens").select("token");
    expect(data).toEqual([]);
  });
});

describe("one-time codes", () => {
  it("sends a code only to a resident living in the room, saying the same either way", async () => {
    const { token, phone } = await residentInRoom();
    expect(await codeFor(token, phone)).toMatch(/^\d{6}$/);
    // Someone else's number, or a resident of another room: no code.
    expect(await codeFor(token, randomMobile())).toBeNull();
    const other = await residentInRoom();
    expect(await codeFor(token, other.phone)).toBeNull();
    // Nothing about any of it is stored in full.
    const [row] = await sql`
      select code_hash from public.resident_codes where phone = ${phone} order by created_at desc limit 1`;
    expect(row.code_hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it("limits codes per number", async () => {
    const { token, phone } = await residentInRoom();
    expect(await codeFor(token, phone)).not.toBeNull();
    expect(await codeFor(token, phone)).not.toBeNull();
    expect(await codeFor(token, phone)).not.toBeNull();
    expect(await codeFor(token, phone)).toBeNull();
  });

  it("allows five tries at a code, and a code only once", async () => {
    const { token, phone } = await residentInRoom();
    const code = (await codeFor(token, phone))!;
    const wrong = code === "000000" ? "111111" : "000000";
    for (let i = 0; i < 5; i += 1) {
      const { data } = await admin.rpc("resident_verify_code", {
        p_token: token,
        p_phone: phone,
        p_code: wrong,
      });
      expect(data).toBeNull();
    }
    const locked = await admin.rpc("resident_verify_code", {
      p_token: token,
      p_phone: phone,
      p_code: code,
    });
    expect(locked.data).toBeNull();

    const next = (await codeFor(token, phone))!;
    const ok = await admin.rpc("resident_verify_code", {
      p_token: token,
      p_phone: phone,
      p_code: next,
    });
    expect(ok.data).toMatch(/^[0-9a-f]{48}$/);
    const reused = await admin.rpc("resident_verify_code", {
      p_token: token,
      p_phone: phone,
      p_code: next,
    });
    expect(reused.data).toBeNull();
  });

  it("sends nothing when the owner turns resident complaints off", async () => {
    const { token, phone } = await residentInRoom();
    await owner.client
      .from("hostels")
      .update({ resident_complaints_enabled: false })
      .eq("id", hostelId);
    try {
      expect(await codeFor(token, phone)).toBeNull();
      const room = await admin.rpc("resident_room", { p_token: token });
      expect(room.data).toMatchObject({ enabled: false });
    } finally {
      await owner.client
        .from("hostels")
        .update({ resident_complaints_enabled: true })
        .eq("id", hostelId);
    }
  });

  it("keeps every resident function away from signed-in users and visitors", async () => {
    const { token, phone } = await residentInRoom();
    for (const client of [owner.client, anonClient()]) {
      const { error } = await client.rpc("resident_request_code", {
        p_token: token,
        p_phone: phone,
      });
      expect(error).not.toBeNull();
    }
  });
});

describe("raising and following a complaint", () => {
  it("raises a complaint for the resident's room, routes it and texts the status link", async () => {
    const { token, phone, residentId, roomId } = await residentInRoom();
    const session = await signedIn(token, phone);

    const form = await admin.rpc("resident_form", { p_session: session });
    expect(form.data).toMatchObject({ resident_name: "Kiran", hostel_name: "QR Test PG" });
    expect(
      (form.data as { categories: { name: string }[] }).categories.map((c) => c.name),
    ).toContain("Plumbing");

    const { data, error } = await admin.rpc("resident_raise_complaint", {
      p_session: session,
      p_category_id: await categoryId(),
      p_description: "The bathroom tap has been leaking since morning",
    });
    expect(error).toBeNull();
    const raised = data as { id: string; number: number; status_token: string };
    const { data: complaint } = await admin
      .from("complaints")
      .select("room_id, resident_id, source, title, raised_by_name")
      .eq("id", raised.id)
      .single();
    expect(complaint).toEqual({
      room_id: roomId,
      resident_id: residentId,
      source: "resident",
      title: "Plumbing: The bathroom tap has been leaking since morning",
      raised_by_name: "Kiran Rao (resident)",
    });
    const { data: events } = await admin
      .from("complaint_events")
      .select("kind, actor_name")
      .eq("complaint_id", raised.id)
      .eq("kind", "created");
    expect(events).toEqual([{ kind: "created", actor_name: "Kiran Rao (resident)" }]);

    const texts = await sql`
      select to_phone, variables from public.sms_outbox where dedupe_key like ${`complaint_update:${raised.id}:%`}`;
    expect(texts).toEqual([
      {
        to_phone: phone,
        variables: [String(raised.number), "QR Test PG", "received", raised.status_token],
      },
    ]);

    // Staff work on it; the resident is told at each step.
    await staff.client.rpc("set_complaint_status", {
      p_complaint_id: raised.id,
      p_status: "in_progress",
    });
    await staff.client.rpc("set_complaint_status", {
      p_complaint_id: raised.id,
      p_status: "resolved",
    });
    const steps = await sql`
      select variables[3] as step from public.sms_outbox
       where dedupe_key like ${`complaint_update:${raised.id}:%`} order by created_at`;
    expect(steps.map((s) => s.step)).toEqual([
      "received",
      "work has started",
      "marked fixed, please confirm",
    ]);

    const status = await admin.rpc("resident_status", { p_token: raised.status_token });
    const view = status.data as {
      complaints: { number: number; status: string; category: string }[];
    };
    expect(view.complaints[0]).toMatchObject({
      number: raised.number,
      status: "resolved",
      category: "Plumbing",
    });

    const fixed = await admin.rpc("resident_respond", {
      p_token: raised.status_token,
      p_complaint_id: raised.id,
      p_fixed: true,
      p_rating: 4,
      p_comment: "Quick, thank you",
    });
    expect(fixed.error).toBeNull();
    const { data: closed } = await admin
      .from("complaints")
      .select("status, resident_rating, resident_feedback, resident_confirmed_at")
      .eq("id", raised.id)
      .single();
    expect(closed).toMatchObject({
      status: "closed",
      resident_rating: 4,
      resident_feedback: "Quick, thank you",
    });
    expect(closed!.resident_confirmed_at).not.toBeNull();
  });

  it("lets the resident reopen an unfixed problem with a reason, only their own", async () => {
    const { token, phone } = await residentInRoom();
    const session = await signedIn(token, phone);
    const { data } = await admin.rpc("resident_raise_complaint", {
      p_session: session,
      p_category_id: await categoryId(),
      p_description: "No water in the shower",
    });
    const raised = data as { id: string; status_token: string };
    await staff.client.rpc("set_complaint_status", {
      p_complaint_id: raised.id,
      p_status: "resolved",
    });

    const noReason = await admin.rpc("resident_respond", {
      p_token: raised.status_token,
      p_complaint_id: raised.id,
      p_fixed: false,
      p_rating: null as unknown as number,
      p_comment: "",
    });
    expect(noReason.error?.hint).toBe("reason_required");
    const reopened = await admin.rpc("resident_respond", {
      p_token: raised.status_token,
      p_complaint_id: raised.id,
      p_fixed: false,
      p_rating: null as unknown as number,
      p_comment: "Still no water after 9pm",
    });
    expect(reopened.error).toBeNull();
    const { data: row } = await admin
      .from("complaints")
      .select("status")
      .eq("id", raised.id)
      .single();
    expect(row?.status).toBe("reopened");

    // Another resident's link sees and touches nothing of this one.
    const other = await residentInRoom();
    const otherSession = await signedIn(other.token, other.phone);
    const { data: theirs } = await admin.rpc("resident_raise_complaint", {
      p_session: otherSession,
      p_category_id: await categoryId(),
      p_description: "Light flickers in the room",
    });
    const theirToken = (theirs as { status_token: string }).status_token;
    const view = await admin.rpc("resident_status", { p_token: theirToken });
    expect(
      (view.data as { complaints: { id: string }[] }).complaints.map((c) => c.id),
    ).not.toContain(raised.id);
    const meddle = await admin.rpc("resident_respond", {
      p_token: theirToken,
      p_complaint_id: raised.id,
      p_fixed: true,
      p_rating: 5,
      p_comment: "",
    });
    expect(meddle.error?.hint).toBe("resident_status");
  });

  it("ends the session when the resident moves out", async () => {
    const { token, phone, residentId } = await residentInRoom();
    const session = await signedIn(token, phone);
    await admin
      .from("allocations")
      .update({ end_date: monthStart(-1), vacate_reason: "moved_out" })
      .eq("resident_id", residentId);
    const { error } = await admin.rpc("resident_raise_complaint", {
      p_session: session,
      p_category_id: await categoryId(),
      p_description: "Fan is not working",
    });
    expect(error?.code).toBe(RAISED);
    expect(error?.hint).toBe("resident_session");
  });

  it("closes a fix the resident never answered after the hostel's window", async () => {
    const { token, phone } = await residentInRoom();
    const session = await signedIn(token, phone);
    const { data } = await admin.rpc("resident_raise_complaint", {
      p_session: session,
      p_category_id: await categoryId(),
      p_description: "Window latch broken",
    });
    const id = (data as { id: string }).id;
    await staff.client.rpc("set_complaint_status", { p_complaint_id: id, p_status: "resolved" });
    await admin
      .from("complaints")
      .update({ resolved_at: new Date(Date.now() - 4 * 86_400_000).toISOString() })
      .eq("id", id);
    await sql`select private.close_unconfirmed_complaints()`;
    const { data: row } = await admin.from("complaints").select("status").eq("id", id).single();
    expect(row?.status).toBe("closed");
    const { data: event } = await admin
      .from("complaint_events")
      .select("note, actor_name")
      .eq("complaint_id", id)
      .eq("to_status", "closed")
      .single();
    expect(event).toEqual({
      note: "Closed automatically: no answer from the resident in 3 days",
      actor_name: "Automatic",
    });
  });

  it("limits a resident to five complaints a day", async () => {
    const { token, phone } = await residentInRoom();
    const session = await signedIn(token, phone);
    for (let i = 0; i < 5; i += 1) {
      const { error } = await admin.rpc("resident_raise_complaint", {
        p_session: session,
        p_category_id: await categoryId(),
        p_description: `Problem number ${i + 1}`,
      });
      expect(error).toBeNull();
    }
    const { error } = await admin.rpc("resident_raise_complaint", {
      p_session: session,
      p_category_id: await categoryId(),
      p_description: "One more problem",
    });
    expect(error?.hint).toBe("resident_complaint_limit");
  });
});
