import { z } from "zod";

import { rupeesToPaise } from "@/types";

/**
 * Reusable field schemas. Every schema accepts raw form input (strings) and
 * outputs the normalised value that is stored in the database.
 */

/** Treats an empty or whitespace-only form value as "not provided". */
function emptyToUndefined(value: unknown) {
  return typeof value === "string" && value.trim() === "" ? undefined : value;
}

/** Wraps a schema so that a blank form field becomes `null`. */
export function optional<S extends z.ZodType>(schema: S) {
  return z.preprocess(emptyToUndefined, schema.optional()).transform((value) => value ?? null);
}

export const requiredText = (label: string, max = 200) =>
  z
    .string({ error: `${label} is required` })
    .trim()
    .min(1, { error: `${label} is required` })
    .max(max, { error: `${label} must be at most ${max} characters` });

/**
 * Indian mobile number. Accepts spaces, dashes and a +91 / 91 / 0 prefix, and
 * normalises to the bare 10 digits so duplicates can be detected reliably.
 */
export const indianMobile = z
  .string({ error: "Phone number is required" })
  .transform((value) => value.replace(/[\s()-]/g, ""))
  .transform((value) => value.replace(/^(?:\+91|91|0)(?=\d{10}$)/, ""))
  .refine((value) => /^[6-9]\d{9}$/.test(value), {
    error: "Enter a valid 10-digit Indian mobile number",
  });

export const pincode = z
  .string({ error: "PIN code is required" })
  .trim()
  .regex(/^[1-9]\d{5}$/, { error: "Enter a valid 6-digit PIN code" });

export const email = z
  .string()
  .trim()
  .toLowerCase()
  .pipe(z.email({ error: "Enter a valid email address" }));

/** `YYYY-MM-DD` calendar date. */
export const isoDate = (label: string) => z.iso.date({ error: `${label} must be a valid date` });

export const uuid = (label: string) => z.uuid({ error: `${label} is invalid` });

export const integer = (label: string, min: number, max: number) =>
  z.coerce
    .number({ error: `${label} must be a number` })
    .int({ error: `${label} must be a whole number` })
    .min(min, { error: `${label} must be at least ${min}` })
    .max(max, { error: `${label} must be at most ${max}` });

/**
 * A rupee amount typed by a user (up to 2 decimal places), output as integer
 * paise. Use `positive: false` to allow zero.
 */
export const rupees = (
  label: string,
  { positive = true, max = 10_00_000 }: { positive?: boolean; max?: number } = {},
) =>
  z.coerce
    .number({ error: `${label} must be a number` })
    .refine((value) => Number.isFinite(value), {
      error: `${label} must be a number`,
    })
    .refine((value) => (positive ? value > 0 : value >= 0), {
      error: positive ? `${label} must be greater than zero` : `${label} cannot be negative`,
    })
    .refine((value) => value <= max, {
      error: `${label} must be at most ₹${max.toLocaleString("en-IN")}`,
    })
    // Tolerance absorbs float noise such as 10.1 * 100 = 1010.0000000000001.
    .refine((value) => Math.abs(value * 100 - Math.round(value * 100)) < 1e-6, {
      error: `${label} can have at most 2 decimal places`,
    })
    .transform(rupeesToPaise);

/** Today's date as `YYYY-MM-DD` in India Standard Time. */
export function todayIst(now: Date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" }).format(now);
}

/** Whole years between a `YYYY-MM-DD` birth date and `today`. */
export function ageOn(dob: string, today: string): number {
  const [by, bm, bd] = dob.split("-").map(Number);
  const [ty, tm, td] = today.split("-").map(Number);
  return ty - by - (tm < bm || (tm === bm && td < bd) ? 1 : 0);
}
