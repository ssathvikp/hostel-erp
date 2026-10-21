import type { BadgeTone, SelectOption } from "@/components/ui";

import type { SubscriptionStatus } from "./queries";

/** Subscription statuses (ClickUp EP-14 T2). */
export const SUBSCRIPTION_STATUSES = [
  "trialing",
  "active",
  "past_due",
  "read_only",
  "cancelled",
] as const;

export const SUBSCRIPTION_STATUS_LABELS: Record<SubscriptionStatus, string> = {
  trialing: "Free trial",
  active: "Active",
  past_due: "Payment overdue",
  read_only: "Read-only",
  cancelled: "Cancelled",
};

export const SUBSCRIPTION_STATUS_TONES: Record<SubscriptionStatus, BadgeTone> = {
  trialing: "info",
  active: "success",
  past_due: "warning",
  read_only: "danger",
  cancelled: "neutral",
};

export const SUBSCRIPTION_STATUS_OPTIONS: readonly SelectOption[] = SUBSCRIPTION_STATUSES.map(
  (status) => ({ value: status, label: SUBSCRIPTION_STATUS_LABELS[status] }),
);

export const PRICING_BASIS_OPTIONS: readonly SelectOption[] = [
  { value: "flat", label: "Flat per month" },
  { value: "per_bed", label: "Per bed" },
  { value: "tiered", label: "Tiered by beds" },
];
