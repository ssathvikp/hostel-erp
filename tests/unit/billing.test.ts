import { describe, expect, it } from "vitest";

import { accountRuleMessage, READ_ONLY_MESSAGE } from "@/lib/billing/messages";
import {
  annualSaving,
  daysUntil,
  gstOn,
  GSTIN_PATTERN,
  monthly,
  previewPlanChange,
  stateName,
  withGst,
} from "@/lib/billing/pricing";

describe("GST arithmetic", () => {
  it("adds 18% GST to the paisa, as the database does", () => {
    expect(withGst(99900, 1800)).toBe(117882);
    expect(gstOn(99900, 1800)).toBe(17982);
    expect(withGst(50000, 1800)).toBe(59000);
    expect(withGst(1, 1800)).toBe(1);
  });

  it("compares plans per month across intervals", () => {
    expect(monthly(120000, "year")).toBe(10000);
    expect(monthly(10000, "month")).toBe(10000);
  });

  it("states the annual saving in months", () => {
    expect(annualSaving(99900, 999000)).toBe(2);
    expect(annualSaving(0, 0)).toBe(0);
  });
});

describe("plan change preview", () => {
  const period = {
    amount: 100000,
    interval: "month" as const,
    periodStart: "2026-10-01T00:00:00Z",
    periodEnd: "2026-10-31T00:00:00Z",
  };

  it("upgrades now, charging the difference for the unused part of the period", () => {
    const halfway = new Date("2026-10-16T00:00:00Z");
    expect(previewPlanChange(period, { amount: 200000, interval: "month" }, halfway)).toEqual({
      effect: "now",
      proration: 50000,
    });
  });

  it("downgrades and interval switches wait for the renewal", () => {
    expect(previewPlanChange(period, { amount: 50000, interval: "month" })).toEqual({
      effect: "renewal",
      proration: 0,
    });
    expect(previewPlanChange(period, { amount: 2_000_000, interval: "year" })).toEqual({
      effect: "renewal",
      proration: 0,
    });
  });
});

describe("account rule messages", () => {
  it("explains read-only mode and plan limits", () => {
    expect(accountRuleMessage({ code: "P0001", hint: "account_read_only", message: "x" })).toBe(
      READ_ONLY_MESSAGE,
    );
    expect(
      accountRuleMessage({
        code: "P0001",
        hint: "plan_limit_beds",
        message: "Your Starter plan allows up to 50 beds",
      }),
    ).toMatch(/^Your Starter plan allows up to 50 beds\. Remove some first/);
  });

  it("leaves every other error alone", () => {
    expect(
      accountRuleMessage({ code: "P0001", hint: "room_occupied", message: "x" }),
    ).toBeUndefined();
    expect(accountRuleMessage({ code: "23505", hint: "account_read_only" })).toBeUndefined();
    expect(accountRuleMessage(new Error("boom"))).toBeUndefined();
    expect(accountRuleMessage(null)).toBeUndefined();
  });
});

describe("helpers", () => {
  it("counts days left, rounding up and never below zero", () => {
    const now = new Date("2026-10-16T12:00:00Z");
    expect(daysUntil("2026-10-17T00:00:00Z", now)).toBe(1);
    expect(daysUntil("2026-10-30T12:00:00Z", now)).toBe(14);
    expect(daysUntil("2026-10-01T00:00:00Z", now)).toBe(0);
  });

  it("knows GST state codes and GSTIN shapes", () => {
    expect(stateName("29")).toBe("Karnataka");
    expect(stateName("99")).toBeNull();
    expect(GSTIN_PATTERN.test("29ABCDE1234F1Z5")).toBe(true);
    expect(GSTIN_PATTERN.test("29ABCDE1234F1X5")).toBe(false);
  });
});
