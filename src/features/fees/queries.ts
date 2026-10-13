import "server-only";

import { fetchAllPages, isPastLastPage } from "@/lib/pagination";
import type { createClient } from "@/lib/supabase/server";
import { todayIst } from "@/lib/validation";
import {
  SHARING_TYPES,
  type FeeHeadBilling,
  type FeeHeadPricing,
  type InvoiceDueStatus,
  type InvoiceLine,
  type StayBreakdown,
  type PaymentMode,
  type SharingType,
} from "@/types";

type Supabase = Awaited<ReturnType<typeof createClient>>;

// ---------------------------------------------------------------------------
// Rates (E7-T2)
// ---------------------------------------------------------------------------

export interface RateRow {
  id: string;
  sharingType: SharingType;
  monthlyAmount: number;
  effectiveFrom: string;
  effectiveTo: string | null;
}

export interface RateSummary {
  sharingType: SharingType;
  /** The rate in force today, if any. */
  current: RateRow | null;
  /** A rate that starts after today, if one is set. */
  upcoming: RateRow | null;
  /** Active rooms of this sharing type. */
  rooms: number;
}

/** Every rate, newest first, and a per-type summary of what applies today. */
export async function getRates(supabase: Supabase, hostelId: string) {
  const [{ data, error }, rooms] = await Promise.all([
    supabase
      .from("fee_structures")
      .select("id, sharing_type, monthly_amount, effective_from, effective_to")
      .eq("hostel_id", hostelId)
      .order("sharing_type")
      .order("effective_from", { ascending: false }),
    fetchAllPages((from, to) =>
      supabase
        .from("rooms")
        .select("id, sharing_type")
        .eq("hostel_id", hostelId)
        .eq("status", "active")
        .order("id")
        .range(from, to),
    ),
  ]);
  if (error) throw error;

  const today = todayIst();
  const history: RateRow[] = (data ?? []).map((row) => ({
    id: row.id,
    sharingType: row.sharing_type as SharingType,
    monthlyAmount: row.monthly_amount,
    effectiveFrom: row.effective_from,
    effectiveTo: row.effective_to,
  }));

  const summaries: RateSummary[] = SHARING_TYPES.map((sharingType) => {
    const rates = history.filter((rate) => rate.sharingType === sharingType);
    return {
      sharingType,
      current:
        rates.find(
          (rate) =>
            rate.effectiveFrom <= today && (rate.effectiveTo === null || rate.effectiveTo >= today),
        ) ?? null,
      upcoming: rates.filter((rate) => rate.effectiveFrom > today).at(-1) ?? null,
      rooms: rooms.filter((room) => room.sharing_type === sharingType).length,
    };
  });

  return { history, summaries };
}

// ---------------------------------------------------------------------------
// Fee heads (E13-T1)
// ---------------------------------------------------------------------------

export interface FeeHeadRate {
  id: string;
  /** Null for a flat head. */
  sharingType: SharingType | null;
  amount: number;
  effectiveFrom: string;
  effectiveTo: string | null;
}

export interface FeeHead {
  id: string;
  name: string;
  billing: FeeHeadBilling;
  pricing: FeeHeadPricing;
  active: boolean;
  /** Rates in force today: one for a flat head, one per priced sharing type otherwise. */
  current: FeeHeadRate[];
  /** Every rate, newest first. */
  history: FeeHeadRate[];
}

