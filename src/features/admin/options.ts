import type { BadgeTone, SelectOption } from "@/components/ui";

export const PLANS = ["trial", "paid", "free"] as const;
export type Plan = (typeof PLANS)[number];

export const PLAN_LABELS: Record<string, string> = {
  trial: "Trial",
  paid: "Paid",
  free: "Free",
};

export const PLAN_OPTIONS: readonly SelectOption[] = [
  { value: "trial", label: "Trial" },
  { value: "paid", label: "Paid" },
  { value: "free", label: "Free (complimentary)" },
];

export const HOSTEL_STATUS_TONES: Record<string, BadgeTone> = {
  active: "success",
  draft: "neutral",
  suspended: "danger",
};

export const HOSTEL_STATUS_LABELS: Record<string, string> = {
  active: "Active",
  draft: "Setting up",
  suspended: "Suspended",
};
