import type { BadgeTone, SelectOption } from "@/components/ui";
import { VACATE_FORM_REASONS } from "@/lib/validation";
import type { VacateReason } from "@/types";

export const VACATE_REASON_LABELS: Record<VacateReason, string> = {
  moved_out: "Moved out",
  transferred: "Transferred",
  evicted: "Evicted",
  other: "Other",
};

export const VACATE_REASON_OPTIONS: readonly SelectOption[] = VACATE_FORM_REASONS.map((reason) => ({
  value: reason,
  label: VACATE_REASON_LABELS[reason],
}));

export const ALLOCATION_EVENT_ACTIONS = [
  "allocated",
  "vacated",
  "transferred_out",
  "transferred_in",
] as const;
export type AllocationEventAction = (typeof ALLOCATION_EVENT_ACTIONS)[number];

export const ALLOCATION_EVENT_LABELS: Record<AllocationEventAction, string> = {
  allocated: "Allocated",
  vacated: "Vacated",
  transferred_out: "Moved out (transfer)",
  transferred_in: "Moved in (transfer)",
};

export const ALLOCATION_EVENT_TONES: Record<AllocationEventAction, BadgeTone> = {
  allocated: "success",
  vacated: "neutral",
  transferred_out: "info",
  transferred_in: "info",
};
