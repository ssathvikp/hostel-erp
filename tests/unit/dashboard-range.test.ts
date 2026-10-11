import { describe, expect, it } from "vitest";

import { parseRange, rangeQuery } from "@/features/dashboard/range";

const TODAY = "2026-10-11";

describe("dashboard range", () => {
  it("defaults to this calendar month, by day", () => {
    expect(parseRange({}, TODAY)).toEqual({
      preset: "this_month",
      from: "2026-10-01",
      to: "2026-10-31",
      granularity: "day",
      error: null,
    });
  });

  it("knows last month across a year boundary and in short months", () => {
    expect(parseRange({ range: "last_month" }, "2026-01-15")).toMatchObject({
      from: "2025-12-01",
      to: "2025-12-31",
    });
    expect(parseRange({ range: "last_month" }, "2028-03-02")).toMatchObject({
      from: "2028-02-01",
      to: "2028-02-29",
    });
  });

  it("accepts a custom range and picks months for long ones", () => {
    expect(
      parseRange({ range: "custom", from: "2026-09-15", to: "2026-10-05" }, TODAY),
    ).toMatchObject({ preset: "custom", granularity: "day", error: null });
    expect(
      parseRange({ range: "custom", from: "2026-01-01", to: "2026-10-11" }, TODAY),
    ).toMatchObject({ preset: "custom", granularity: "month" });
  });

  it("rejects reversed, incomplete, impossible, too long and future ranges with a reason", () => {
    const cases: [Record<string, string>, RegExp][] = [
      [{ range: "custom", from: "2026-10-05", to: "2026-09-01" }, /on or before the end date/],
      [{ range: "custom", from: "2026-10-05" }, /both a start and an end date/],
      [{ range: "custom", from: "2026-02-30", to: "2026-03-05" }, /both a start and an end date/],
      [{ range: "custom", from: "2023-01-01", to: "2026-10-01" }, /at most two years/],
      [{ range: "custom", from: "2026-11-01", to: "2026-11-30" }, /start today or earlier/],
    ];
    for (const [params, message] of cases) {
      const range = parseRange(params, TODAY);
      expect(range.preset).toBe("this_month");
      expect(range.error).toMatch(message);
    }
  });

  it("ignores unknown presets", () => {
    expect(parseRange({ range: "yesterday" }, TODAY)).toMatchObject({
      preset: "this_month",
      error: null,
    });
  });

  it("round-trips through the URL", () => {
    for (const params of [
      {},
      { range: "last_month" },
      { range: "custom", from: "2026-08-01", to: "2026-09-30" },
    ]) {
      const range = parseRange(params, TODAY);
      const query = Object.fromEntries(new URLSearchParams(rangeQuery(range)));
      expect(parseRange(query, TODAY)).toEqual(range);
    }
  });
});
