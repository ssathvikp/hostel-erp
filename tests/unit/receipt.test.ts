import { describe, expect, it } from "vitest";

import { receiptTotals, type ReceiptPayment } from "@/features/fees/receipt";

const pay = (
  id: string,
  amount: number,
  paidAt: string,
  recordedAt: string,
  voided = false,
): ReceiptPayment => ({
  id,
  amount,
  paidAt,
  recordedAt,
  voidedAt: voided ? "2026-10-02T00:00:00Z" : null,
});

describe("receipt totals", () => {
  const payments = [
    pay("second", 400000, "2026-10-10", "2026-10-10T09:00:00Z"),
    pay("first", 400000, "2026-10-01", "2026-10-01T09:00:00Z"),
    pay("bounced", 100000, "2026-10-05", "2026-10-05T09:00:00Z", true),
  ];

  it("shows what was paid and owed as of each payment", () => {
    expect(receiptTotals(800000, payments, "first")).toEqual({
      paidToDate: 400000,
      balance: 400000,
    });
    expect(receiptTotals(800000, payments, "second")).toEqual({ paidToDate: 800000, balance: 0 });
  });

  it("leaves void payments out", () => {
    expect(receiptTotals(800000, payments, "bounced")).toEqual({
      paidToDate: 400000,
      balance: 400000,
    });
  });

  it("orders same-day payments by when they were recorded", () => {
    const sameDay = [
      pay("b", 100, "2026-10-01", "2026-10-01T10:00:00Z"),
      pay("a", 100, "2026-10-01", "2026-10-01T09:00:00Z"),
    ];
    expect(receiptTotals(500, sameDay, "a").paidToDate).toBe(100);
    expect(receiptTotals(500, sameDay, "b").paidToDate).toBe(200);
  });
});
