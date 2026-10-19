import "server-only";

import type { createClient } from "@/lib/supabase/server";
import { todayIst } from "@/lib/validation";
import type { SharingType } from "@/types";

type Supabase = Awaited<ReturnType<typeof createClient>>;

// ---------------------------------------------------------------------------
// Fee heads (ClickUp E13-T1)
// ---------------------------------------------------------------------------

export interface FeeHeadPrice {
  id: string;
  /** Null: one price for every sharing type. */
  sharingType: SharingType | null;
  amount: number;
  effectiveFrom: string;
  effectiveTo: string | null;
}

export interface FeeHead {
  id: string;
  name: string;
  kind: "monthly" | "one_time";
  onFirstAllocation: boolean;
  /** Prices in force today. */
  current: FeeHeadPrice[];
  /** Prices that start after today. */
  upcoming: FeeHeadPrice[];
}

/** The hostel's fee heads that are in use, with today's and upcoming prices. */
export async function getFeeHeads(supabase: Supabase, hostelId: string): Promise<FeeHead[]> {
  const today = todayIst();
  const [{ data: heads, error }, { data: prices, error: pricesError }] = await Promise.all([
    supabase
      .from("fee_heads")
      .select("id, name, kind, on_first_allocation")
      .eq("hostel_id", hostelId)
      .is("archived_at", null)
      .order("created_at"),
    supabase
      .from("fee_head_prices")
      .select("id, head_id, sharing_type, amount, effective_from, effective_to")
      .eq("hostel_id", hostelId)
      .order("effective_from"),
  ]);
  if (error) throw error;
  if (pricesError) throw pricesError;
  return (heads ?? []).map((head) => {
    const own = (prices ?? [])
      .filter((price) => price.head_id === head.id)
      .map((price) => ({
        id: price.id,
        sharingType: price.sharing_type as SharingType | null,
        amount: price.amount,
        effectiveFrom: price.effective_from,
        effectiveTo: price.effective_to,
      }));
    return {
      id: head.id,
      name: head.name,
      kind: head.kind as FeeHead["kind"],
      onFirstAllocation: head.on_first_allocation,
      current: own.filter(
        (price) =>
          price.effectiveFrom <= today && (!price.effectiveTo || price.effectiveTo >= today),
      ),
      upcoming: own.filter((price) => price.effectiveFrom > today),
    };
  });
}

// ---------------------------------------------------------------------------
// A resident's charges, discounts and opt-outs (ClickUp E13-T2, E13-T5)
// ---------------------------------------------------------------------------

export interface ChargeRow {
  id: string;
  description: string;
  category: string;
  amount: number;
  chargeDate: string;
  invoiceId: string | null;
  voidedAt: string | null;
  voidReason: string | null;
}

export interface DiscountRow {
  id: string;
  headName: string | null;
  kind: "percent" | "fixed";
  value: number;
  fromMonth: string;
  toMonth: string | null;
  reason: string;
  voidedAt: string | null;
  voidReason: string | null;
}

export async function getResidentCharges(supabase: Supabase, hostelId: string, residentId: string) {
  const [charges, discounts] = await Promise.all([
    supabase
      .from("resident_charges")
      .select("id, description, category, amount, charge_date, invoice_id, voided_at, void_reason")
      .eq("hostel_id", hostelId)
      .eq("resident_id", residentId)
      .order("charge_date", { ascending: false })
      .order("created_at", { ascending: false })
      .limit(50),
    supabase
      .from("resident_discounts")
      .select(
        "id, kind, value, from_month, to_month, reason, voided_at, void_reason, fee_heads!resident_discounts_head_fkey(name)",
      )
      .eq("hostel_id", hostelId)
      .eq("resident_id", residentId)
      .order("created_at", { ascending: false }),
  ]);
  if (charges.error) throw charges.error;
  if (discounts.error) throw discounts.error;
  return {
    charges: (charges.data ?? []).map((row): ChargeRow => ({
      id: row.id,
      description: row.description,
      category: row.category,
      amount: row.amount,
      chargeDate: row.charge_date,
      invoiceId: row.invoice_id,
      voidedAt: row.voided_at,
      voidReason: row.void_reason,
    })),
    discounts: (discounts.data ?? []).map((row): DiscountRow => ({
      id: row.id,
      headName: row.fee_heads?.name ?? null,
      kind: row.kind as DiscountRow["kind"],
      value: row.value,
      fromMonth: row.from_month,
      toMonth: row.to_month,
      reason: row.reason,
      voidedAt: row.voided_at,
      voidReason: row.void_reason,
    })),
  };
}

/** Monthly heads a stay has opted out of. */
export async function getOptOuts(supabase: Supabase, allocationId: string): Promise<string[]> {
  const { data, error } = await supabase
    .from("allocation_fee_opt_outs")
    .select("head_id")
    .eq("allocation_id", allocationId);
  if (error) throw error;
  return (data ?? []).map((row) => row.head_id);
}

// ---------------------------------------------------------------------------
// Electricity (ClickUp E13-T3)
// ---------------------------------------------------------------------------

export interface MeterRoom {
  roomId: string;
  roomNumber: string;
  floor: number;
  /** This month's reading, if taken. */
  reading: number | null;
  /** The latest earlier reading, and its month. */
  previous: { month: string; reading: number } | null;
  billed: { units: number; amount: number } | null;
}

export async function getMeterRooms(
  supabase: Supabase,
  hostelId: string,
  month: string,
): Promise<MeterRoom[]> {
  const [rooms, readings, bills] = await Promise.all([
    supabase
      .from("rooms")
      .select("id, room_number, floor")
      .eq("hostel_id", hostelId)
      .eq("status", "active")
      .order("floor")
      .order("room_number"),
    supabase
      .from("room_meter_readings")
      .select("room_id, reading_month, reading")
      .eq("hostel_id", hostelId)
      .lte("reading_month", month)
      .order("reading_month", { ascending: false }),
    supabase
      .from("electricity_bills")
      .select("room_id, units, amount")
      .eq("hostel_id", hostelId)
      .eq("period_month", month),
  ]);
  for (const result of [rooms, readings, bills]) if (result.error) throw result.error;
  return (rooms.data ?? [])
    .map((room) => {
      const own = (readings.data ?? []).filter((row) => row.room_id === room.id);
      const current = own.find((row) => row.reading_month === month);
      const previous = own.find((row) => row.reading_month < month);
      const bill = (bills.data ?? []).find((row) => row.room_id === room.id);
      return {
        roomId: room.id,
        roomNumber: room.room_number,
        floor: room.floor,
        reading: current ? Number(current.reading) : null,
        previous: previous
          ? { month: previous.reading_month, reading: Number(previous.reading) }
          : null,
        billed: bill ? { units: Number(bill.units), amount: bill.amount } : null,
      };
    })
    .sort(
      (a, b) =>
        a.floor - b.floor || a.roomNumber.localeCompare(b.roomNumber, undefined, { numeric: true }),
    );
}

export async function getElectricityRate(supabase: Supabase, hostelId: string) {
  const { data, error } = await supabase
    .from("hostels")
    .select("electricity_unit_rate")
    .eq("id", hostelId)
    .single();
  if (error) throw error;
  return data.electricity_unit_rate;
}