/** The hostel's charges other than rent, with what each costs today. */
export async function getFeeHeads(supabase: Supabase, hostelId: string): Promise<FeeHead[]> {
  const { data, error } = await supabase
    .from("fee_heads")
    .select(
      "id, name, billing, pricing, active, fee_head_rates(id, sharing_type, amount, effective_from, effective_to)",
    )
    .eq("hostel_id", hostelId)
    .order("name")
    .order("effective_from", { referencedTable: "fee_head_rates", ascending: false });
  if (error) throw error;

  const today = todayIst();
  return (data ?? []).map((head) => {
    const history: FeeHeadRate[] = head.fee_head_rates.map((rate) => ({
      id: rate.id,
      sharingType: rate.sharing_type as SharingType | null,
      amount: rate.amount,
      effectiveFrom: rate.effective_from,
      effectiveTo: rate.effective_to,
    }));
    return {
      id: head.id,
      name: head.name,
      billing: head.billing as FeeHeadBilling,
      pricing: head.pricing as FeeHeadPricing,
      active: head.active,
      history,
      current: history
        .filter(
          (rate) =>
            rate.effectiveFrom <= today && (rate.effectiveTo === null || rate.effectiveTo >= today),
        )
        .sort(
          (a, b) =>
            SHARING_TYPES.indexOf(a.sharingType ?? "single") -
            SHARING_TYPES.indexOf(b.sharingType ?? "single"),
        ),
    };
  });
}

/** Monthly heads a resident is excused from. */
export async function getResidentExemptions(
  supabase: Supabase,
  hostelId: string,
  residentId: string,
): Promise<Set<string>> {
  const { data, error } = await supabase
    .from("resident_fee_exemptions")
    .select("fee_head_id")
    .eq("hostel_id", hostelId)
    .eq("resident_id", residentId);
  if (error) throw error;
  return new Set((data ?? []).map((row) => row.fee_head_id));
}

// ---------------------------------------------------------------------------
// Balances (E7-T5)
// ---------------------------------------------------------------------------

export interface ResidentBalance {
  invoiced: number;
  paid: number;
  /** Never negative: overpayment is rejected per invoice. */
  outstanding: number;
  overdue: number;
  oldestOverdueDueDate: string | null;
  openInvoices: number;
}

const ZERO_BALANCE: ResidentBalance = {
  invoiced: 0,
  paid: 0,
  outstanding: 0,
  overdue: 0,
  oldestOverdueDueDate: null,
  openInvoices: 0,
};

export async function getResidentBalance(
  supabase: Supabase,
  hostelId: string,
  residentId: string,
): Promise<ResidentBalance> {
  const { data, error } = await supabase
    .from("resident_balances")
    .select("*")
    .eq("hostel_id", hostelId)
    .eq("resident_id", residentId)
    .maybeSingle();
  if (error) throw error;
  if (!data) return ZERO_BALANCE;
  return {
    invoiced: data.invoiced ?? 0,
    paid: data.paid ?? 0,
    outstanding: Math.max(0, data.outstanding ?? 0),
    overdue: Math.max(0, data.overdue ?? 0),
    oldestOverdueDueDate: data.oldest_overdue_due_date,
    openInvoices: data.open_invoices ?? 0,
  };
}

export interface InvoiceRow {
  id: string;
  /** Sequential per hostel and financial year, e.g. INV/26-27/00042. */
  number: string;
  residentId: string;
  residentName: string;
  residentPhone: string;
  residentEmail: string | null;
  roomId: string | null;
  roomNumber: string | null;
  bedLabel: string | null;
  periodMonth: string;
  amount: number;
  paid: number;
  balance: number;
  /** Cheques received but not yet cleared (E13-T11). Part of the balance until they clear. */
  pendingCheques: number;
  dueDate: string;
  status: "issued" | "void";
  /** Null for void invoices. */
  dueStatus: InvoiceDueStatus | null;
  voidReason: string | null;
}

const INVOICE_COLUMNS =
  "id, resident_id, resident_name, resident_phone, resident_email, room_id, room_number, bed_label, period_month, amount, paid, balance, due_date, status, due_status, void_reason, number, pending_cheques";

type InvoiceBalanceRow = {
  id: string | null;
  resident_id: string | null;
  resident_name: string | null;
  resident_phone: string | null;
  resident_email: string | null;
  room_id: string | null;
  room_number: string | null;
  bed_label: string | null;
  period_month: string | null;
  amount: number | null;
  paid: number | null;
  balance: number | null;
  due_date: string | null;
  status: string | null;
  due_status: string | null;
  void_reason: string | null;
  number: string | null;
  pending_cheques: number | null;
};

