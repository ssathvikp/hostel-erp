import { describe, expect, it } from "vitest";

import { receiptTotals } from "@/features/fees/receipt";
import {
  discountSchema,
  feeHeadPriceSchema,
  meterReadingSchema,
  paymentSchema,
} from "@/lib/validation";

const RESIDENT = "00000000-0000-4000-8000-000000000001";

describe("discountSchema", () => {
  const base = {
    resident_id: RESIDENT,
    head_id: "",
    kind: "percent",
    value: "10",
    from_month: "2026-04",
    to_month: "",
    reason: "Sibling",
  };

  it("keeps a percentage as a whole number and a fixed amount in paise", () => {
    expect(discountSchema.parse(base)).toMatchObject({
      value: 10,
      from_month: "2026-04-01",
      to_month: null,
    });
    expect(discountSchema.parse({ ...base, kind: "fixed", value: "500.50" }).value).toBe(50050);
  });

  it("refuses a percentage above 100, a fraction of a percent, and an end before the start", () => {
    expect(discountSchema.safeParse({ ...base, value: "150" }).success).toBe(false);
    expect(discountSchema.safeParse({ ...base, value: "12.5" }).success).toBe(false);
    expect(discountSchema.safeParse({ ...base, to_month: "2026-03" }).success).toBe(false);
  });
});

describe("feeHeadPriceSchema", () => {
  it("treats an empty sharing type as every type", () => {
    const parsed = feeHeadPriceSchema.parse({
      head_id: RESIDENT,
      sharing_type: "",
      amount: "300",
      effective_from: "2026-04-01",
    });
    expect(parsed).toMatchObject({ sharing_type: null, amount: 30000 });
  });
});

describe("meterReadingSchema", () => {
  it("accepts one decimal place and refuses more, or a negative reading", () => {
    const row = { room_id: RESIDENT, reading_month: "2026-01" };
    expect(meterReadingSchema.parse({ ...row, reading: "1234.5" }).reading).toBe(1234.5);
    expect(meterReadingSchema.safeParse({ ...row, reading: "12.25" }).success).toBe(false);
    expect(meterReadingSchema.safeParse({ ...row, reading: "-1" }).success).toBe(false);
  });
});

describe("paymentSchema with cheques", () => {
  const base = {
    invoice_id: RESIDENT,
    amount: "5000",
    paid_at: "2026-01-05",
    mode: "cheque",
    reference: "",
  };
  it("needs a cheque number and bank for a cheque only", () => {
    expect(paymentSchema.safeParse(base).success).toBe(false);
    expect(
      paymentSchema.parse({ ...base, cheque_number: "001122", cheque_bank: "SBI" }),
    ).toMatchObject({ cheque_number: "001122", cheque_bank: "SBI" });
    expect(paymentSchema.parse({ ...base, mode: "upi" }).cheque_number).toBeNull();
  });
});

describe("receiptTotals with a pending cheque", () => {
  it("does not count an uncleared cheque as paid", () => {
    const payments = [
      {
        id: "a",
        amount: 3000,
        paidAt: "2026-01-02",
        recordedAt: "1",
        voidedAt: null,
        clearedAt: "x",
      },
      {
        id: "b",
        amount: 2000,
        paidAt: "2026-01-03",
        recordedAt: "2",
        voidedAt: null,
        clearedAt: null,
      },
    ];
    expect(receiptTotals(8000, payments, "b")).toEqual({ paidToDate: 3000, balance: 5000 });
  });
});
