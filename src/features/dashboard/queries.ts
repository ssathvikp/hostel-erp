import "server-only";

import type { AllocationEventAction } from "@/features/allocations/options";
import type { createClient } from "@/lib/supabase/server";
import type { PaymentMode } from "@/types";

import type { DashboardRange } from "./range";

type Supabase = Awaited<ReturnType<typeof createClient>>;

// ---------------------------------------------------------------------------
// Money for the range (E8-T1, E8-T4)
// ---------------------------------------------------------------------------

export interface DashboardMoney {
  /** Live payments received in the range. */
  collected: number;
  payments: number;
  /** Issued invoices for billing months starting in the range. */
  billed: number;
  invoices: number;
  /** Still owed today, whatever the range; matches the fee list. */
  outstanding: number;
  overdue: number;
  overdueResidents: number;
}

export async function getDashboardMoney(
  supabase: Supabase,
  hostelId: string,
  range: DashboardRange,
): Promise<DashboardMoney> {
  const { data, error } = await supabase.rpc("dashboard_money", {
    p_hostel_id: hostelId,
    p_from: range.from,
    p_to: range.to,
  });
  if (error) throw error;
  const row = data?.[0];
  return {
    collected: row?.collected ?? 0,
    payments: row?.payments ?? 0,
    billed: row?.billed ?? 0,
    invoices: row?.invoices ?? 0,
    outstanding: row?.outstanding ?? 0,
    overdue: row?.overdue ?? 0,
    overdueResidents: row?.overdue_residents ?? 0,
  };
}

// ---------------------------------------------------------------------------
// Security deposits held (EP-12)
// ---------------------------------------------------------------------------

export interface DepositsHeld {
  /** Paise held today across the hostel. */
  held: number;
  /** Residents whose deposit is not fully settled. */
  residents: number;
}

export async function getDepositsHeld(supabase: Supabase, hostelId: string): Promise<DepositsHeld> {
  const { data, error } = await supabase.rpc("deposits_held_total", { p_hostel_id: hostelId });
  if (error) throw error;
  const row = (data ?? {}) as Partial<DepositsHeld>;
  return { held: row.held ?? 0, residents: row.residents ?? 0 };
}

// ---------------------------------------------------------------------------
// Occupancy trend (E8-T2)
// ---------------------------------------------------------------------------

export interface TrendPoint {
  /** Day, or first day of the month. */
  bucket: string;
  days: number;
  totalBeds: number;
  occupiedBeds: number;
  percent: number;
}

export async function getOccupancyTrend(
  supabase: Supabase,
  hostelId: string,
  range: DashboardRange,
): Promise<TrendPoint[]> {
  const { data, error } = await supabase.rpc("occupancy_trend", {
    p_hostel_id: hostelId,
    p_from: range.from,
    p_to: range.to,
    p_granularity: range.granularity,
  });
  if (error) throw error;
  return (data ?? []).map((row) => ({
    bucket: row.bucket,
    days: row.days,
    totalBeds: Number(row.total_beds),
    occupiedBeds: Number(row.occupied_beds),
    percent: Number(row.occupancy_percent),
  }));
}

// ---------------------------------------------------------------------------
// Recent activity (E8-T3)
// ---------------------------------------------------------------------------

export type ActivityItem =
  | {
      kind: "allocation";
      id: string;
      at: string;
      action: AllocationEventAction;
      residentId: string;
      residentName: string;
      bedLabel: string;
    }
  | {
      kind: "payment";
      id: string;
      at: string;
      amount: number;
      mode: PaymentMode;
      invoiceId: string;
      residentId: string;
      residentName: string;
    };

