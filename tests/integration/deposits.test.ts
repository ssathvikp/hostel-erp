import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { todayIst } from "@/lib/validation";

import { residentRow } from "../support/residents";
import { createUserFactory, type TestUser } from "../support/supabase";

/**
 * Security deposit ledger (EP-12), as real signed-in owners and staff:
 * tenant isolation, the held-amount rules and the void rules.
 */
const PERMISSION_DENIED = "42501";
const RAISED = "P0001";
const CHECK_VIOLATION = "23514";

const { admin, createUser, createHostel, cleanup } = createUserFactory();

afterAll(cleanup);

let owner: TestUser;
let staff: TestUser;
let otherOwner: TestUser;
let hostelId: string;

beforeAll(async () => {
  [owner, otherOwner] = await Promise.all([createUser(), createUser()]);
  hostelId = (await createHostel(owner.id)).id;
  await createHostel(otherOwner.id);
  staff = await createUser({ profile: { role: "staff", hostel_id: hostelId } });
});

async function resident(): Promise<string> {
  const { data, error } = await admin
    .from("residents")
    .insert(residentRow(hostelId))
    .select("id")
    .single();
  if (error) throw error;
  return data.id;
}

const today = todayIst();

function entry(
  residentId: string,
  kind: "collected" | "deduction" | "refund",
  amount: number,
  extra: Record<string, unknown> = {},
) {
  return {
    hostel_id: hostelId,
    resident_id: residentId,
    kind,
    amount,
    entry_date: today,
    mode: kind === "deduction" ? null : "upi",
    reason: kind === "deduction" ? "Broken cupboard" : null,
    ...extra,
  };
}

async function held(client: TestUser["client"], residentId: string): Promise<number> {
  const { data, error } = await client
    .from("deposit_balances")
    .select("held")
    .eq("resident_id", residentId)
    .maybeSingle();
  if (error) throw error;
  return data?.held ?? 0;
}

describe("recording deposits", () => {
  it("lets staff collect and refund, and derives what is held", async () => {
    const id = await resident();
    expect(
      (await staff.client.from("deposit_entries").insert(entry(id, "collected", 1000000))).error,
    ).toBeNull();
    expect(
      (await owner.client.from("deposit_entries").insert(entry(id, "deduction", 150000))).error,
    ).toBeNull();
    expect(await held(staff.client, id)).toBe(850000);

    expect(
      (await staff.client.from("deposit_entries").insert(entry(id, "refund", 850000))).error,
    ).toBeNull();
    const { data } = await owner.client
      .from("deposit_balances")
      .select("collected, deducted, refunded, held")
      .eq("resident_id", id)
      .single();
    expect(data).toEqual({ collected: 1000000, deducted: 150000, refunded: 850000, held: 0 });
  });

  it("refuses refunds and deductions beyond what is held", async () => {
    const id = await resident();
    await owner.client.from("deposit_entries").insert(entry(id, "collected", 500000));
    const refund = await owner.client.from("deposit_entries").insert(entry(id, "refund", 500100));
    expect(refund.error?.code).toBe(RAISED);
    expect(refund.error?.hint).toBe("deposit_exceeds_held");
    expect(refund.error?.message).toContain("₹5000.00");

    const none = await resident();
    const deduction = await owner.client
      .from("deposit_entries")
      .insert(entry(none, "deduction", 100));
    expect(deduction.error?.hint).toBe("deposit_exceeds_held");
  });

  it("requires a reason for deductions and a mode only when money moves", async () => {
    const id = await resident();
    await owner.client.from("deposit_entries").insert(entry(id, "collected", 500000));
    const noReason = await owner.client
      .from("deposit_entries")
      .insert(entry(id, "deduction", 1000, { reason: null }));
    expect(noReason.error?.code).toBe(CHECK_VIOLATION);
    const withMode = await owner.client
      .from("deposit_entries")
      .insert(entry(id, "deduction", 1000, { mode: "cash" }));
    expect(withMode.error?.code).toBe(CHECK_VIOLATION);
    const noMode = await owner.client
      .from("deposit_entries")
      .insert(entry(id, "refund", 1000, { mode: null }));
    expect(noMode.error?.code).toBe(CHECK_VIOLATION);
  });

  it("refuses future dates and records who recorded the entry", async () => {
    const id = await resident();
    const future = await owner.client
      .from("deposit_entries")
      .insert(entry(id, "collected", 1000, { entry_date: "2999-01-01" }));
    expect(future.error?.hint).toBe("deposit_future");

    const { data, error } = await staff.client
      .from("deposit_entries")
      .insert(entry(id, "collected", 1000))
      .select("recorded_by, recorded_by_name")
      .single();
    expect(error).toBeNull();
    expect(data?.recorded_by).toBe(staff.id);
    expect(data?.recorded_by_name).toBe("Test User");
  });
});