function toInvoiceRow(row: InvoiceBalanceRow): InvoiceRow {
  return {
    id: row.id!,
    number: row.number!,
    residentId: row.resident_id!,
    residentName: row.resident_name ?? "",
    residentPhone: row.resident_phone ?? "",
    residentEmail: row.resident_email,
    roomId: row.room_id,
    roomNumber: row.room_number,
    bedLabel: row.bed_label,
    periodMonth: row.period_month!,
    amount: row.amount ?? 0,
    paid: row.paid ?? 0,
    balance: row.balance ?? 0,
    pendingCheques: row.pending_cheques ?? 0,
    dueDate: row.due_date!,
    status: row.status as InvoiceRow["status"],
    dueStatus: row.due_status as InvoiceDueStatus | null,
    voidReason: row.void_reason,
  };
}

/** A resident's invoices, void ones included, newest month first. */
export async function getResidentInvoices(
  supabase: Supabase,
  hostelId: string,
  residentId: string,
): Promise<InvoiceRow[]> {
  const { data, error } = await supabase
    .from("invoice_balances")
    .select(INVOICE_COLUMNS)
    .eq("hostel_id", hostelId)
    .eq("resident_id", residentId)
    .order("period_month", { ascending: false })
    .order("created_at", { ascending: false });
  if (error) throw error;
  return (data ?? []).map(toInvoiceRow);
}

// ---------------------------------------------------------------------------
// Fee list (E7-T6)
// ---------------------------------------------------------------------------

export const FEE_SORTS = ["outstanding", "month", "due", "room"] as const;
export type FeeSort = (typeof FEE_SORTS)[number];

export interface FeeListFilters {
  status: InvoiceDueStatus | null;
  roomId: string | null;
  /** `YYYY-MM-01`, or null for every month. */
  month: string | null;
  sort: FeeSort;
  page: number;
}

export const FEE_PAGE_SIZE = 50;

/**
 * One page of issued invoices. Filters and sort run in the database over
 * indexed columns, so the page stays fast with thousands of invoices.
 * Null when the page starts after the last invoice.
 */
export async function getFeeList(supabase: Supabase, hostelId: string, filters: FeeListFilters) {
  let query = supabase
    .from("invoice_balances")
    .select(INVOICE_COLUMNS, { count: "exact" })
    .eq("hostel_id", hostelId)
    .eq("status", "issued");
  if (filters.status) query = query.eq("due_status", filters.status);
  if (filters.roomId) query = query.eq("room_id", filters.roomId);
  if (filters.month) query = query.eq("period_month", filters.month);

  switch (filters.sort) {
    case "outstanding":
      query = query.order("balance", { ascending: false }).order("due_date");
      break;
    case "month":
      query = query.order("period_month", { ascending: false }).order("resident_name");
      break;
    case "due":
      query = query.order("due_date").order("resident_name");
      break;
    case "room":
      query = query.order("room_sort").order("bed_label").order("period_month", {
        ascending: false,
      });
      break;
  }

  const from = (filters.page - 1) * FEE_PAGE_SIZE;
  const { data, count, error } = await query.order("id").range(from, from + FEE_PAGE_SIZE - 1);
  if (isPastLastPage(error)) return null;
  if (error) throw error;
  return { rows: (data ?? []).map(toInvoiceRow), total: count ?? 0 };
}

export interface StatusTotal {
  invoices: number;
  amount: number;
  paid: number;
  balance: number;
}

/** Running totals per due status, with the list's month and room filters. */
export async function getFeeTotals(
  supabase: Supabase,
  hostelId: string,
  filters: Pick<FeeListFilters, "month" | "roomId">,
): Promise<Record<InvoiceDueStatus, StatusTotal>> {
  const { data, error } = await supabase.rpc("fee_status_totals", {
    p_hostel_id: hostelId,
    p_period_month: filters.month ?? undefined,
    p_room_id: filters.roomId ?? undefined,
  });
  if (error) throw error;
  const empty = (): StatusTotal => ({ invoices: 0, amount: 0, paid: 0, balance: 0 });
  const totals = { unpaid: empty(), partial: empty(), paid: empty(), overdue: empty() };
  for (const row of data ?? []) {
    totals[row.due_status as InvoiceDueStatus] = {
      invoices: row.invoices,
      amount: row.amount,
      paid: row.paid,
      balance: row.balance,
    };
  }
  return totals;
}

