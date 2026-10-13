import "server-only";

import type { createClient } from "@/lib/supabase/server";
import type { PaymentMode } from "@/types";

type Supabase = Awaited<ReturnType<typeof createClient>>;

export interface CollectionsReport {
  /** Equals the dashboard's "collected" for the same range. */
  total: number;
  count: number;
  byMode: { mode: PaymentMode; amount: number; count: number }[];
  byCollector: { collector: string | null; amount: number; count: number }[];
  days: {
    day: string;
    mode: PaymentMode;
    collector: string | null;
    amount: number;
    count: number;
  }[];
  /** Deposits received in the range: held, never part of the total. */
  deposits: { amount: number; count: number };
}

/** Money received in a range by mode, collector and day (E13-T12). */
export async function getCollections(
  supabase: Supabase,
  hostelId: string,
  from: string,
  to: string,
): Promise<CollectionsReport> {
  const { data, error } = await supabase.rpc("collections_report", {
    p_hostel_id: hostelId,
    p_from: from,
    p_to: to,
  });
  if (error) throw error;
  const report = data as {
    total: number;
    count: number;
    by_mode: CollectionsReport["byMode"];
    by_collector: CollectionsReport["byCollector"];
    days: CollectionsReport["days"];
    deposits: CollectionsReport["deposits"];
  };
  return {
    total: report.total,
    count: report.count,
    byMode: report.by_mode,
    byCollector: report.by_collector,
    days: report.days,
    deposits: report.deposits,
  };
}

export const AGEING_BUCKETS = ["not_due", "d30", "d60", "d90", "over90"] as const;
export type AgeingBucket = (typeof AGEING_BUCKETS)[number];

export const AGEING_LABELS: Record<AgeingBucket, string> = {
  not_due: "Not yet due",
  d30: "Up to 30 days late",
  d60: "31–60 days late",
  d90: "61–90 days late",
  over90: "Over 90 days late",
};

export type AgeingRow = Record<AgeingBucket, number> & {
  residentId: string;
  name: string;
  phone: string;
  total: number;
};

export interface DuesAgeing {
  buckets: Record<AgeingBucket, number>;
  total: number;
  residents: AgeingRow[];
}

/** What is owed, by how long past due, overall and per resident (E13-T12). */
export async function getDuesAgeing(supabase: Supabase, hostelId: string): Promise<DuesAgeing> {
  const { data, error } = await supabase.rpc("dues_ageing", { p_hostel_id: hostelId });
  if (error) throw error;
  const ageing = data as {
    buckets: Record<AgeingBucket, number>;
    total: number;
    residents: (Record<AgeingBucket, number> & {
      resident_id: string;
      name: string;
      phone: string;
      total: number;
    })[];
  };
  return {
    buckets: ageing.buckets,
    total: ageing.total,
    residents: ageing.residents.map(({ resident_id, ...row }) => ({
      residentId: resident_id,
      ...row,
    })),
  };
}
