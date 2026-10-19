import { daysBetween } from "@/lib/money";

/**
 * Collection reports (ClickUp E13-T12): pure summaries the reports page and
 * its CSV downloads share, so the numbers on screen and in the file agree.
 */

/** Money that came in: a payment against an invoice, or an advance kept as credit. */
export interface MoneyIn {
  date: string;
  amount: number;
  mode: string;
  collector: string;
  type: "payment" | "advance";
}

export interface Total {
  key: string;
  amount: number;
  count: number;
}

export interface CollectionSummary {
  total: number;
  byMode: Total[];
  byCollector: Total[];
  /** One row per day with money in, oldest first. */
  byDay: { date: string; total: number; byMode: Record<string, number> }[];
}

function totals(entries: readonly MoneyIn[], key: (entry: MoneyIn) => string): Total[] {
  const map = new Map<string, Total>();
  for (const entry of entries) {
    const k = key(entry);
    const row = map.get(k) ?? { key: k, amount: 0, count: 0 };
    row.amount += entry.amount;
    row.count += 1;
    map.set(k, row);
  }
  return [...map.values()].sort((a, b) => b.amount - a.amount || a.key.localeCompare(b.key));
}

export function summariseCollections(entries: readonly MoneyIn[]): CollectionSummary {
  const days = new Map<string, { date: string; total: number; byMode: Record<string, number> }>();
  for (const entry of entries) {
    const day = days.get(entry.date) ?? { date: entry.date, total: 0, byMode: {} };
    day.total += entry.amount;
    day.byMode[entry.mode] = (day.byMode[entry.mode] ?? 0) + entry.amount;
    days.set(entry.date, day);
  }
  return {
    total: entries.reduce((sum, entry) => sum + entry.amount, 0),
    byMode: totals(entries, (entry) => entry.mode),
    byCollector: totals(entries, (entry) => entry.collector),
    byDay: [...days.values()].sort((a, b) => a.date.localeCompare(b.date)),
  };
}

export const AGE_BUCKETS = [
  { key: "not_due", label: "Not yet due" },
  { key: "0_30", label: "1–30 days late" },
  { key: "31_60", label: "31–60 days late" },
  { key: "61_90", label: "61–90 days late" },
  { key: "90_plus", label: "Over 90 days late" },
] as const;

export type AgeBucket = (typeof AGE_BUCKETS)[number]["key"];

/** Which ageing bucket a balance due on `dueDate` falls in on `today`. */
export function ageBucket(dueDate: string, today: string): AgeBucket {
  const late = daysBetween(dueDate, today);
  if (late <= 0) return "not_due";
  if (late <= 30) return "0_30";
  if (late <= 60) return "31_60";
  if (late <= 90) return "61_90";
  return "90_plus";
}

/** Outstanding balances grouped by how late they are. */
export function ageDues(
  dues: readonly { dueDate: string; balance: number }[],
  today: string,
): Record<AgeBucket, { amount: number; count: number }> {
  const result = Object.fromEntries(
    AGE_BUCKETS.map((bucket) => [bucket.key, { amount: 0, count: 0 }]),
  ) as Record<AgeBucket, { amount: number; count: number }>;
  for (const due of dues) {
    const bucket = result[ageBucket(due.dueDate, today)];
    bucket.amount += due.balance;
    bucket.count += 1;
  }
  return result;
}

/** Paise as a plain rupee number for a spreadsheet, e.g. `8500.5`. */
export function csvRupees(paise: number): number {
  return paise / 100;
}

/**
 * One CSV cell. Text that a spreadsheet would run as a formula (a resident
 * named "=HYPERLINK(...)") gets a leading apostrophe; numbers are left alone.
 */
function csvCell(value: string | number | null | undefined): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "number") return String(value);
  const safe = /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
  return /[",\r\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

/** A CSV file with a byte-order mark so Excel reads ₹ and Indian names as UTF-8. */
export function toCsv(
  header: readonly string[],
  rows: readonly (readonly (string | number | null | undefined)[])[],
): string {
  return `\uFEFF${[header, ...rows].map((row) => row.map(csvCell).join(",")).join("\r\n")}\r\n`;
}

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const MONTH = /^\d{4}-\d{2}$/;
const MAX_RANGE_DAYS = 366;

function validDate(value: string | undefined): value is string {
  return (
    value !== undefined &&
    DATE.test(value) &&
    !Number.isNaN(Date.parse(`${value}T00:00:00Z`)) &&
    new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value
  );
}

/**
 * The period a report covers, from the URL: a date range for money in
 * (this month so far by default, at most a year) and a billing month for the
 * register (`YYYY-MM-01`, this month by default). Anything malformed falls
 * back to the default rather than erroring.
 */
export function reportPeriod(
  params: { from?: string; to?: string; month?: string },
  today: string,
): { from: string; to: string; month: string } {
  const monthStart = `${today.slice(0, 7)}-01`;
  let to = validDate(params.to) ? params.to : today;
  let from = validDate(params.from)
    ? params.from
    : to === today
      ? monthStart
      : `${to.slice(0, 7)}-01`;
  if (from > to) [from, to] = [to, from];
  if (daysBetween(from, to) >= MAX_RANGE_DAYS) {
    from = new Date(Date.parse(`${to}T00:00:00Z`) - (MAX_RANGE_DAYS - 1) * 86_400_000)
      .toISOString()
      .slice(0, 10);
  }
  const month =
    params.month && MONTH.test(params.month) && validDate(`${params.month}-01`)
      ? `${params.month}-01`
      : monthStart;
  return { from, to, month };
}
