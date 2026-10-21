import { describe, expect, it } from "vitest";

import { estimateSettlement, type SettlementPreview } from "@/features/settlement/totals";

/** The move-out settlement's arithmetic (ClickUp E13-T8). */
const preview = (overrides: Partial<SettlementPreview> = {}): SettlementPreview => ({
  allocationId: "a",
  residentId: "r",
  startDate: "2026-01-01",
  endDate: "2026-10-10",
  finalMonth: null,
  dues: [],
  creditHeld: 0,
  depositHeld: 0,
  settled: false,
  ...overrides,
});

const due = (balance: number, pendingCheques = 0) => ({
  invoiceId: "i",
  invoiceNumber: "INV-1",
  periodMonth: "2026-10-01",
  kind: "rent",
  balance,
  pendingCheques,
});

const choices = { deductions: 0, rebill: true, useDeposit: true };

describe("estimateSettlement", () => {
  it("refunds the deposit after deductions when nothing is owed", () => {
    expect(
      estimateSettlement(preview({ depositHeld: 1000000 }), { ...choices, deductions: 200000 }),
    ).toMatchObject({ refund: 800000, stillOwed: 0, net: -800000 });
  });

  it("uses credit, then the deposit, and shows what is still owed", () => {
    const result = estimateSettlement(
      preview({ dues: [due(500000)], creditHeld: 100000, depositHeld: 300000 }),
      choices,
    );
    expect(result).toMatchObject({
      creditUsed: 100000,
      paidFromDeposit: 300000,
      stillOwed: 100000,
      refund: 0,
      net: 100000,
    });
  });

  it("keeps the deposit apart when told to, and counts pending cheques as paying", () => {
    expect(
      estimateSettlement(preview({ dues: [due(500000, 200000)], depositHeld: 400000 }), {
        ...choices,
        useDeposit: false,
      }),
    ).toMatchObject({ owed: 300000, stillOwed: 300000, refund: 400000, net: 300000 });
  });

  it("re-bills the final month only when it can", () => {
    const finalMonth = {
      invoiceId: "i",
      invoiceNumber: "INV-1",
      periodMonth: "2026-10-01",
      billedRent: 900000,
      rentForNights: 300000,
      nights: 10,
      canRebill: true,
    };
    const base = preview({ dues: [due(900000)], depositHeld: 1000000, finalMonth });
    expect(estimateSettlement(base, choices)).toMatchObject({
      rebillSaving: 600000,
      paidFromDeposit: 300000,
      refund: 700000,
    });
    expect(
      estimateSettlement({ ...base, finalMonth: { ...finalMonth, canRebill: false } }, choices),
    ).toMatchObject({ rebillSaving: 0, paidFromDeposit: 900000, refund: 100000 });
    expect(estimateSettlement(base, { ...choices, rebill: false }).rebillSaving).toBe(0);
  });
});
