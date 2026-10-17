import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { shiftMonth } from "@/lib/money";
import { todayIst } from "@/lib/validation";

import { connectToDatabase } from "../support/db";
import { residentRow } from "../support/residents";
import { createUserFactory, type TestUser } from "../support/supabase";

/**
 * Database fixes from the full review (docs/review-fixes.md, sections 6 to
 * 13). The race tests open two direct connections and interleave two
 * transactions by hand, so the outcome does not depend on timing luck: the
 * second statement must wait for the first transaction and then see it.
 */
const { admin, createUser, createHostel, cleanup } = createUserFactory();
const one = connectToDatabase();
const two = connectToDatabase();

afterAll(async () => {
  await Promise.all([one.end(), two.end()]);
  await cleanup();
});

let owner: TestUser;
let hostelId: string;
let roomCounter = 0;

beforeAll(async () => {
  owner = await createUser({ fullName: "Review Owner" });
  hostelId = (await createHostel(owner.id)).id;
});

async function resident(overrides: Record<string, unknown> = {}): Promise<string> {
  const { data, error } = await admin
    .from("residents")
    .insert({ ...residentRow(hostelId), ...overrides })
    .select("id")
    .single();
  if (error) throw error;
  return data.id;
}

async function room(capacity = 1): Promise<{ roomId: string; bedIds: string[] }> {
  roomCounter += 1;
  const sharing = capacity === 1 ? "single" : capacity === 2 ? "double" : "triple";
  const { data, error } = await admin
    .from("rooms")
    .insert({
      hostel_id: hostelId,
      room_number: `R${roomCounter}`,
      floor: 1,
      sharing_type: sharing,
      capacity,
    })
    .select("id")
    .single();
  if (error) throw error;
  const { data: beds } = await admin
    .from("beds")
    .select("id")
    .eq("room_id", data.id)
    .order("bed_label");
  return { roomId: data.id, bedIds: beds!.map((bed) => bed.id) };
}

async function allocate(
  residentId: string,
  bedId: string,
  roomId: string,
  start: string,
  end?: string,
) {
  const { data, error } = await admin
    .from("allocations")
    .insert({
      hostel_id: hostelId,
      resident_id: residentId,
      bed_id: bedId,
      room_id: roomId,
      start_date: start,
      end_date: end ?? null,
      vacate_reason: end ? "moved_out" : null,
      created_by: owner.id,
    })
    .select("id")
    .single();
  if (error) throw error;
  return data.id;
}

/** Moves a resident who has left through notice to vacated, as the app does. */
async function markVacated(id: string) {
  for (const status of ["notice", "vacated"]) {
    const { error } = await admin.from("residents").update({ status }).eq("id", id);
    if (error) throw error;
  }
}

/** Runs `second` while `first` holds its transaction open, then commits `first`. */
async function interleave(
  first: (tx: ReturnType<typeof connectToDatabase>) => Promise<unknown>,
  second: (tx: ReturnType<typeof connectToDatabase>) => Promise<unknown>,
) {
  let release!: () => void;
  const held = new Promise<void>((resolve) => (release = resolve));
  let started!: () => void;
  const ready = new Promise<void>((resolve) => (started = resolve));

  const firstDone = one.begin(async (tx) => {
    await first(tx as never);
    started();
    await held;
  });
  await ready;
  let secondSettled = false;
  const secondResult = two
    .begin(async (tx) => second(tx as never))
    .then(
      (value) => ({ ok: true as const, value }),
      (error: { message?: string; hint?: string }) => ({ ok: false as const, error }),
    )
    .finally(() => {
      secondSettled = true;
    });
  // Give the second transaction time to run; with the fix it must be waiting.
  await new Promise((resolve) => setTimeout(resolve, 300));
  const waited = !secondSettled;
  release();
  await firstDone;
  return { waited, result: await secondResult };
}

describe("6. voiding an invoice while a payment is recorded", () => {
  it("waits for the payment and then refuses the void", async () => {
    const id = await resident();
    const { data: invoice, error } = await admin
      .from("invoices")
      .insert({
        hostel_id: hostelId,
        resident_id: id,
        period_month: shiftMonth(todayIst(), -1),
        amount: 500000,
        due_date: shiftMonth(todayIst(), -1),
        breakdown: [],
      })
      .select("id")
      .single();
    if (error) throw error;

    const { waited, result } = await interleave(
      (tx) =>
        tx`insert into public.payments (hostel_id, invoice_id, amount, paid_at, mode, recorded_by)
           values (${hostelId}, ${invoice.id}, 100000, ${todayIst()}, 'cash', ${owner.id})`,
      (tx) =>
        tx`update public.invoices set status = 'void', void_reason = 'mistake' where id = ${invoice.id}`,
    );
    expect(waited).toBe(true);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.hint).toBe("invoice_has_payments");
  });
});

