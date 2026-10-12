import type { BadgeTone, SelectOption } from "@/components/ui";
import {
  FEE_HEAD_BILLINGS,
  FEE_HEAD_PRICINGS,
  INVOICE_DUE_STATUSES,
  type FeeHeadBilling,
  type FeeHeadPricing,
  PAYMENT_MODES,
  type InvoiceDueStatus,
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
  credit: "From credit",
  deposit: "From deposit",
};

export const PAYMENT_MODE_OPTIONS: readonly SelectOption[] = PAYMENT_MODES.map((mode) => ({
  value: mode,
  label: PAYMENT_MODE_LABELS[mode],
}));

export const FEE_HEAD_BILLING_LABELS: Record<FeeHeadBilling, string> = {
  monthly: "Every month",
  one_time: "Once, when charged",
};

export const FEE_HEAD_PRICING_LABELS: Record<FeeHeadPricing, string> = {
  flat: "Same for every resident",
  per_sharing: "By sharing type",
};

export const FEE_HEAD_BILLING_OPTIONS: readonly SelectOption[] = FEE_HEAD_BILLINGS.map(
  (billing) => ({ value: billing, label: FEE_HEAD_BILLING_LABELS[billing] }),
);

export const FEE_HEAD_PRICING_OPTIONS: readonly SelectOption[] = FEE_HEAD_PRICINGS.map(
  (pricing) => ({ value: pricing, label: FEE_HEAD_PRICING_LABELS[pricing] }),
);
