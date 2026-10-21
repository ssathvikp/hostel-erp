import "server-only";

import { fetchAll } from "@/lib/pagination";
import type { createClient } from "@/lib/supabase/server";

import type { MoneyIn } from "./reports";

type Supabase = Awaited<ReturnType<typeof createClient>>;

/**
 * Money received between two dates (inclusive): payments in hand (cheques once
 * cleared; credit or deposit applied to an invoice is not new money) and advances kept as
 * credit. Voided entries are left out.
 */
export async function getMoneyIn(
  supabase: Supabase,
  hostelId: string,
  from: string,
  to: string,
): Promise<MoneyIn[]> {
  const [payments, advances] = await Promise.all([
    fetchAll((start, end) =>
      supabase
        .from("payments")
        .select("paid_at, amount, mode, recorded_by, recorded_by_name")
        .eq("hostel_id", hostelId)
        .gte("paid_at", from)
        .lte("paid_at", to)
        .not("mode", "in", "(credit,deposit)")
        .not("cleared_at", "is", null)
        .is("voided_at", null)
        .order("id")
        .range(start, end),
    ),
    fetchAll((start, end) =>
      supabase
        .from("resident_credit_entries")
        .select("entry_date, amount, mode, recorded_by")
        .eq("hostel_id", hostelId)
        .eq("kind", "advance")
        .gte("entry_date", from)
        .lte("entry_date", to)
        .is("voided_at", null)
        .order("id")
        .range(start, end),
    ),
  ]);

  // Advances carry no name snapshot; payments do, and profiles fill the gaps.
  const names = new Map<string, string>();
  for (const payment of payments) {
    if (payment.recorded_by_name) names.set(payment.recorded_by, payment.recorded_by_name);
  }
  const missing = [...new Set(advances.map((entry) => entry.recorded_by))].filter(
    (id) => !names.has(id),
  );
  if (missing.length) {
    const { data, error } = await supabase
      .from("profiles")
      .select("id, full_name")
      .in("id", missing);
    if (error) throw error;
    for (const profile of data) names.set(profile.id, profile.full_name);
  }
  const collector = (id: string, snapshot?: string | null) =>
    snapshot ?? names.get(id) ?? "Former team member";

  return [
    ...payments.map((payment) => ({
      date: payment.paid_at,
      amount: payment.amount,
      mode: payment.mode,
      collector: collector(payment.recorded_by, payment.recorded_by_name),
      type: "payment" as const,
    })),
    ...advances.map((entry) => ({
      date: entry.entry_date,
      amount: entry.amount,
      mode: entry.mode ?? "cash",
      collector: collector(entry.recorded_by),
      type: "advance" as const,
    })),
  ];
}

export interface RegisterRow {
  id: string;
  invoiceNumber: string;
  kind: string;
  periodMonth: string;
  residentName: string;
  room: string;
  amount: number;
  paid: number;
  pendingCheques: number;
  balance: number;
  dueDate: string;
  dueStatus: string;
}

function registerRow(row: {
  id: string | null;
  invoice_number: string | null;
  kind: string | null;
  period_month: string | null;
  resident_name: string | null;
  room_number: string | null;
  bed_label: string | null;
  amount: number | null;
  paid: number | null;
  pending_cheques: number | null;
  balance: number | null;
  due_date: string | null;
  due_status: string | null;
}): RegisterRow {
  return {
    id: row.id ?? "",
    invoiceNumber: row.invoice_number ?? "",
    kind: row.kind ?? "rent",
    periodMonth: row.period_month ?? "",
    residentName: row.resident_name ?? "Resident",
    room: row.room_number ? `${row.room_number}${row.bed_label ? ` / ${row.bed_label}` : ""}` : "",
    amount: row.amount ?? 0,
    paid: row.paid ?? 0,
    pendingCheques: row.pending_cheques ?? 0,
    balance: row.balance ?? 0,
    dueDate: row.due_date ?? "",
    dueStatus: row.due_status ?? "",
  };
}

const REGISTER_COLUMNS =
  "id, invoice_number, kind, period_month, resident_name, room_number, bed_label, amount, paid, pending_cheques, balance, due_date, due_status";

/** Every live invoice for one billing month, by room: the monthly fee register. */
export async function getFeeRegister(supabase: Supabase, hostelId: string, month: string) {
  const rows = await fetchAll((start, end) =>
    supabase
      .from("invoice_balances")
      .select(REGISTER_COLUMNS)
      .eq("hostel_id", hostelId)
      .eq("period_month", month)
      .neq("status", "void")
      .order("room_sort")
      .order("resident_name")
      .order("id")
      .range(start, end),
  );
  return rows.map(registerRow);
}

/** Every live invoice with something still to pay, oldest due date first. */
export async function getOpenDues(supabase: Supabase, hostelId: string) {
  const rows = await fetchAll((start, end) =>
    supabase
      .from("invoice_balances")
      .select(REGISTER_COLUMNS)
      .eq("hostel_id", hostelId)
      .neq("status", "void")
      .gt("balance", 0)
      .order("due_date")
      .order("id")
      .range(start, end),
  );
  return rows.map(registerRow);
}

export interface DiscountRow {
  invoiceId: string;
  invoiceNumber: string;
  residentName: string;
  description: string;
  /** Positive: how much was taken off. */
  amount: number;
}

/** Discounts given on the live invoices of one billing month. */
export async function getDiscounts(
  supabase: Supabase,
  hostelId: string,
  month: string,
): Promise<DiscountRow[]> {
  const rows = await fetchAll((start, end) =>
    supabase
      .from("invoice_lines")
      .select(
        "amount, description, invoice_id, invoices!inner(invoice_number, period_month, status, residents!invoices_resident_fkey(full_name))",
      )
      .eq("hostel_id", hostelId)
      .eq("kind", "discount")
      .eq("invoices.period_month", month)
      .neq("invoices.status", "void")
      .order("id")
      .range(start, end),
  );
  return rows.map((row) => ({
    invoiceId: row.invoice_id,
    invoiceNumber: row.invoices.invoice_number,
    residentName: row.invoices.residents?.full_name ?? "Resident",
    description: row.description,
    amount: -row.amount,
  }));
}