describe("voiding deposit entries", () => {
  it("is for owners only, needs a reason and happens once", async () => {
    const id = await resident();
    const { data } = await owner.client
      .from("deposit_entries")
      .insert(entry(id, "collected", 200000))
      .select("id")
      .single();

    const byStaff = await staff.client
      .from("deposit_entries")
      .update({ void_reason: "Typo" })
      .eq("id", data!.id)
      .select("id");
    expect(byStaff.data).toEqual([]);

    const edit = await owner.client
      .from("deposit_entries")
      .update({ amount: 1 })
      .eq("id", data!.id);
    expect(edit.error?.code).toBe(PERMISSION_DENIED);

    const voided = await owner.client
      .from("deposit_entries")
      .update({ void_reason: "Entered twice" })
      .eq("id", data!.id)
      .select("voided_at, voided_by")
      .single();
    expect(voided.error).toBeNull();
    expect(voided.data?.voided_by).toBe(owner.id);
    expect(await held(owner.client, id)).toBe(0);

    const again = await owner.client
      .from("deposit_entries")
      .update({ void_reason: "Again" })
      .eq("id", data!.id);
    expect(again.error?.hint).toBe("deposit_void");
  });

  it("will not void a collection that refunds already depend on", async () => {
    const id = await resident();
    const { data } = await owner.client
      .from("deposit_entries")
      .insert(entry(id, "collected", 300000))
      .select("id")
      .single();
    await owner.client.from("deposit_entries").insert(entry(id, "refund", 100000));
    const result = await owner.client
      .from("deposit_entries")
      .update({ void_reason: "Wrong amount" })
      .eq("id", data!.id);
    expect(result.error?.hint).toBe("deposit_in_use");
  });
});

describe("deposit isolation", () => {
  it("hides one hostel's deposits from another owner and refuses their writes", async () => {
    const id = await resident();
    await owner.client.from("deposit_entries").insert(entry(id, "collected", 100000));

    const read = await otherOwner.client.from("deposit_entries").select("id").eq("resident_id", id);
    expect(read.data).toEqual([]);
    const balances = await otherOwner.client
      .from("deposit_balances")
      .select("held")
      .eq("resident_id", id);
    expect(balances.data).toEqual([]);

    const write = await otherOwner.client
      .from("deposit_entries")
      .insert(entry(id, "collected", 100));
    expect(write.error?.code).toBe(PERMISSION_DENIED);
    // A refund is stopped earlier: the guard sees nothing held in a hostel
    // the caller cannot read, so it learns nothing either way.
    const refund = await otherOwner.client.from("deposit_entries").insert(entry(id, "refund", 100));
    expect(refund.error?.hint).toBe("deposit_exceeds_held");

    const total = await otherOwner.client.rpc("deposits_held_total", { p_hostel_id: hostelId });
    expect(total.data).toEqual({ held: 0, residents: 0 });
  });

  it("totals what a hostel holds for its members", async () => {
    const { data, error } = await staff.client.rpc("deposits_held_total", {
      p_hostel_id: hostelId,
    });
    expect(error).toBeNull();
    const total = data as { held: number; residents: number };
    expect(total.held).toBeGreaterThan(0);
    expect(total.residents).toBeGreaterThan(0);
  });
});
