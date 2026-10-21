import type { BadgeTone, SelectOption } from "@/components/ui";

/** Complaint labels and the status machine, as the database defines them (ClickUp EP-15). */
export const COMPLAINT_STATUSES = [
  "open",
  "assigned",
  "in_progress",
  "on_hold",
  "resolved",
  "closed",
  "reopened",
] as const;
export type ComplaintStatus = (typeof COMPLAINT_STATUSES)[number];

export const STATUS_LABELS: Record<ComplaintStatus, string> = {
  open: "Open",
  assigned: "Assigned",
  in_progress: "In progress",
  on_hold: "On hold",
  resolved: "Resolved",
  closed: "Closed",
  reopened: "Reopened",
};

export const STATUS_TONES: Record<ComplaintStatus, BadgeTone> = {
  open: "warning",
  assigned: "info",
  in_progress: "info",
  on_hold: "neutral",
  resolved: "success",
  closed: "neutral",
  reopened: "warning",
};

/** Mirrors private.complaint_transition_allowed. */
export const NEXT_STATUSES: Record<ComplaintStatus, readonly ComplaintStatus[]> = {
  open: ["in_progress", "on_hold", "resolved", "closed"],
  assigned: ["in_progress", "on_hold", "resolved", "closed"],
  in_progress: ["on_hold", "resolved"],
  on_hold: ["in_progress", "resolved", "closed"],
  resolved: ["closed", "reopened"],
  closed: ["reopened"],
  reopened: ["in_progress", "on_hold", "resolved", "closed"],
};

export const OPEN_STATUSES: readonly ComplaintStatus[] = [
  "open",
  "assigned",
  "in_progress",
  "on_hold",
  "reopened",
];

export function isComplaintStatus(value: unknown): value is ComplaintStatus {
  return (COMPLAINT_STATUSES as readonly unknown[]).includes(value);
}

export const PRIORITIES = ["urgent", "high", "normal", "low"] as const;
export type Priority = (typeof PRIORITIES)[number];

export const PRIORITY_LABELS: Record<Priority, string> = {
  urgent: "Urgent",
  high: "High",
  normal: "Normal",
  low: "Low",
};

export const PRIORITY_OPTIONS: readonly SelectOption[] = PRIORITIES.map((priority) => ({
  value: priority,
  label: PRIORITY_LABELS[priority],
}));

export const TRADES = [
  "electrician",
  "plumber",
  "carpenter",
  "cleaner",
  "technician",
  "pest_control",
  "general",
] as const;
export type Trade = (typeof TRADES)[number];

export const TRADE_LABELS: Record<Trade, string> = {
  electrician: "Electrician",
  plumber: "Plumber",
  carpenter: "Carpenter",
  cleaner: "Cleaner",
  technician: "Technician",
  pest_control: "Pest control",
  general: "General",
};

export const TRADE_OPTIONS: readonly SelectOption[] = TRADES.map((trade) => ({
  value: trade,
  label: TRADE_LABELS[trade],
}));

export const COST_KIND_LABELS = {
  labour: "Labour",
  material: "Material",
  vendor_charge: "Vendor charge",
} as const;

export const COST_KIND_OPTIONS: readonly SelectOption[] = Object.entries(COST_KIND_LABELS).map(
  ([value, label]) => ({ value, label }),
);

export const SCHEDULE_UNIT_OPTIONS: readonly SelectOption[] = [
  { value: "day", label: "Days" },
  { value: "week", label: "Weeks" },
  { value: "month", label: "Months" },
];

export const EVENT_LABELS: Record<string, string> = {
  created: "Raised",
  status: "Status changed",
  assigned: "Assigned",
  unassigned: "Unassigned",
  declined: "Declined",
  comment: "Comment",
  cost: "Cost",
  attachment: "File added",
  job: "Job update",
  needs_worker: "No worker available",
};

/** `#C-0042`, as staff say it. */
export function complaintNumber(number: number): string {
  return `C-${String(number).padStart(4, "0")}`;
}