describe("10. allocating at the same moment as changing the room or resident", () => {
  it("does not archive a room whose bed is being allocated", async () => {
    const id = await resident();
    const { roomId, bedIds } = await room(1);
    const { waited, result } = await interleave(
      async (tx) => {
        await tx`select 1 from public.beds where id = ${bedIds[0]} for share`;
        await tx`insert into public.allocations (hostel_id, resident_id, bed_id, room_id, start_date, created_by)
                 values (${hostelId}, ${id}, ${bedIds[0]}, ${roomId}, ${todayIst()}, ${owner.id})`;
      },
      (tx) => tx`update public.rooms set status = 'archived' where id = ${roomId}`,
    );
    expect(waited).toBe(true);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.hint).toBe("room_occupied");
  });

  it("does not shrink a room by retiring a bed being allocated", async () => {
    const id = await resident();
    const { roomId, bedIds } = await room(2);
    // Bed B is the one a shrink would retire first.
    const { waited, result } = await interleave(
      async (tx) => {
        await tx`select 1 from public.beds where id = ${bedIds[1]} for share`;
        await tx`insert into public.allocations (hostel_id, resident_id, bed_id, room_id, start_date, created_by)
                 values (${hostelId}, ${id}, ${bedIds[1]}, ${roomId}, ${todayIst()}, ${owner.id})`;
      },
      (tx) =>
        tx`update public.rooms set capacity = 1, sharing_type = 'single' where id = ${roomId}`,
    );
    expect(waited).toBe(true);
    expect(result.ok).toBe(true);
    const { data: beds } = await admin
      .from("beds")
      .select("id, archived_at")
      .eq("room_id", roomId)
      .order("bed_label");
    // The vacant bed A was retired instead, never the occupied bed B.
    expect(beds!.map((bed) => bed.archived_at !== null)).toEqual([true, false]);
  });

  it("does not give a bed to a resident being marked vacated", async () => {
    const id = await resident({ status: "notice" });
    const { roomId, bedIds } = await room(1);
    const { waited, result } = await interleave(
      (tx) => tx`update public.residents set status = 'vacated' where id = ${id}`,
      (tx) =>
        tx`insert into public.allocations (hostel_id, resident_id, bed_id, room_id, start_date, created_by)
           values (${hostelId}, ${id}, ${bedIds[0]}, ${roomId}, ${todayIst()}, ${owner.id})`,
    );
    expect(waited).toBe(true);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.hint).toBe("resident_not_allocatable");
  });
});

describe("7. erasing before the last stay is billed", () => {
  const lastMonth = shiftMonth(todayIst(), -1);
  const thisMonth = shiftMonth(todayIst(), 0);

  async function billedFormerResident() {
    await owner.client.rpc("set_fee_structure", {
      p_hostel_id: hostelId,
      p_sharing_type: "single",
      p_monthly_amount: 600000,
      p_effective_from: shiftMonth(todayIst(), -6),
    });
    const id = await resident();
    const { roomId, bedIds } = await room(1);
    // Last month in full, then the first night of this month; then left.
    await allocate(id, bedIds[0], roomId, lastMonth, thisMonth);
    await markVacated(id);
    const { data: invoice } = await admin
      .from("invoices")
      .insert({
        hostel_id: hostelId,
        resident_id: id,
        period_month: lastMonth,
        amount: 600000,
        due_date: lastMonth,
        breakdown: [],
      })
      .select("id")
      .single();
    await admin.from("payments").insert({
      hostel_id: hostelId,
      invoice_id: invoice!.id,
      amount: 600000,
      paid_at: todayIst(),
      mode: "cash",
      recorded_by: owner.id,
    });
    return id;
  }

  it("refuses while the last month is unbilled, then allows it once billed and paid", async () => {
    const id = await billedFormerResident();
    const refused = await owner.client.rpc("erase_resident", {
      p_resident_id: id,
      p_reason: "Asked",
    });
    expect(refused.error?.hint).toBe("erase_month_unbilled");

    await owner.client.rpc("generate_invoices", {
      p_hostel_id: hostelId,
      p_period_month: thisMonth,
    });
    const { data: invoice } = await admin
      .from("invoice_balances")
      .select("id, balance")
      .eq("resident_id", id)
      .eq("period_month", thisMonth)
      .single();
    await admin.from("payments").insert({
      hostel_id: hostelId,
      invoice_id: invoice!.id!,
      amount: invoice!.balance!,
      paid_at: todayIst(),
      mode: "cash",
      recorded_by: owner.id,
    });
    const erased = await owner.client.rpc("erase_resident", {
      p_resident_id: id,
      p_reason: "Asked",
    });
    expect(erased.error).toBeNull();
  });

  it("never bills an erased resident", async () => {
    const id = await resident();
    const { roomId, bedIds } = await room(1);
    await allocate(id, bedIds[0], roomId, thisMonth, thisMonth);
    await markVacated(id);
    await admin.from("residents").update({ erased_at: new Date().toISOString() }).eq("id", id);
    await owner.client.rpc("generate_invoices", {
      p_hostel_id: hostelId,
      p_period_month: thisMonth,
    });
    const { data } = await admin.from("invoices").select("id").eq("resident_id", id);
    expect(data).toEqual([]);
  });
});

