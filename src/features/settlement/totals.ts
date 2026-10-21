/**
 * The move-out settlement's arithmetic (ClickUp E13-T8), as the form shows it
 * before anything is written. `settle_move_out` does the same steps in the
 * database; the statement it saves is what counts.
 */
export interface SettlementPreview {
  allocationId: string;
  residentId: string;
  startDate: string;
  endDate: string;
  finalMonth: {
    invoiceId: string;
    invoiceNumber: string;
    periodMonth: string;
    billedRent: number;
    rentForNights: number;
    nights: number;
    canRebill: boolean;
  } | null;
  dues: {
    invoiceId: string;
    invoiceNumber: string;
    periodMonth: string;
    kind: string;
    balance: number;
    pendingCheques: number;
  }[];
  creditHeld: number;
  depositHeld: number;
  settled: boolean;
}

export interface SettlementChoices {
  deductions: number;
  rebill: boolean;
  useDeposit: boolean;
}

export interface SettlementEstimate {
  /** Less on the final month when it is re-billed for the nights held. */
  rebillSaving: number;
  owed: number;
  creditUsed: number;
  depositAfterDeductions: number;
  paidFromDeposit: number;
  stillOwed: number;
  refund: number;
  /** Positive: the resident owes this. Negative: they are refunded this. */
  net: number;
}

export function estimateSettlement(
  preview: SettlementPreview,
  choices: SettlementChoices,
): SettlementEstimate {
  const final = preview.finalMonth;
  const rebillSaving =
    choices.rebill && final?.canRebill ? Math.max(0, final.billedRent - final.rentForNights) : 0;
  const dues = preview.dues.reduce((sum, due) => sum + due.balance - due.pendingCheques, 0);
  const owed = Math.max(0, dues - rebillSaving);
  const creditUsed = Math.min(preview.creditHeld, owed);
  const afterCredit = owed - creditUsed;
  const depositAfterDeductions = Math.max(0, preview.depositHeld - choices.deductions);
  const paidFromDeposit = choices.useDeposit ? Math.min(afterCredit, depositAfterDeductions) : 0;
  const stillOwed = afterCredit - paidFromDeposit;
  const refund = depositAfterDeductions - paidFromDeposit + (preview.creditHeld - creditUsed);
  return {
    rebillSaving,
    owed,
    creditUsed,
    depositAfterDeductions,
    paidFromDeposit,
    stillOwed,
    refund,
    net: stillOwed > 0 ? stillOwed : -refund,
  };
}

/** The database's snake_case preview, as the app reads it. */
export function toPreview(raw: Record<string, unknown>): SettlementPreview {
  const final = raw.final_month as Record<string, unknown> | null;
  return {
    allocationId: String(raw.allocation_id),
    residentId: String(raw.resident_id),
    startDate: String(raw.start_date),
    endDate: String(raw.end_date),
    finalMonth: final
      ? {
          invoiceId: String(final.invoice_id),
          invoiceNumber: String(final.invoice_number),
          periodMonth: String(final.period_month),
          billedRent: Number(final.billed_rent),
          rentForNights: Number(final.rent_for_nights),
          nights: Number(final.nights),
          canRebill: Boolean(final.can_rebill),
        }
      : null,
    dues: ((raw.dues as Record<string, unknown>[]) ?? []).map((due) => ({
      invoiceId: String(due.invoice_id),
      invoiceNumber: String(due.invoice_number),
      periodMonth: String(due.period_month),
      kind: String(due.kind),
      balance: Number(due.balance),
      pendingCheques: Number(due.pending_cheques),
    })),
    creditHeld: Number(raw.credit_held),
    depositHeld: Number(raw.deposit_held),
    settled: Boolean(raw.settled),
  };
}