/** Months that have invoices, newest first, for the month filter. */
export async function getBilledMonths(supabase: Supabase, hostelId: string): Promise<string[]> {
  const { data, error } = await supabase.rpc("billed_months", { p_hostel_id: hostelId });
  if (error) throw error;
  return data ?? [];
}

// ---------------------------------------------------------------------------
// One invoice (E7-T4, E7-T7)
// ---------------------------------------------------------------------------

export interface PaymentRow {
  id: string;
  /** The receipt number, e.g. RCT/26-27/00042; none when paid from credit or deposit. */
  number: string | null;
  amount: number;
  paidAt: string;
  mode: PaymentMode;
  reference: string | null;
  recordedBy: string | null;
  recordedAt: string;
  voidedAt: string | null;
  voidReason: string | null;
  /** Cheques only (E13-T11). */
  cheque: { bank: string; clearedOn: string | null; bounced: boolean } | null;
}

export async function getInvoice(supabase: Supabase, hostelId: string, invoiceId: string) {
  const [{ data: invoice, error }, { data: detail, error: detailError }, payments] =
    await Promise.all([
      supabase
        .from("invoice_balances")
        .select(INVOICE_COLUMNS)
        .eq("hostel_id", hostelId)
        .eq("id", invoiceId)
        .maybeSingle(),
      supabase
        .from("invoices")
        .select(
          "breakdown, created_at, voided_at, invoice_lines(position, kind, description, amount, detail)",
        )
        .order("position", { referencedTable: "invoice_lines" })
        .eq("hostel_id", hostelId)
        .eq("id", invoiceId)
        .maybeSingle(),
      getInvoicePayments(supabase, hostelId, invoiceId),
    ]);
  if (error) throw error;
  if (detailError) throw detailError;
  if (!invoice || !detail) return null;

  return {
    ...toInvoiceRow(invoice),
    breakdown: detail.breakdown as unknown as StayBreakdown[],
    lines: (detail.invoice_lines ?? []) as unknown as InvoiceLine[],
    issuedAt: detail.created_at,
    voidedAt: detail.voided_at,
    payments,
  };
}

export type InvoiceDetail = NonNullable<Awaited<ReturnType<typeof getInvoice>>>;

async function getInvoicePayments(
  supabase: Supabase,
  hostelId: string,
  invoiceId: string,
): Promise<PaymentRow[]> {
  const { data, error } = await supabase
    .from("payments")
    .select(
      "id, number, amount, paid_at, mode, reference, created_at, voided_at, void_reason, recorded_by_name, cheque_bank, cleared_on, bounced",
    )
    .eq("hostel_id", hostelId)
    .eq("invoice_id", invoiceId)
    .order("paid_at")
    .order("created_at");
  if (error) throw error;
  return (data ?? []).map((row) => ({
    id: row.id,
    number: row.number,
    amount: row.amount,
    paidAt: row.paid_at,
    mode: row.mode as PaymentMode,
    reference: row.reference,
    recordedBy: row.recorded_by_name,
    recordedAt: row.created_at,
    voidedAt: row.voided_at,
    voidReason: row.void_reason,
    cheque:
      row.mode === "cheque"
        ? { bank: row.cheque_bank ?? "", clearedOn: row.cleared_on, bounced: row.bounced }
        : null,
  }));
}

export interface PendingCheque {
  id: string;
  invoiceId: string;
  invoiceNumber: string;
  residentId: string;
  residentName: string;
  amount: number;
  receivedOn: string;
  chequeNumber: string;
  bank: string;
  recordedBy: string | null;
}

