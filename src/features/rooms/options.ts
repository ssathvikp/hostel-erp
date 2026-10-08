import type { BadgeTone, SelectOption } from "@/components/ui";
import {
  MANUAL_BED_STATUSES,
  SHARING_TYPES,
  type BedStatus,
  type ManualBedStatus,
  type SharingType,
} from "@/types";

export const SHARING_TYPE_LABELS: Record<SharingType, string> = {
  single: "Single",
  double: "Double",
  triple: "Triple",
  four_plus: "Four or more",
};

export const SHARING_TYPE_OPTIONS: readonly SelectOption[] = SHARING_TYPES.map((type) => ({
  value: type,
  label: SHARING_TYPE_LABELS[type],
}));

/** Beds per room implied by a sharing type; `four_plus` lets the owner choose. */
export const FIXED_CAPACITY: Record<SharingType, number | null> = {
  single: 1,
  double: 2,
  triple: 3,
  four_plus: null,
};

export const BED_STATUS_LABELS: Record<BedStatus, string> = {
  available: "Available",
  occupied: "Occupied",
  blocked: "Blocked",
  maintenance: "Maintenance",
};

export const BED_STATUS_TONES: Record<BedStatus, BadgeTone> = {
  available: "success",
  occupied: "info",
  blocked: "warning",
  maintenance: "danger",
};

export const MANUAL_BED_STATUS_OPTIONS: readonly SelectOption[] = MANUAL_BED_STATUSES.map(
  (status: ManualBedStatus) => ({ value: status, label: BED_STATUS_LABELS[status] }),
);

/** "Ground floor", "1st floor", "2nd floor"... */
export function floorLabel(floor: number): string {
  if (floor === 0) return "Ground floor";
  const tens = floor % 100;
  const suffix = tens >= 11 && tens <= 13 ? "th" : (["th", "st", "nd", "rd"][floor % 10] ?? "th");
  return `${floor}${suffix} floor`;
}
