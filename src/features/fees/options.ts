import type { BadgeTone, SelectOption } from "@/components/ui";
import { formatMonth } from "@/lib/money";
import {
  INVOICE_DUE_STATUSES,
  PAYMENT_MODES,
  type InvoiceDueStatus,
  type InvoiceKind,
  type PaymentMode,
} from "@/types";

/** "Unpaid" reads as "Due" on screen: the money is owed but not yet late. */
export const DUE_STATUS_LABELS: Record<InvoiceDueStatus, string> = {
  unpaid: "Due",
  partial: "Partly paid",
  paid: "Paid",
  overdue: "Overdue",
};

export const DUE_STATUS_TONES: Record<InvoiceDueStatus, BadgeTone> = {
  unpaid: "info",
  partial: "warning",
  paid: "success",
  overdue: "danger",
};

/** The order the fee list shows status buckets in: what needs action first. */
export const DUE_STATUS_ORDER: readonly InvoiceDueStatus[] = [
  "overdue",
  "partial",
  "unpaid",
  "paid",
];

export const DUE_STATUS_OPTIONS: readonly SelectOption[] = DUE_STATUS_ORDER.map((status) => ({
  value: status,
  label: DUE_STATUS_LABELS[status],
}));

export function isDueStatus(value: unknown): value is InvoiceDueStatus {
  return (INVOICE_DUE_STATUSES as readonly unknown[]).includes(value);
}

export const PAYMENT_MODE_LABELS: Record<PaymentMode, string> = {
  cash: "Cash",
  upi: "UPI",
  bank_transfer: "Bank transfer",
  card: "Card",
};

export const PAYMENT_MODE_OPTIONS: readonly SelectOption[] = PAYMENT_MODES.map((mode) => ({
  value: mode,
  label: PAYMENT_MODE_LABELS[mode],
}));

/**
 * How an invoice is named everywhere: its month, and "late fee" for a late
 * fee (ClickUp E13-T6), e.g. "June 2026 late fee".
 */
export function invoiceLabel(
  invoice: { periodMonth: string; kind: InvoiceKind },
  options?: { short?: boolean },
): string {
  const month = formatMonth(invoice.periodMonth, options);
  return invoice.kind === "late_fee" ? `${month} late fee` : month;
}

export const LATE_FEE_MODE_OPTIONS: readonly SelectOption[] = [
  { value: "off", label: "Off" },
  { value: "fixed", label: "A fixed amount per late invoice" },
  { value: "per_day", label: "An amount per day late, up to a limit" },
];
