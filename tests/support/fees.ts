import { todayIst } from "@/lib/validation";

import { residentRow } from "./residents";
import type { Client, TestUser } from "./supabase";

/** First day of the month `offset` months from the current month in India. */
export function monthStart(offset = 0): string {
  const [year, month] = todayIst().split("-").map(Number);
  return new Date(Date.UTC(year, month - 1 + offset, 1)).toISOString().slice(0, 10);
}

export function daysIn(month: string): number {
  const [year, m] = month.split("-").map(Number);
  return new Date(Date.UTC(year, m, 0)).getUTCDate();
}

/** `YYYY-MM-DD` for day `day` of the month starting at `month`. */
export function dayOf(month: string, day: number): string {
  return `${month.slice(0, 8)}${String(day).padStart(2, "0")}`;
}

/** `YYYY-MM-DD`, `days` from today in India (negative for the past). */
export function daysFromToday(days: number): string {
  const date = new Date(`${todayIst()}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

/** Part-month charge as documented: rate x nights / days, to the nearest rupee. */
export function prorate(sum: number, days: number): number {
  return Math.round(sum / days / 100) * 100;
}

export interface FeeSummary {
  created: number;
  total_amount: number;
  already_invoiced: number;
  unpriced: { resident_id: string; full_name: string }[];
}

type SharingType = "single" | "double" | "triple" | "four_plus";

/**
 * Fixture builders for fee tests: rooms, residents and stays written with
 * the service role (past dates allowed), and rates and invoices through the
 * owner's own client, as the app does.
 */
export function feeFixtures(admin: Client, owner: () => TestUser) {
  let roomCounter = 0;

  async function resident(hostelId: string, overrides: Record<string, unknown> = {}) {
    const { data, error } = await admin
      .from("residents")
      .insert(residentRow(hostelId, overrides))
      .select("id")
      .single();
    if (error) throw error;
    return data.id;
  }

  async function bed(hostelId: string, sharing: SharingType = "single"): Promise<string> {
    roomCounter += 1;
    const capacity = { single: 1, double: 2, triple: 3, four_plus: 4 }[sharing];
    const { data, error } = await admin
      .from("rooms")
      .insert({
        hostel_id: hostelId,
        room_number: `X${roomCounter}`,
        floor: 1,
        sharing_type: sharing,
        capacity,
      })
      .select("id")
      .single();
    if (error) throw error;
    const { data: beds } = await admin.from("beds").select("id").eq("room_id", data.id).limit(1);
    return beds![0].id;
  }

  async function stay(
    hostelId: string,
    residentId: string,
    bedId: string,
    start: string,
    { end = null, rentOverride = null }: { end?: string | null; rentOverride?: number | null } = {},
  ): Promise<string> {
    const { data: bedRow } = await admin.from("beds").select("room_id").eq("id", bedId).single();
    const { data, error } = await admin
      .from("allocations")
      .insert({
        hostel_id: hostelId,
        resident_id: residentId,
        bed_id: bedId,
        room_id: bedRow!.room_id,
        start_date: start,
        end_date: end,
        vacate_reason: end ? "moved_out" : null,
        rent_override: rentOverride,
        created_by: owner().id,
      })
      .select("id")
      .single();
    if (error) throw error;
    return data.id;
  }

  function setRate(hostelId: string, sharing: SharingType, amount: number, from: string) {
    return owner().client.rpc("set_fee_structure", {
      p_hostel_id: hostelId,
      p_sharing_type: sharing,
      p_monthly_amount: amount,
      p_effective_from: from,
    });
  }

  async function generate(hostelId: string, month: string, dueDay = 5, user = owner()) {
    const { data, error } = await user.client.rpc("generate_invoices", {
      p_hostel_id: hostelId,
      p_period_month: month,
      p_due_day: dueDay,
    });
    return { summary: data as unknown as FeeSummary | null, error };
  }

  async function invoiceFor(residentId: string, month: string) {
    const { data, error } = await admin
      .from("invoices")
      .select(
        "id, amount, number, status, invoice_lines(position, kind, description, amount, detail)",
      )
      .eq("resident_id", residentId)
      .eq("period_month", month)
      .eq("status", "issued")
      .order("position", { referencedTable: "invoice_lines" })
      .maybeSingle();
    if (error) throw error;
    return data;
  }

  /** A resident billed a full month of `rent` in a single room, last month. */
  async function billedResident(hostelId: string, rent = 1000000) {
    await setRate(hostelId, "single", rent, monthStart(-12));
    const residentId = await resident(hostelId);
    await stay(hostelId, residentId, await bed(hostelId), monthStart(-2));
    return residentId;
  }

  return { resident, bed, stay, setRate, generate, invoiceFor, billedResident };
}