describe("8. erased residents and references to other residents", () => {
  it("refuses new deposits and reminders for an erased resident", async () => {
    const id = await resident({ status: "vacated", erased_at: new Date().toISOString() });
    const deposit = await owner.client.from("deposit_entries").insert({
      hostel_id: hostelId,
      resident_id: id,
      kind: "collected",
      amount: 1000,
      entry_date: todayIst(),
      mode: "cash",
    });
    expect(deposit.error?.hint).toBe("resident_erased");
    const reminder = await owner.client.from("reminder_log").insert({
      hostel_id: hostelId,
      resident_id: id,
      kind: "due",
      channel: "whatsapp",
      amount: 1000,
    });
    expect(reminder.error?.hint).toBe("resident_erased");
  });

  it("refuses a deposit tied to another resident's stay", async () => {
    const [mine, theirs] = [await resident(), await resident()];
    const { roomId, bedIds } = await room(1);
    const allocationId = await allocate(theirs, bedIds[0], roomId, todayIst());
    const { error } = await owner.client.from("deposit_entries").insert({
      hostel_id: hostelId,
      resident_id: mine,
      allocation_id: allocationId,
      kind: "collected",
      amount: 1000,
      entry_date: todayIst(),
      mode: "cash",
    });
    expect(error?.hint).toBe("reference_other_resident");
  });
});

describe("9. deposit totals above ₹2.15 crore", () => {
  it("adds up and refunds without overflowing", async () => {
    const id = await resident();
    const entries = Array.from({ length: 25 }, () => ({
      hostel_id: hostelId,
      resident_id: id,
      kind: "collected",
      amount: 100000000,
      entry_date: todayIst(),
      mode: "bank_transfer",
      recorded_by: owner.id,
    }));
    expect((await admin.from("deposit_entries").insert(entries)).error).toBeNull();
    const { data, error } = await owner.client.rpc("deposits_held_total", {
      p_hostel_id: hostelId,
    });
    expect(error).toBeNull();
    expect((data as { held: number }).held).toBeGreaterThanOrEqual(2_500_000_000);
    const refund = await owner.client.from("deposit_entries").insert({
      hostel_id: hostelId,
      resident_id: id,
      kind: "refund",
      amount: 100000000,
      entry_date: todayIst(),
      mode: "bank_transfer",
    });
    expect(refund.error).toBeNull();
  });

  it("caps a single entry at ₹10 lakh", async () => {
    const id = await resident();
    const { error } = await owner.client.from("deposit_entries").insert({
      hostel_id: hostelId,
      resident_id: id,
      kind: "collected",
      amount: 100000001,
      entry_date: todayIst(),
      mode: "cash",
    });
    expect(error?.code).toBe("23514");
  });
});

describe("12 and 13. suspension and the month filter", () => {
  it("stops an owner editing a suspended hostel", async () => {
    const other = await createHostel(owner.id, {
      status: "suspended",
      suspension_reason: "Unpaid",
    });
    const { data } = await owner.client
      .from("hostels")
      .update({ phone: "9000000000" })
      .eq("id", other.id)
      .select("id");
    expect(data).toEqual([]);
  });

  it("lists only months with issued invoices", async () => {
    const id = await resident();
    const month = shiftMonth(todayIst(), -5);
    await admin.from("invoices").insert({
      hostel_id: hostelId,
      resident_id: id,
      period_month: month,
      amount: 1000,
      due_date: month,
      breakdown: [],
      status: "void",
      void_reason: "test",
      voided_at: new Date().toISOString(),
    });
    const { data } = await owner.client.rpc("billed_months", { p_hostel_id: hostelId });
    expect(data).not.toContain(month);
  });
});
