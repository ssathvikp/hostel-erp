import type { BadgeTone, SelectOption } from "@/components/ui";
import { DEPOSIT_ENTRY_KINDS, type DepositEntryKind } from "@/types";

export const DEPOSIT_KIND_LABELS: Record<DepositEntryKind, string> = {
  collected: "Collected",
  deduction: "Deducted",
  refund: "Refunded",
};

export const DEPOSIT_KIND_TONES: Record<DepositEntryKind, BadgeTone> = {
  collected: "success",
  deduction: "warning",
  refund: "info",
};

/** Form choices, phrased as what the person did. */
export const DEPOSIT_KIND_OPTIONS: readonly SelectOption[] = DEPOSIT_ENTRY_KINDS.map((kind) => ({
  value: kind,
  label: {
    collected: "Collected deposit",
    deduction: "Kept part of the deposit (deduction)",
    refund: "Refunded deposit",
  }[kind],
}));

export function isDepositKind(value: unknown): value is DepositEntryKind {
  return (DEPOSIT_ENTRY_KINDS as readonly unknown[]).includes(value);
}
