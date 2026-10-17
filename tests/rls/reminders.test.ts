import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { residentRow } from "../support/residents";
import { createUserFactory, type TestUser } from "../support/supabase";

/**
 * Reminder log and reminder wording (EP-11): members of a hostel record
 * their own sends and read the hostel's log; nobody edits or deletes it,
 * and other hostels see nothing.
 */
const PERMISSION_DENIED = "42501";

const { admin, createUser, createHostel, cleanup } = createUserFactory();

afterAll(cleanup);

let owner: TestUser;
let staff: TestUser;
let otherOwner: TestUser;
let hostelId: string;
let residentId: string;

beforeAll(async () => {
  [owner, otherOwner] = await Promise.all([createUser(), createUser()]);
  hostelId = (await createHostel(owner.id)).id;
  await createHostel(otherOwner.id);
  staff = await createUser({
    fullName: "Warden Ravi",
    profile: { role: "staff", hostel_id: hostelId },
  });
  const { data, error } = await admin
    .from("residents")
    .insert(residentRow(hostelId))
    .select("id")
    .single();
  if (error) throw error;
  residentId = data.id;
});

const send = () => ({
  hostel_id: hostelId,
  resident_id: residentId,
  kind: "due",
  channel: "whatsapp",
  amount: 750000,
});

describe("reminder log", () => {
  it("records who sent a reminder, as the sender", async () => {
    const { data, error } = await staff.client
      .from("reminder_log")
      .insert(send())
      .select("sent_by, sent_by_name")
      .single();
    expect(error).toBeNull();
    expect(data).toEqual({ sent_by: staff.id, sent_by_name: "Warden Ravi" });

    const forged = await staff.client.from("reminder_log").insert({ ...send(), sent_by: owner.id });
    expect(forged.error?.code).toBe(PERMISSION_DENIED);
  });

  it("shows the latest reminder per resident to members", async () => {
    await owner.client.from("reminder_log").insert({ ...send(), channel: "copy" });
    const { data } = await staff.client
      .from("last_reminders")
      .select("resident_id, channel")
      .eq("resident_id", residentId);
    expect(data).toEqual([{ resident_id: residentId, channel: "copy" }]);
  });

  it("cannot be edited or deleted", async () => {
    const update = await owner.client
      .from("reminder_log")
      .update({ amount: 1 })
      .eq("resident_id", residentId);
    expect(update.error?.code).toBe(PERMISSION_DENIED);
    const remove = await owner.client.from("reminder_log").delete().eq("resident_id", residentId);
    expect(remove.error?.code).toBe(PERMISSION_DENIED);
  });

  it("is invisible and closed to other hostels", async () => {
    const read = await otherOwner.client.from("reminder_log").select("id");
    expect(read.data).toEqual([]);
    const latest = await otherOwner.client.from("last_reminders").select("resident_id");
    expect(latest.data).toEqual([]);
    const write = await otherOwner.client.from("reminder_log").insert(send());
    expect(write.error?.code).toBe(PERMISSION_DENIED);
  });
});

describe("reminder wording", () => {
  it("is set by the owner only", async () => {
    const byOwner = await owner.client
      .from("hostels")
      .update({ reminder_template: "Hi {name}, {amount} is due." })
      .eq("id", hostelId)
      .select("reminder_template")
      .single();
    expect(byOwner.data?.reminder_template).toBe("Hi {name}, {amount} is due.");

    const byStaff = await staff.client
      .from("hostels")
      .update({ reminder_template: "Pay now" })
      .eq("id", hostelId)
      .select("id");
    expect(byStaff.data).toEqual([]);
  });

  it("refuses blank or very long text", async () => {
    for (const reminder_template of ["   ", "x".repeat(1001)]) {
      const { error } = await owner.client
        .from("hostels")
        .update({ reminder_template })
        .eq("id", hostelId);
      expect(error?.code).toBe("23514");
    }
  });
});
