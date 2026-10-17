/**
 * What a receipt says was paid and still owed: as of that payment, not as
 * of today. A receipt for the first of two part payments must still show
 * the balance that was left then.
 */
export interface ReceiptPayment {
  id: string;
  amount: number;
  /** The day the money was received. */
  paidAt: string;
  /** When it was entered; orders payments received on the same day. */
  recordedAt: string;
  voidedAt: string | null;
}

export function receiptTotals(
  invoiceAmount: number,
  payments: readonly ReceiptPayment[],
  paymentId: string,
): { paidToDate: number; balance: number } {
  const order = (payment: ReceiptPayment) => `${payment.paidAt}|${payment.recordedAt}`;
  const target = payments.find((payment) => payment.id === paymentId);
  if (!target) return { paidToDate: 0, balance: invoiceAmount };
  const paidToDate = payments
    .filter((payment) => !payment.voidedAt && order(payment) <= order(target))
    .reduce((sum, payment) => sum + payment.amount, 0);
  return { paidToDate, balance: Math.max(0, invoiceAmount - paidToDate) };
}