/** Cheques waiting to clear, oldest first (E13-T11). */
export async function getPendingCheques(
  supabase: Supabase,
  hostelId: string,
): Promise<PendingCheque[]> {
  const rows = await fetchAllPages((first, last) =>
    supabase
      .from("pending_cheques")
      .select(
        "id, invoice_id, invoice_number, resident_id, resident_name, amount, paid_at, cheque_number, cheque_bank, recorded_by_name",
      )
      .eq("hostel_id", hostelId)
      .order("paid_at")
      .order("id")
      .range(first, last),
  );
  return rows.map((row) => ({
    id: row.id!,
    invoiceId: row.invoice_id!,
    invoiceNumber: row.invoice_number ?? "",
    residentId: row.resident_id!,
    residentName: row.resident_name ?? "",
    amount: row.amount ?? 0,
    receivedOn: row.paid_at!,
    chequeNumber: row.cheque_number ?? "",
    bank: row.cheque_bank ?? "",
    recordedBy: row.recorded_by_name,
  }));
}

/** The hostel's letterhead for printed invoices and receipts. */
export async function getLetterhead(supabase: Supabase, hostelId: string) {
  const { data, error } = await supabase
    .from("hostels")
    .select("name, address, city, state, pincode, phone, email, gstin")
    .eq("id", hostelId)
    .single();
  if (error) throw error;
  return data;
}

// ---------------------------------------------------------------------------
// Charges, discounts and late fees (E13-T2, E13-T5, E13-T6)
// ---------------------------------------------------------------------------

export interface ResidentCharge {
  id: string;
  kind: "charge" | "late_fee";
  description: string;
  amount: number;
  chargeDate: string;
  status: "pending" | "invoiced" | "void";
  invoiceId: string | null;
  voidReason: string | null;
}

/** A resident's charges outside the monthly cycle, newest first. */
export async function getResidentCharges(
  supabase: Supabase,
  hostelId: string,
  residentId: string,
): Promise<ResidentCharge[]> {
  const { data, error } = await supabase
    .from("resident_charges")
    .select("id, kind, description, amount, charge_date, status, invoice_id, void_reason")
    .eq("hostel_id", hostelId)
    .eq("resident_id", residentId)
    .order("charge_date", { ascending: false })
    .order("created_at", { ascending: false })
    .limit(100);
  if (error) throw error;
  return (data ?? []).map((row) => ({
    id: row.id,
    kind: row.kind as ResidentCharge["kind"],
    description: row.description,
    amount: row.amount,
    chargeDate: row.charge_date,
    status: row.status as ResidentCharge["status"],
    invoiceId: row.invoice_id,
    voidReason: row.void_reason,
  }));
}

export interface Discount {
  id: string;
  /** "Rent", or the fee head's name. */
  target: string;
  percent: number | null;
  amount: number | null;
  fromMonth: string;
  toMonth: string | null;
  reason: string;
}

export async function getResidentDiscounts(
  supabase: Supabase,
  hostelId: string,
  residentId: string,
): Promise<Discount[]> {
  const { data, error } = await supabase
    .from("discounts")
    .select("id, percent, amount, from_month, to_month, reason, fee_heads(name)")
    .eq("hostel_id", hostelId)
    .eq("resident_id", residentId)
    .order("from_month", { ascending: false });
  if (error) throw error;
  return (data ?? []).map((row) => ({
    id: row.id,
    target: row.fee_heads?.name ?? "Rent",
    percent: row.percent,
    amount: row.amount,
    fromMonth: row.from_month,
    toMonth: row.to_month,
    reason: row.reason,
  }));
}

export interface LateFeeRule {
  graceDays: number;
  kind: "fixed" | "per_day";
  amount: number;
  cap: number | null;
  active: boolean;
}

export async function getLateFeeRule(
  supabase: Supabase,
  hostelId: string,
): Promise<LateFeeRule | null> {
  const { data, error } = await supabase
    .from("late_fee_rules")
    .select("grace_days, kind, amount, cap, active")
    .eq("hostel_id", hostelId)
    .maybeSingle();
  if (error) throw error;
  return data
    ? {
        graceDays: data.grace_days,
        kind: data.kind as LateFeeRule["kind"],
        amount: data.amount,
        cap: data.cap,
        active: data.active,
      }
    : null;
}

