import { describe, expect, it } from "vitest";

import { describeLateFeeRule, explainLateFee, isLateFeeLine } from "@/features/fees/late-fees";
import { invoiceLabel } from "@/features/fees/options";
import type { LateFeeLine, Paise } from "@/types";

describe("describeLateFeeRule", () => {
  it("says when late fees are off", () => {
    expect(describeLateFeeRule({ mode: "off", amount: null, cap: null, graceDays: 3 })).toBe(
      "Late fees are off.",
    );
  });

  it("describes a fixed fee with grace days", () => {
    expect(describeLateFeeRule({ mode: "fixed", amount: 25000, cap: null, graceDays: 3 })).toBe(
      "A late fee of ₹250 applies from 3 days after rent is due.",
    );
  });

  it("describes a per-day fee with no grace and a cap", () => {
    expect(describeLateFeeRule({ mode: "per_day", amount: 5000, cap: 100000, graceDays: 0 })).toBe(
      "A late fee of ₹50 a day applies from the day after rent is due, up to ₹1,000 per month's rent.",
    );
  });
});

describe("explainLateFee", () => {
  const base: LateFeeLine = {
    type: "late_fee",
    invoice_id: "00000000-0000-0000-0000-000000000000",
    rule: "per_day",
    rate: 5000 as Paise,
    cap: 30000 as Paise,
    grace_days: 3,
    rent_due_date: "2026-06-05",
    settled_on: "2026-06-12",
    days_late: 4,
  };

  it("explains a per-day fee paid late", () => {
    expect(explainLateFee(base)).toBe(
      "Rent due 5 Jun 2026, paid in full on 12 Jun 2026: 4 days late after the 3-day grace period. ₹50 a day.",
    );
  });

  it("says when the cap was reached and the rent is still owed", () => {
    expect(explainLateFee({ ...base, settled_on: null, days_late: 10 })).toContain(
      "still unpaid: 10 days late",
    );
    expect(explainLateFee({ ...base, settled_on: null, days_late: 10 })).toContain(
      "capped at ₹300",
    );
  });

  it("explains a fixed fee", () => {
    expect(explainLateFee({ ...base, rule: "fixed", grace_days: 0, days_late: 1 })).toBe(
      "Rent due 5 Jun 2026, paid in full on 12 Jun 2026: 1 day late. Fixed late fee.",
    );
  });

  it("recognises late-fee lines", () => {
    expect(isLateFeeLine(base)).toBe(true);
    expect(isLateFeeLine({ allocation_id: "x", nights: 30 })).toBe(false);
    expect(isLateFeeLine(null)).toBe(false);
  });
});

describe("invoiceLabel", () => {
  it("names rent by its month and a late fee as such", () => {
    expect(invoiceLabel({ periodMonth: "2026-06-01", kind: "rent" })).toBe("June 2026");
    expect(invoiceLabel({ periodMonth: "2026-06-01", kind: "late_fee" })).toBe(
      "June 2026 late fee",
    );
  });
});