/** The latest allocation changes and payments, newest first. */
export async function getRecentActivity(
  supabase: Supabase,
  hostelId: string,
  limit = 8,
): Promise<ActivityItem[]> {
  const [{ data: events, error }, { data: payments, error: paymentsError }] = await Promise.all([
    supabase
      .from("allocation_events")
      .select(
        "id, action, created_at, resident_id, residents!allocation_events_resident_fkey(full_name), beds!allocation_events_bed_fkey(bed_label)",
      )
      .eq("hostel_id", hostelId)
      .order("created_at", { ascending: false })
      .limit(limit),
    supabase
      .from("payments")
      .select(
        "id, amount, mode, created_at, invoice_id, invoices!payments_invoice_fkey(resident_id, residents!invoices_resident_fkey(full_name))",
      )
      .eq("hostel_id", hostelId)
      .is("voided_at", null)
      .order("created_at", { ascending: false })
      .limit(limit),
  ]);
  if (error) throw error;
  if (paymentsError) throw paymentsError;

  const items: ActivityItem[] = [
    ...(events ?? []).map((event): ActivityItem => ({
      kind: "allocation",
      id: `event-${event.id}`,
      at: event.created_at,
      action: event.action as AllocationEventAction,
      residentId: event.resident_id,
      residentName: event.residents?.full_name ?? "",
      bedLabel: event.beds?.bed_label ?? "",
    })),
    ...(payments ?? []).map((payment): ActivityItem => ({
      kind: "payment",
      id: `payment-${payment.id}`,
      at: payment.created_at,
      amount: payment.amount,
      mode: payment.mode as PaymentMode,
      invoiceId: payment.invoice_id,
      residentId: payment.invoices?.resident_id ?? "",
      residentName: payment.invoices?.residents?.full_name ?? "",
    })),
  ];
  return items.sort((a, b) => b.at.localeCompare(a.at)).slice(0, limit);
}

// ---------------------------------------------------------------------------
// Overdue residents (E8-T3)
// ---------------------------------------------------------------------------

export interface OverdueResident {
  residentId: string;
  name: string;
  phone: string;
  overdue: number;
  oldestDueDate: string;
  /** When they were last sent a fee reminder (EP-11), if ever. */
  lastRemindedAt: string | null;
}

/** Residents with overdue money, largest amount first, and how many there are in all. */
export async function getOverdueResidents(
  supabase: Supabase,
  hostelId: string,
  limit = 8,
): Promise<{ residents: OverdueResident[]; total: number }> {
  const {
    data: balances,
    count,
    error,
  } = await supabase
    .from("resident_balances")
    .select("resident_id, overdue, oldest_overdue_due_date", { count: "exact" })
    .eq("hostel_id", hostelId)
    .gt("overdue", 0)
    .order("overdue", { ascending: false })
    .order("oldest_overdue_due_date")
    .limit(limit);
  if (error) throw error;
  if (!balances?.length) return { residents: [], total: 0 };

  const ids = balances.map((row) => row.resident_id!);
  const [{ data: residents, error: residentsError }, { data: reminders, error: remindersError }] =
    await Promise.all([
      supabase
        .from("residents")
        .select("id, full_name, phone")
        .eq("hostel_id", hostelId)
        .in("id", ids),
      supabase
        .from("last_reminders")
        .select("resident_id, sent_at")
        .eq("hostel_id", hostelId)
        .in("resident_id", ids),
    ]);
  if (residentsError) throw residentsError;
  if (remindersError) throw remindersError;
  const byId = new Map((residents ?? []).map((resident) => [resident.id, resident]));
  const remindedAt = new Map((reminders ?? []).map((row) => [row.resident_id, row.sent_at]));

  return {
    residents: balances.map((row) => ({
      residentId: row.resident_id!,
      name: byId.get(row.resident_id!)?.full_name ?? "",
      phone: byId.get(row.resident_id!)?.phone ?? "",
      overdue: row.overdue ?? 0,
      oldestDueDate: row.oldest_overdue_due_date!,
      lastRemindedAt: remindedAt.get(row.resident_id!) ?? null,
    })),
    total: count ?? balances.length,
  };
}