// ---------------------------------------------------------------------------
// Credit and deposits (E13-T7, E13-T4)
// ---------------------------------------------------------------------------

export interface MoneyEntry {
  id: string;
  ledger: "credit" | "deposit";
  kind: string;
  amount: number;
  date: string;
  mode: string | null;
  reference: string | null;
  number: string | null;
  note: string | null;
  invoiceId: string | null;
  recordedAt: string;
}

export interface ResidentMoney {
  credit: number;
  deposit: {
    due: number;
    received: number;
    deducted: number;
    applied: number;
    refunded: number;
    held: number;
    outstanding: number;
  };
  /** Both ledgers, newest first. */
  entries: MoneyEntry[];
}

export async function getResidentMoney(
  supabase: Supabase,
  hostelId: string,
  residentId: string,
): Promise<ResidentMoney> {
  const columns =
    "id, kind, amount, paid_at, mode, reference, number, note, invoice_id, created_at";
  const [credit, deposit, creditRows, depositRows] = await Promise.all([
    supabase
      .from("resident_credit_balances")
      .select("balance")
      .eq("hostel_id", hostelId)
      .eq("resident_id", residentId)
      .maybeSingle(),
    supabase
      .from("resident_deposits")
      .select("due, received, deducted, applied, refunded, held, outstanding")
      .eq("hostel_id", hostelId)
      .eq("resident_id", residentId)
      .maybeSingle(),
    supabase
      .from("resident_credit")
      .select(columns)
      .eq("hostel_id", hostelId)
      .eq("resident_id", residentId)
      .order("created_at", { ascending: false })
      .limit(100),
    supabase
      .from("deposit_ledger")
      .select(columns)
      .eq("hostel_id", hostelId)
      .eq("resident_id", residentId)
      .order("created_at", { ascending: false })
      .limit(100),
  ]);
  for (const result of [credit, deposit, creditRows, depositRows]) {
    if (result.error) throw result.error;
  }

  const toEntry =
    (ledger: MoneyEntry["ledger"]) =>
    (row: NonNullable<typeof creditRows.data>[number]): MoneyEntry => ({
      id: row.id,
      ledger,
      kind: row.kind,
      amount: row.amount,
      date: row.paid_at,
      mode: row.mode,
      reference: row.reference,
      number: row.number,
      note: row.note,
      invoiceId: row.invoice_id,
      recordedAt: row.created_at,
    });

  const d = deposit.data;
  return {
    credit: credit.data?.balance ?? 0,
    deposit: {
      due: d?.due ?? 0,
      received: d?.received ?? 0,
      deducted: d?.deducted ?? 0,
      applied: d?.applied ?? 0,
      refunded: d?.refunded ?? 0,
      held: d?.held ?? 0,
      outstanding: d?.outstanding ?? 0,
    },
    entries: [
      ...(creditRows.data ?? []).map(toEntry("credit")),
      ...(depositRows.data ?? []).map(toEntry("deposit")),
    ].sort((a, b) => b.recordedAt.localeCompare(a.recordedAt)),
  };
}

/** The deposit asked for per sharing type. */
export async function getDepositAmounts(
  supabase: Supabase,
  hostelId: string,
): Promise<Partial<Record<SharingType, number>>> {
  const { data, error } = await supabase
    .from("deposit_amounts")
    .select("sharing_type, amount")
    .eq("hostel_id", hostelId);
  if (error) throw error;
  return Object.fromEntries((data ?? []).map((row) => [row.sharing_type, row.amount]));
}

export interface SettlementPreview {
  unusedInvoiceNumber: string | null;
  unusedMonth: string | null;
  unusedCredit: number;
  pendingCharges: number;
  dues: number;
  credit: number;
  depositHeld: number;
  depositOutstanding: number;
  /** Positive: to refund. Negative: still owed. */
  net: number;
}

