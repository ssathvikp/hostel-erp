import { describe, expect, it } from "vitest";

import { daysBetween, formatMonth, formatPaise, paiseToInput, shiftMonth } from "@/lib/money";

describe("money display", () => {
  it("formats paise as rupees with Indian digit grouping", () => {
    expect(formatPaise(850000)).toBe("₹8,500");
    expect(formatPaise(16277500)).toBe("₹1,62,775");
    expect(formatPaise(0)).toBe("₹0");
  });

  it("shows paise only when there are any", () => {
    expect(formatPaise(822581)).toBe("₹8,225.81");
    expect(formatPaise(50)).toBe("₹0.50");
  });

  it("turns paise back into what a rupee field holds", () => {
    expect(paiseToInput(800000)).toBe("8000");
    expect(paiseToInput(800050)).toBe("8000.50");
  });
});

describe("billing months", () => {
  it("names a month, long or short", () => {
    expect(formatMonth("2026-10-01")).toBe("October 2026");
    expect(formatMonth("2026-10-01", { short: true })).toBe("Oct 2026");
  });

  it("moves across year boundaries", () => {
    expect(shiftMonth("2026-01-31", -1)).toBe("2025-12-01");
    expect(shiftMonth("2026-12-15", 1)).toBe("2027-01-01");
    expect(shiftMonth("2026-10-11", 0)).toBe("2026-10-01");
  });

  it("counts whole days between dates", () => {
    expect(daysBetween("2026-02-27", "2026-03-01")).toBe(2);
    expect(daysBetween("2026-10-11", "2026-10-05")).toBe(-6);
  });
});
