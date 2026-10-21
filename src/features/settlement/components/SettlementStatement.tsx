import { DocumentHeader, type Letterhead } from "@/features/fees/components/InvoiceDocument";
import { PAYMENT_MODE_LABELS } from "@/features/fees/options";
import { formatMonth, formatPaise } from "@/lib/money";
import type { PaymentMode } from "@/types";

import type { SavedSettlement } from "../queries";

const day = new Intl.DateTimeFormat("en-IN", { dateStyle: "medium", timeZone: "UTC" });
const settledOn = new Intl.DateTimeFormat("en-IN", {
  dateStyle: "medium",
  timeZone: "Asia/Kolkata",
});

function Line({ label, amount, strong }: { label: string; amount: string; strong?: boolean }) {
  return (
    <tr className={strong ? "font-semibold" : undefined}>
      <td className="py-2 pr-4">{label}</td>
      <td className="py-2 text-right tabular-nums">{amount}</td>
    </tr>
  );
}

/** The printable move-out settlement statement (ClickUp E13-T8). */
export function SettlementStatement({
  hostel,
  settlement,
  residentName,
  room,
}: {
  hostel: Letterhead;
  settlement: SavedSettlement;
  residentName: string;
  room: string;
}) {
  const s = settlement.statement;
  const refund = s.deposit_refund + s.credit_refund;
  return (
    <article className="space-y-6 text-slate-900">
      <DocumentHeader
        hostel={hostel}
        title="Move-out settlement"
        number={settledOn.format(new Date(settlement.settledAt))}
      />
      <dl className="grid grid-cols-2 gap-x-8 gap-y-1 text-sm sm:grid-cols-4">
        <dt className="text-slate-500">Resident</dt>
        <dd className="font-medium">{residentName}</dd>
        <dt className="text-slate-500">Room / bed</dt>
        <dd>{room || "—"}</dd>
        <dt className="text-slate-500">Last night</dt>
        <dd>{day.format(new Date(s.end_date))}</dd>
        <dt className="text-slate-500">Settled by</dt>
        <dd>{settlement.settledByName ?? "—"}</dd>
      </dl>
      <table className="w-full text-sm">
        <caption className="sr-only">Settlement</caption>
        <tbody className="divide-y divide-slate-200">
          {s.rebilled && (
            <Line
              label={`${formatMonth(s.rebilled.period_month)} re-billed for the nights held (invoice ${s.rebilled.voided_invoice_number} voided)`}
              amount={`${formatPaise(s.rebilled.billed_rent)} → ${formatPaise(s.rebilled.rent)}`}
            />
          )}
          <Line label="Security deposit held" amount={formatPaise(s.before.deposit_held)} />
          <Line label="Advance credit held" amount={formatPaise(s.before.credit_held)} />
          {s.credit_applied > 0 && (
            <Line label="Credit used for dues" amount={`-${formatPaise(s.credit_applied)}`} />
          )}
          {s.deductions.map((deduction, index) => (
            <Line
              key={index}
              label={`Deduction: ${deduction.reason}`}
              amount={`-${formatPaise(deduction.amount)}`}
            />
          ))}
          {s.paid_from_deposit > 0 && (
            <Line label="Deposit used for dues" amount={`-${formatPaise(s.paid_from_deposit)}`} />
          )}
          {refund > 0 && (
            <Line
              label={`Refunded${s.refund_mode ? ` by ${PAYMENT_MODE_LABELS[s.refund_mode as PaymentMode] ?? s.refund_mode}` : ""}${s.refund_reference ? ` (${s.refund_reference})` : ""}`}
              amount={formatPaise(refund)}
            />
          )}
          {settlement.netAmount > 0 ? (
            <Line
              label="Still owed by the resident"
              amount={formatPaise(settlement.netAmount)}
              strong
            />
          ) : (
            <Line
              label="Net refund to the resident"
              amount={formatPaise(-settlement.netAmount)}
              strong
            />
          )}
        </tbody>
      </table>
      <p className="text-xs text-slate-500">
        Amounts as at settlement. Dues still owed stay on the resident&apos;s invoices.
      </p>
    </article>
  );
}