export async function getSettlementPreview(
  supabase: Supabase,
  residentId: string,
): Promise<SettlementPreview> {
  const { data, error } = await supabase.rpc("settlement_preview", { p_resident_id: residentId });
  if (error) throw error;
  const p = data as Record<string, unknown>;
  return {
    unusedInvoiceNumber: (p.unused_invoice_number as string | null) ?? null,
    unusedMonth: (p.unused_month as string | null) ?? null,
    unusedCredit: Number(p.unused_credit ?? 0),
    pendingCharges: Number(p.pending_charges ?? 0),
    dues: Number(p.dues ?? 0),
    credit: Number(p.credit ?? 0),
    depositHeld: Number(p.deposit_held ?? 0),
    depositOutstanding: Number(p.deposit_outstanding ?? 0),
    net: Number(p.net ?? 0),
  };
}

// ---------------------------------------------------------------------------
// Electricity (E13-T3)
// ---------------------------------------------------------------------------

/** Paise per unit, or null when the hostel does not bill electricity. */
export async function getElectricityRate(supabase: Supabase, hostelId: string) {
  const { data, error } = await supabase
    .from("electricity_rates")
    .select("unit_rate")
    .eq("hostel_id", hostelId)
    .maybeSingle();
  if (error) throw error;
  return data?.unit_rate ?? null;
}

export interface MeterShare {
  residentName: string;
  amount: number;
  status: "pending" | "invoiced" | "void";
}

export interface MeterRoom {
  roomId: string;
  roomNumber: string;
  /** The closing units of the room's latest earlier reading: this month's opening. */
  previousClosing: number | null;
  /** Someone held a bed in it this month and it has no reading. */
  missing: boolean;
  reading: {
    id: string;
    opening: number;
    closing: number;
    unitRate: number;
    amount: number;
    recordedAt: string;
    shares: MeterShare[];
  } | null;
}

/** Every room with its reading for `month` (YYYY-MM-01) and what it was split into. */
export async function getMeterSheet(
  supabase: Supabase,
  hostelId: string,
  month: string,
): Promise<MeterRoom[]> {
  const [rooms, readings, earlier, missing] = await Promise.all([
    fetchAllPages((first, last) =>
      supabase
        .from("room_inventory")
        .select("id, room_number")
        .eq("hostel_id", hostelId)
        .order("floor")
        .order("room_sort")
        .order("id")
        .range(first, last),
    ),
    fetchAllPages((first, last) =>
      supabase
        .from("meter_readings")
        .select(
          "id, room_id, opening, closing, unit_rate, amount, created_at, resident_charges(amount, status, residents!resident_charges_resident_fkey(full_name))",
        )
        .eq("hostel_id", hostelId)
        .eq("period_month", month)
        .is("voided_at", null)
        .order("id")
        .range(first, last),
    ),
    fetchAllPages((first, last) =>
      supabase
        .from("meter_readings")
        .select("room_id, closing")
        .eq("hostel_id", hostelId)
        .lt("period_month", month)
        .is("voided_at", null)
        .order("period_month", { ascending: false })
        .order("id")
        .range(first, last),
    ),
    supabase.rpc("missing_meter_readings", { p_hostel_id: hostelId, p_period_month: month }),
  ]);
  if (missing.error) throw missing.error;

  const previous = new Map<string, number>();
  for (const row of earlier) {
    if (!previous.has(row.room_id)) previous.set(row.room_id, Number(row.closing));
  }
  const byRoom = new Map(readings.map((reading) => [reading.room_id, reading]));
  const missingRooms = new Set((missing.data ?? []).map((room) => room.room_id));

  return rooms.map((room) => {
    const reading = byRoom.get(room.id!);
    return {
      roomId: room.id!,
      roomNumber: room.room_number ?? "",
      previousClosing: previous.get(room.id!) ?? null,
      missing: missingRooms.has(room.id!),
      reading: reading
        ? {
            id: reading.id,
            opening: Number(reading.opening),
            closing: Number(reading.closing),
            unitRate: reading.unit_rate,
            amount: reading.amount,
            recordedAt: reading.created_at,
            shares: reading.resident_charges.map((charge) => ({
              residentName: charge.residents?.full_name ?? "",
              amount: charge.amount,
              status: charge.status as MeterShare["status"],
            })),
          }
        : null,
    };
  });
}
