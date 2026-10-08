import type { SelectOption } from "@/components/ui";
import { HOSTEL_TYPES, INDIAN_STATES, type HostelType } from "@/types";

export const HOSTEL_TYPE_LABELS: Record<HostelType, string> = {
  boys: "Boys",
  girls: "Girls",
  co_ed: "Co-ed",
};

export const HOSTEL_TYPE_OPTIONS: readonly SelectOption[] = HOSTEL_TYPES.map((type) => ({
  value: type,
  label: HOSTEL_TYPE_LABELS[type],
}));

export const INDIAN_STATE_OPTIONS: readonly SelectOption[] = INDIAN_STATES.map((state) => ({
  value: state,
  label: state,
}));
