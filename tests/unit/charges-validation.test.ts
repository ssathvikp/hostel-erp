import { describe, expect, it } from "vitest";

import {
  chargeSchema,
  discountSchema,
  feeHeadSchema,
  lateFeeRuleSchema,
  todayIst,
  validate,
} from "@/lib/validation";

const RESIDENT = "0f8fad5b-d9cb-469f-a165-70867728950e";
const HEAD = "7c9e6679-7425-40de-944b-e07fc1f90ae7";

describe("feeHeadSchema", () => {
  it("refuses rent and a first-stay monthly charge", () => {
    expect(validate(feeHeadSchema, { name: "Rent", billing: "monthly", pricing: "flat" }).ok).toBe(
      false,
    );
    const firstStay = validate(feeHeadSchema, {
      name: "Mess",
      billing: "monthly",
      pricing: "flat",
      charge_on_first_stay: "on",
    });
    expect(firstStay.ok ? null : firstStay.fieldErrors.charge_on_first_stay).toBeTruthy();
    expect(
      validate(feeHeadSchema, {
        name: "Admission",
        billing: "one_time",
        pricing: "flat",
        charge_on_first_stay: "on",
      }),
    ).toMatchObject({ ok: true, data: { charge_on_first_stay: true } });
  });
});

describe("chargeSchema", () => {
  it("needs a description or a charge from the list, and no future date", () => {
    const base = { resident_id: RESIDENT, amount: "250", charge_date: todayIst() };
    expect(validate(chargeSchema, base).ok).toBe(false);
    expect(validate(chargeSchema, { ...base, fee_head_id: HEAD })).toMatchObject({
      ok: true,
      data: { amount: 25000, description: null },
    });
    expect(
      validate(chargeSchema, { ...base, description: "Key", charge_date: "2999-01-01" }).ok,
    ).toBe(false);
  });
});

describe("discountSchema", () => {
  const base = {
    resident_id: RESIDENT,
    target: "rent",
    from_month: "2026-10",
    reason: "Sibling",
  };

  it("turns a percentage or an amount into what the database stores", () => {
    expect(validate(discountSchema, { ...base, measure: "percent", value: "10" })).toMatchObject({
      ok: true,
      data: {
        fee_head_id: null,
        percent: 10,
        amount: null,
        from_month: "2026-10-01",
        to_month: null,
      },
    });
    expect(
      validate(discountSchema, {
        ...base,
        target: HEAD,
        measure: "fixed",
        value: "500.50",
        to_month: "2026-12",
      }),
    ).toMatchObject({
      ok: true,
      data: { fee_head_id: HEAD, percent: null, amount: 50050, to_month: "2026-12-01" },
    });
  });

  it("refuses odd percentages, reversed months and paise fractions", () => {
    expect(validate(discountSchema, { ...base, measure: "percent", value: "150" }).ok).toBe(false);
    expect(validate(discountSchema, { ...base, measure: "percent", value: "12.5" }).ok).toBe(false);
    expect(validate(discountSchema, { ...base, measure: "fixed", value: "1.234" }).ok).toBe(false);
    expect(
      validate(discountSchema, { ...base, measure: "percent", value: "10", to_month: "2026-09" })
        .ok,
    ).toBe(false);
  });
});

describe("lateFeeRuleSchema", () => {
  it("needs a cap for a per-day fee and drops it for a fixed one", () => {
    const base = { grace_days: "3", amount: "50", active: "on" };
    expect(validate(lateFeeRuleSchema, { ...base, kind: "per_day" }).ok).toBe(false);
    expect(validate(lateFeeRuleSchema, { ...base, kind: "per_day", cap: "20" }).ok).toBe(false);
    expect(validate(lateFeeRuleSchema, { ...base, kind: "per_day", cap: "500" })).toMatchObject({
      ok: true,
      data: { kind: "per_day", amount: 5000, cap: 50000, grace_days: 3, active: true },
    });
    expect(validate(lateFeeRuleSchema, { ...base, kind: "fixed", cap: "500" })).toMatchObject({
      ok: true,
      data: { cap: null },
    });
  });
});
