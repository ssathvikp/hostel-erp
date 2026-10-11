import { shiftMonth } from "@/lib/money";

/**
 * The dashboard's date range (E8-T4). It lives in the URL so a view can be
 * reloaded or shared: `?range=last_month`, or
 * `?range=custom&from=YYYY-MM-DD&to=YYYY-MM-DD`. Dates are India's calendar.
 */
export const RANGE_PRESETS = ["this_month", "last_month", "custom"] as const;
export type RangePreset = (typeof RANGE_PRESETS)[number];

export const RANGE_LABELS: Record<RangePreset, string> = {
  this_month: "This month",
  last_month: "Last month",
  custom: "Custom range",
};

export type Granularity = "day" | "month";

export interface DashboardRange {
  preset: RangePreset;
  from: string;
  to: string;
  /** Trend buckets: days for ranges up to two months, months beyond. */
  granularity: Granularity;
  /** Set when the requested custom range was invalid and the default was used instead. */
  error: string | null;
}

/** Longest range the dashboard accepts, matching the database's limit. */
export const MAX_RANGE_DAYS = 731;
const DAY_GRANULARITY_MAX_DAYS = 62;

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

function isRealDate(value: string): boolean {
  if (!ISO_DATE.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

function lastDayOf(monthStart: string): string {
  const next = new Date(`${shiftMonth(monthStart, 1)}T00:00:00Z`);
  next.setUTCDate(0);
  return next.toISOString().slice(0, 10);
}

function spanDays(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);
}

function withGranularity(
  preset: RangePreset,
  from: string,
  to: string,
  error: string | null = null,
): DashboardRange {
  const granularity = spanDays(from, to) <= DAY_GRANULARITY_MAX_DAYS ? "day" : "month";
  return { preset, from, to, granularity, error };
}

type Params = Record<string, string | string[] | undefined>;

function single(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

/** Reads the range from search params; anything invalid falls back to this month with a reason. */
export function parseRange(params: Params, today: string): DashboardRange {
  const preset = single(params.range);
  const thisMonth = shiftMonth(today, 0);

  if (preset === "last_month") {
    const start = shiftMonth(today, -1);
    return withGranularity("last_month", start, lastDayOf(start));
  }

  const fallback = (error: string | null) =>
    withGranularity("this_month", thisMonth, lastDayOf(thisMonth), error);

  if (preset !== "custom") return fallback(null);

  const from = single(params.from) ?? "";
  const to = single(params.to) ?? "";
  if (!isRealDate(from) || !isRealDate(to)) {
    return fallback("Enter both a start and an end date for a custom range.");
  }
  if (from > to) {
    return fallback("The start date must be on or before the end date.");
  }
  if (spanDays(from, to) > MAX_RANGE_DAYS) {
    return fallback("Choose a custom range of at most two years.");
  }
  if (from > today) {
    return fallback("The range must start today or earlier.");
  }
  return withGranularity("custom", from, to);
}

/** `?range=...` for a preset or custom range; the default (this month) has no query. */
export function rangeQuery(range: Pick<DashboardRange, "preset" | "from" | "to">): string {
  if (range.preset === "this_month") return "";
  if (range.preset === "last_month") return "?range=last_month";
  return `?range=custom&from=${range.from}&to=${range.to}`;
}
