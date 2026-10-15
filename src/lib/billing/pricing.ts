/**
 * Price arithmetic shown on the billing page (E14-T1, T8). The database is
 * the authority (private.plan_amount, private.with_gst and
 * billing_quote_change); these mirror it so the page can explain a choice
 * before the owner makes it. All amounts are integer paise.
 */

export type Interval = "month" | "year";

/** Price plus GST, rounded to the paisa, as the gateway charges it. */
export function withGst(amount: number, rateBps: number): number {
  return Math.round((amount * (10000 + rateBps)) / 10000);
}

/** The GST part of a price. */
export function gstOn(amount: number, rateBps: number): number {
  return withGst(amount, rateBps) - amount;
}

/** A period's price expressed per month, for comparing plans across intervals. */
export function monthly(amount: number, interval: Interval): number {
  return interval === "year" ? amount / 12 : amount;
}

export interface PlanChangePreview {
  /** "now" for an upgrade on the same interval; otherwise at renewal. */
  effect: "now" | "renewal";
  /** Extra for the rest of this period on an upgrade, excluding GST. */
  proration: number;
}

/**
 * What changing plan does: an upgrade (dearer per month, same interval)
 * starts now and costs the difference for the unused part of the period; a
 * downgrade or interval switch waits for the renewal.
 */
export function previewPlanChange(
  current: {
    amount: number;
    interval: Interval;
    periodStart: string | null;
    periodEnd: string | null;
  },
  next: { amount: number; interval: Interval },
  now: Date = new Date(),
): PlanChangePreview {
  const upgrade =
    next.interval === current.interval &&
    monthly(next.amount, next.interval) > monthly(current.amount, current.interval);
  if (!upgrade) return { effect: "renewal", proration: 0 };
  if (!current.periodStart || !current.periodEnd) return { effect: "now", proration: 0 };
  const start = Date.parse(current.periodStart);
  const end = Date.parse(current.periodEnd);
  if (!(end > now.getTime()) || !(end > start)) return { effect: "now", proration: 0 };
  const remaining = (end - now.getTime()) / (end - start);
  return { effect: "now", proration: Math.round((next.amount - current.amount) * remaining) };
}

/** Annual price as months saved against paying monthly, for the annual toggle. */
export function annualSaving(monthlyPrice: number, annualPrice: number): number {
  if (monthlyPrice <= 0 || annualPrice <= 0) return 0;
  return Math.max(0, Math.round(((monthlyPrice * 12 - annualPrice) / monthlyPrice) * 10) / 10);
}

/** Whole days from now until `iso`, never negative; partial days count as a day. */
export function daysUntil(iso: string, now: Date = new Date()): number {
  return Math.max(0, Math.ceil((Date.parse(iso) - now.getTime()) / 86_400_000));
}

/** Indian states and union territories by GST state code, for billing details. */
export const GST_STATES: readonly { code: string; name: string }[] = [
  { code: "01", name: "Jammu and Kashmir" },
  { code: "02", name: "Himachal Pradesh" },
  { code: "03", name: "Punjab" },
  { code: "04", name: "Chandigarh" },
  { code: "05", name: "Uttarakhand" },
  { code: "06", name: "Haryana" },
  { code: "07", name: "Delhi" },
  { code: "08", name: "Rajasthan" },
  { code: "09", name: "Uttar Pradesh" },
  { code: "10", name: "Bihar" },
  { code: "11", name: "Sikkim" },
  { code: "12", name: "Arunachal Pradesh" },
  { code: "13", name: "Nagaland" },
  { code: "14", name: "Manipur" },
  { code: "15", name: "Mizoram" },
  { code: "16", name: "Tripura" },
  { code: "17", name: "Meghalaya" },
  { code: "18", name: "Assam" },
  { code: "19", name: "West Bengal" },
  { code: "20", name: "Jharkhand" },
  { code: "21", name: "Odisha" },
  { code: "22", name: "Chhattisgarh" },
  { code: "23", name: "Madhya Pradesh" },
  { code: "24", name: "Gujarat" },
  { code: "26", name: "Dadra and Nagar Haveli and Daman and Diu" },
  { code: "27", name: "Maharashtra" },
  { code: "29", name: "Karnataka" },
  { code: "30", name: "Goa" },
  { code: "31", name: "Lakshadweep" },
  { code: "32", name: "Kerala" },
  { code: "33", name: "Tamil Nadu" },
  { code: "34", name: "Puducherry" },
  { code: "35", name: "Andaman and Nicobar Islands" },
  { code: "36", name: "Telangana" },
  { code: "37", name: "Andhra Pradesh" },
  { code: "38", name: "Ladakh" },
];

export function stateName(code: string | null | undefined): string | null {
  return GST_STATES.find((state) => state.code === code)?.name ?? null;
}

/** GSTIN format: state code, PAN, entity number, Z, checksum character. */
export const GSTIN_PATTERN = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/;
