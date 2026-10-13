import type { BadgeTone, SelectOption } from "@/components/ui";
import {
  COMPLAINT_PRIORITIES,
  COMPLAINT_STATUSES,
  MAINTENANCE_UNITS,
  PAYOUT_MODES,
  TRADES,
  type ComplaintPriority,
  type ComplaintStatus,
  type ComplaintTargetState,
  type MaintenanceUnit,
  type PayoutMode,
  type Trade,
  type WorkerKind,
} from "@/types";

export const COMPLAINT_STATUS_LABELS: Record<ComplaintStatus, string> = {
  open: "Open",
  assigned: "Assigned",
  in_progress: "In progress",
  on_hold: "On hold",
  resolved: "Resolved",
  closed: "Closed",
  reopened: "Reopened",
};

export const COMPLAINT_STATUS_TONES: Record<ComplaintStatus, BadgeTone> = {
  open: "warning",
  assigned: "info",
  in_progress: "info",
  on_hold: "neutral",
  resolved: "success",
  closed: "neutral",
  reopened: "danger",
};

/** The verb on the button that moves a complaint to each status. */
export const COMPLAINT_STATUS_ACTIONS: Record<ComplaintStatus, string> = {
  open: "Back to open",
  assigned: "Assigned",
  in_progress: "Start work",
  on_hold: "Put on hold",
  resolved: "Mark resolved",
  closed: "Close",
  reopened: "Reopen",
};

export const COMPLAINT_STATUS_OPTIONS: readonly SelectOption[] = COMPLAINT_STATUSES.map(
  (status) => ({ value: status, label: COMPLAINT_STATUS_LABELS[status] }),
);

export const PRIORITY_LABELS: Record<ComplaintPriority, string> = {
  urgent: "Urgent",
  high: "High",
  normal: "Normal",
  low: "Low",
};

export const PRIORITY_TONES: Record<ComplaintPriority, BadgeTone> = {
  urgent: "danger",
  high: "warning",
  normal: "neutral",
  low: "neutral",
};

export const PRIORITY_OPTIONS: readonly SelectOption[] = COMPLAINT_PRIORITIES.map((priority) => ({
  value: priority,
  label: PRIORITY_LABELS[priority],
}));

export const TARGET_LABELS: Record<ComplaintTargetState, string> = {
  on_track: "On track",
  due_soon: "Due soon",
  overdue: "Overdue",
  paused: "Paused",
  done: "Done",
};

export const TARGET_TONES: Record<ComplaintTargetState, BadgeTone> = {
  on_track: "success",
  due_soon: "warning",
  overdue: "danger",
  paused: "neutral",
  done: "neutral",
};

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

export const WORKER_KIND_LABELS: Record<WorkerKind, string> = {
  on_site: "On-site staff",
  vendor: "Outside vendor",
};

export const UNIT_LABELS: Record<MaintenanceUnit, [string, string]> = {
  day: ["day", "days"],
  week: ["week", "weeks"],
  month: ["month", "months"],
};

export const UNIT_OPTIONS: readonly SelectOption[] = MAINTENANCE_UNITS.map((unit) => ({
  value: unit,
  label: UNIT_LABELS[unit][1],
}));

export const PAYOUT_MODE_LABELS: Record<PayoutMode, string> = {
  cash: "Cash",
  upi: "UPI",
  bank_transfer: "Bank transfer",
  cheque: "Cheque",
};

export const PAYOUT_MODE_OPTIONS: readonly SelectOption[] = PAYOUT_MODES.map((mode) => ({
  value: mode,
  label: PAYOUT_MODE_LABELS[mode],
}));

export function isComplaintStatus(value: unknown): value is ComplaintStatus {
  return (COMPLAINT_STATUSES as readonly unknown[]).includes(value);
}

export function isPriority(value: unknown): value is ComplaintPriority {
  return (COMPLAINT_PRIORITIES as readonly unknown[]).includes(value);
}

/** "every 3 months", "every week". */
export function everyLabel(every: number, unit: MaintenanceUnit): string {
  return every === 1 ? `every ${UNIT_LABELS[unit][0]}` : `every ${every} ${UNIT_LABELS[unit][1]}`;
}
