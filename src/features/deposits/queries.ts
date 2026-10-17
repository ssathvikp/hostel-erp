import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import type { Database } from "@/types/database";
import type { DepositEntryKind, PaymentMode } from "@/types";

import { isDepositKind } from "./options";

export interface DepositBalance {
  collected: number;
  deducted: number;
  refunded: number;
  held: number;
}

export interface DepositEntry {
  id: string;
  kind: DepositEntryKind;
  amount: number;
  entryDate: string;
  mode: PaymentMode | null;
  reference: string | null;
  reason: string | null;
  recordedByName: string | null;
  voidedAt: string | null;
  voidReason: string | null;
}

export const EMPTY_DEPOSIT: DepositBalance = { collected: 0, deducted: 0, refunded: 0, held: 0 };

/** A resident's deposit: what is held now and every entry, newest first. */
export async function getResidentDeposit(
  supabase: SupabaseClient<Database>,
  hostelId: string,
  residentId: string,
): Promise<{ balance: DepositBalance; entries: DepositEntry[] }> {
  const [balance, entries] = await Promise.all([
    supabase
      .from("deposit_balances")
      .select("collected, deducted, refunded, held")
      .eq("hostel_id", hostelId)
      .eq("resident_id", residentId)
      .maybeSingle(),
    supabase
      .from("deposit_entries")
      .select(
        "id, kind, amount, entry_date, mode, reference, reason, recorded_by_name, voided_at, void_reason",
      )
      .eq("hostel_id", hostelId)
      .eq("resident_id", residentId)
      .order("entry_date", { ascending: false })
      .order("created_at", { ascending: false }),
  ]);
  if (balance.error) throw balance.error;
  if (entries.error) throw entries.error;

  return {
    balance: {
      collected: balance.data?.collected ?? 0,
      deducted: balance.data?.deducted ?? 0,
      refunded: balance.data?.refunded ?? 0,
      held: balance.data?.held ?? 0,
    },
    entries: entries.data
      .filter((row) => isDepositKind(row.kind))
      .map((row) => ({
        id: row.id,
        kind: row.kind as DepositEntryKind,
        amount: row.amount,
        entryDate: row.entry_date,
        mode: row.mode as PaymentMode | null,
        reference: row.reference,
        reason: row.reason,
        recordedByName: row.recorded_by_name,
        voidedAt: row.voided_at,
        voidReason: row.void_reason,
      })),
  };
}
