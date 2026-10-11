/**
 * Display helpers for money and billing months. Amounts arrive as integer
 * paise and are only turned into rupees here, for display.
 */

const wholeRupees = new Intl.NumberFormat("en-IN", {
  style: "currency",
  currency: "INR",
  maximumFractionDigits: 0,
});

const exactRupees = new Intl.NumberFormat("en-IN", {
  style: "currency",
  currency: "INR",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

/** `₹12,34,567` in Indian grouping; paise are shown only when there are any. */
export function formatPaise(paise: number): string {
  return (paise % 100 === 0 ? wholeRupees : exactRupees).format(paise / 100);
}

/** Paise as the plain rupee string a form field holds, e.g. `8500` or `8500.50`. */
export function paiseToInput(paise: number): string {
  return paise % 100 === 0 ? String(paise / 100) : (paise / 100).toFixed(2);
}

const monthName = new Intl.DateTimeFormat("en-IN", {
  month: "long",
  year: "numeric",
  timeZone: "UTC",
});

const shortMonthName = new Intl.DateTimeFormat("en-IN", {
  month: "short",
  year: "numeric",
  timeZone: "UTC",
});

/** `YYYY-MM-01` as `October 2026`, or `Oct 2026` with `short`. */
export function formatMonth(periodMonth: string, { short = false } = {}): string {
  return (short ? shortMonthName : monthName).format(
    new Date(`${periodMonth.slice(0, 7)}-01T00:00:00Z`),
  );
}

/** First day of the month `offset` months from the month containing `date` (`YYYY-MM-DD`). */
export function shiftMonth(date: string, offset: number): string {
  const [year, month] = date.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1 + offset, 1)).toISOString().slice(0, 10);
}

/** Whole days from `from` to `to` (both `YYYY-MM-DD`); negative when `to` is earlier. */
export function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);
}
