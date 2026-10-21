import "server-only";

import type { createClient } from "@/lib/supabase/server";

import { toPreview, type SettlementPreview } from "./totals";

type Supabase = Awaited<ReturnType<typeof createClient>>;

/** What settling this stay would do; null when it cannot be settled yet (still open). */
export async function getSettlementPreview(
  supabase: Supabase,
  allocationId: string,
): Promise<SettlementPreview | null> {
  const { data, error } = await supabase.rpc("settlement_preview", {
    p_allocation_id: allocationId,
  });
  if (error) {
    if (["allocation_open", "allocation_not_found", "allocation_transferred"].includes(error.hint))
      return null;
    throw error;
  }
  return toPreview(data as Record<string, unknown>);
}

export interface SavedSettlement {
  id: string;
  netAmount: number;
  settledAt: string;
  settledByName: string | null;
  statement: {
    end_date: string;
    rebilled: {
      voided_invoice_number: string;
      period_month: string;
      billed_rent: number;
      rent: number;
      total: number;
    } | null;
    credit_applied: number;
    deductions: { amount: number; reason: string }[];
    deducted: number;
    paid_from_deposit: number;
    deposit_refund: number;
    credit_refund: number;
    refund_mode: string | null;
    refund_reference: string | null;
    still_owed: number;
    before: { deposit_held: number; credit_held: number };
  };
}

export async function getSettlement(
  supabase: Supabase,
  hostelId: string,
  allocationId: string,
): Promise<SavedSettlement | null> {
  const { data, error } = await supabase
    .from("settlements")
    .select("id, net_amount, settled_at, settled_by_name, statement")
    .eq("hostel_id", hostelId)
    .eq("allocation_id", allocationId)
    .maybeSingle();
  if (error) throw error;
  if (!data) return null;
  return {
    id: data.id,
    netAmount: data.net_amount,
    settledAt: data.settled_at,
    settledByName: data.settled_by_name,
    statement: data.statement as unknown as SavedSettlement["statement"],
  };
}

/** Allocation ids of a resident's stays that have a settlement. */
export async function getSettledStays(supabase: Supabase, hostelId: string, residentId: string) {
  const { data, error } = await supabase
    .from("settlements")
    .select("allocation_id")
    .eq("hostel_id", hostelId)
    .eq("resident_id", residentId);
  if (error) throw error;
  return new Set(data.map((row) => row.allocation_id));
}
