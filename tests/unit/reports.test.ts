import { describe, expect, it } from "vitest";

import {
  ageBucket,
  ageDues,
  reportPeriod,
  summariseCollections,
  toCsv,
  type MoneyIn,
} from "@/features/fees/reports";

/** Collection reports (ClickUp E13-T12). */
const entry = (overrides: Partial<MoneyIn>): MoneyIn => ({
  date: "2026-10-01",
  amount: 100000,
  mode: "cash",
  collector: "Asha",
  type: "payment",
  ...overrides,
});

describe("summariseCollections", () => {
  it("totals money in by mode, collector and day", () => {
    const summary = summariseCollections([
      entry({}),
      entry({ mode: "upi", amount: 250000, collector: "Ravi" }),
      entry({ date: "2026-10-02", amount: 50000, type: "advance" }),
    ]);
    expect(summary.total).toBe(400000);
    expect(summary.byMode).toEqual([
      { key: "upi", amount: 250000, count: 1 },
      { key: "cash", amount: 150000, count: 2 },
    ]);
    expect(summary.byCollector.map((row) => [row.key, row.amount])).toEqual([
      ["Ravi", 250000],
      ["Asha", 150000],
    ]);
    expect(summary.byDay).toEqual([
      { date: "2026-10-01", total: 350000, byMode: { cash: 100000, upi: 250000 } },
      { date: "2026-10-02", total: 50000, byMode: { cash: 50000 } },
    ]);
  });
});

describe("ageing", () => {
  it("puts each balance in a bucket by days past due", () => {
    expect(ageBucket("2026-10-19", "2026-10-19")).toBe("not_due");
    expect(ageBucket("2026-10-18", "2026-10-19")).toBe("0_30");
    expect(ageBucket("2026-09-19", "2026-10-19")).toBe("0_30");
    expect(ageBucket("2026-09-18", "2026-10-19")).toBe("31_60");
    expect(ageBucket("2026-07-21", "2026-10-19")).toBe("61_90");
    expect(ageBucket("2026-07-20", "2026-10-19")).toBe("90_plus");
    const ages = ageDues(
      [
        { dueDate: "2026-10-25", balance: 100 },
        { dueDate: "2026-01-01", balance: 200 },
        { dueDate: "2026-02-01", balance: 300 },
      ],
      "2026-10-19",
    );
    expect(ages.not_due).toEqual({ amount: 100, count: 1 });
    expect(ages["90_plus"]).toEqual({ amount: 500, count: 2 });
    expect(ages["0_30"]).toEqual({ amount: 0, count: 0 });
  });
});

describe("toCsv", () => {
  it("quotes, starts with a byte-order mark, and defuses formulas but not numbers", () => {
    const csv = toCsv(
      ["Name", "Amount"],
      [
        ['Ravi "R" Kumar, Jr', 85.5],
        ["=HYPERLINK(1)", -10],
        [null, 0],
      ],
    );
    expect(csv).toBe(
      '﻿Name,Amount\r\n"Ravi ""R"" Kumar, Jr",85.5\r\n\'=HYPERLINK(1),-10\r\n,0\r\n',
    );
  });
});

describe("reportPeriod", () => {
  const today = "2026-10-19";

  it("defaults to this month so far and this billing month", () => {
    expect(reportPeriod({}, today)).toEqual({
      from: "2026-10-01",
      to: today,
      month: "2026-10-01",
    });
  });

  it("swaps a reversed range, caps it at a year, and ignores bad input", () => {
    expect(reportPeriod({ from: "2026-10-10", to: "2026-10-01" }, today)).toMatchObject({
      from: "2026-10-01",
      to: "2026-10-10",
    });
    expect(reportPeriod({ from: "2020-01-01", to: "2026-10-19" }, today).from).toBe("2025-10-19");
    expect(reportPeriod({ from: "2026-02-30", to: "nope", month: "2026-13" }, today)).toEqual({
      from: "2026-10-01",
      to: today,
      month: "2026-10-01",
    });
    expect(reportPeriod({ month: "2026-08" }, today).month).toBe("2026-08-01");
  });
});
