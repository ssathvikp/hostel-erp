import { SHARING_TYPE_LABELS } from "@/features/rooms/options";
import { formatMonth, formatPaise } from "@/lib/money";
import type { InvoiceLine } from "@/types";

import { explainLateFee, isLateFeeLine } from "../late-fees";
import { DUE_STATUS_LABELS, invoiceLabel, PAYMENT_MODE_LABELS } from "../options";
import type { InvoiceDetail, PaymentRow } from "../queries";
import { receiptTotals } from "../receipt";

const day = new Intl.DateTimeFormat("en-IN", { dateStyle: "medium", timeZone: "UTC" });
const formatDay = (value: string) => day.format(new Date(value.slice(0, 10)));
const issued = new Intl.DateTimeFormat("en-IN", { dateStyle: "medium", timeZone: "Asia/Kolkata" });

interface Letterhead {
  name: string;
  address: string | null;
  city: string | null;
  state: string | null;
  pincode: string | null;
  phone: string;
  email: string | null;
  gstin: string | null;
}

/** A short, stable document number derived from the record id. */
export function documentNumber(prefix: string, id: string): string {
  return `${prefix}-${id.slice(0, 8).toUpperCase()}`;
}

function Header({ hostel, title, number }: { hostel: Letterhead; title: string; number: string }) {
  const address = [hostel.address, hostel.city, hostel.state, hostel.pincode]
    .filter(Boolean)
    .join(", ");
  return (
    <header className="flex items-start justify-between gap-6 border-b border-slate-300 pb-5">
      <div>
        <p className="text-xl font-semibold text-slate-900">{hostel.name}</p>
        {address && <p className="mt-1 text-sm text-slate-600">{address}</p>}
        <p className="text-sm text-slate-600">
          {hostel.phone}
          {hostel.email && ` · ${hostel.email}`}
        </p>
        {hostel.gstin && <p className="text-sm text-slate-600">GSTIN {hostel.gstin}</p>}
      </div>
      <div className="text-right">
        <p className="text-lg font-semibold tracking-wide text-slate-900 uppercase">{title}</p>
        <p className="mt-1 font-mono text-sm text-slate-700">{number}</p>
      </div>
    </header>
  );
}

function Party({ invoice }: { invoice: InvoiceDetail }) {
  return (
    <dl className="grid grid-cols-2 gap-x-8 gap-y-1 text-sm sm:grid-cols-4">
      <dt className="text-slate-500">Resident</dt>
      <dd className="font-medium text-slate-900">{invoice.residentName}</dd>
      <dt className="text-slate-500">Mobile</dt>
      <dd className="text-slate-900">{invoice.residentPhone || "—"}</dd>
      <dt className="text-slate-500">Room / bed</dt>
      <dd className="text-slate-900">{invoice.bedLabel ?? invoice.roomNumber ?? "—"}</dd>
      <dt className="text-slate-500">Period</dt>
      <dd className="text-slate-900">{formatMonth(invoice.periodMonth)}</dd>
      <dt className="text-slate-500">Issued</dt>
      <dd className="text-slate-900">{issued.format(new Date(invoice.issuedAt))}</dd>
      <dt className="text-slate-500">Due by</dt>
      <dd className="text-slate-900">{formatDay(invoice.dueDate)}</dd>
    </dl>
  );
}

function Money({
  label,
  value,
  strong,
  total,
}: {
  label: string;
  value: number;
  strong?: boolean;
  /** The closing line, ruled off from the rows above. */
  total?: boolean;
}) {
  const className = [
    "flex justify-between",
    strong && "font-semibold",
    total && "border-t border-slate-300 pt-1",
  ]
    .filter(Boolean)
    .join(" ");
  return (
    <div className={className}>
      <dt>{label}</dt>
      <dd className="tabular-nums">{formatPaise(value)}</dd>
    </div>
  );
}

/**
 * The printable invoice (E7-T7): letterhead, resident, the month's charges
 * with how they were reached, payments received and the balance.
 */
export function InvoiceDocument({
  hostel,
  invoice,
}: {
  hostel: Letterhead;
  invoice: InvoiceDetail;
}) {
  const live = invoice.payments.filter((payment) => !payment.voidedAt);
  const [year, month] = invoice.periodMonth.split("-").map(Number);
  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const stays = invoice.breakdown.filter((line) => !isLateFeeLine(line)) as InvoiceLine[];
  const lateFee = invoice.breakdown.find(isLateFeeLine);

  return (
    <article className="space-y-6 text-slate-900">
      <Header
        hostel={hostel}
        title={
          invoice.kind === "late_fee"
            ? invoice.status === "void"
              ? "Late fee (waived)"
              : "Late fee"
            : invoice.status === "void"
              ? "Invoice (void)"
              : "Invoice"
        }
        number={documentNumber("INV", invoice.id)}
      />
      {invoice.status === "void" && (
        <p className="rounded border border-red-300 px-3 py-2 text-sm text-red-800">
          This {invoice.kind === "late_fee" ? "late fee was waived" : "invoice was voided"}:{" "}
          {invoice.voidReason}
        </p>
      )}
      <Party invoice={invoice} />

      {invoice.kind === "late_fee" ? (
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-slate-300 text-left text-slate-600">
              <th className="py-2 font-medium">Description</th>
              <th className="py-2 text-right font-medium">Amount</th>
            </tr>
          </thead>
          <tbody>
            <tr className="border-b border-slate-200">
              <td className="py-2">
                Late fee for {formatMonth(invoice.periodMonth)} rent
                {lateFee && (
                  <span className="block text-xs text-slate-500">{explainLateFee(lateFee)}</span>
                )}
              </td>
              <td className="py-2 text-right tabular-nums">{formatPaise(invoice.amount)}</td>
            </tr>
          </tbody>
        </table>
      ) : (
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-slate-300 text-left text-slate-600">
              <th className="py-2 font-medium">Description</th>
              <th className="py-2 font-medium">Nights</th>
              <th className="py-2 text-right font-medium">Monthly rent</th>
            </tr>
          </thead>
          <tbody>
            {stays.length === 0 ? (
              <tr className="border-b border-slate-200">
                <td className="py-2">Rent for {formatMonth(invoice.periodMonth)}</td>
                <td className="py-2">—</td>
                <td className="py-2 text-right tabular-nums">{formatPaise(invoice.amount)}</td>
              </tr>
            ) : (
              stays.map((line) => (
                <tr key={line.allocation_id} className="border-b border-slate-200">
                  <td className="py-2">
                    Bed {line.bed_label} ({SHARING_TYPE_LABELS[line.sharing_type]}),{" "}
                    {formatDay(line.from)} to {formatDay(line.to)}
                    {line.rate_source === "override" && (
                      <span className="text-slate-500"> · agreed rent</span>
                    )}
                  </td>
                  <td className="py-2">
                    {line.nights} of {daysInMonth}
                  </td>
                  <td className="py-2 text-right tabular-nums">{formatPaise(line.monthly_rate)}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      )}
      {stays.some((line) => line.nights < daysInMonth) && (
        <p className="text-xs text-slate-500">
          Part months are charged for the nights held: monthly rent × nights ÷ {daysInMonth}.
        </p>
      )}

      <div className="flex flex-col items-end gap-1">
        <dl className="w-full max-w-xs space-y-1 text-sm">
          <Money label="Amount" value={invoice.amount} strong />
          <Money label="Paid" value={invoice.status === "void" ? 0 : invoice.paid} />
          <Money label="Balance due" value={invoice.balance} strong total />
        </dl>
        {invoice.dueStatus && (
          <p className="text-xs text-slate-500">Status: {DUE_STATUS_LABELS[invoice.dueStatus]}</p>
        )}
      </div>

      {live.length > 0 && (
        <section>
          <h2 className="mb-2 text-sm font-semibold">Payments received</h2>
          <PaymentTable payments={live} />
        </section>
      )}
    </article>
  );
}

function PaymentTable({ payments }: { payments: readonly PaymentRow[] }) {
  return (
    <table className="w-full text-sm">
      <thead>
        <tr className="border-b border-slate-300 text-left text-slate-600">
          <th className="py-2 font-medium">Date</th>
          <th className="py-2 font-medium">Mode</th>
          <th className="py-2 font-medium">Reference</th>
          <th className="py-2 text-right font-medium">Amount</th>
        </tr>
      </thead>
      <tbody>
        {payments.map((payment) => (
          <tr key={payment.id} className="border-b border-slate-200">
            <td className="py-2">{formatDay(payment.paidAt)}</td>
            <td className="py-2">{PAYMENT_MODE_LABELS[payment.mode]}</td>
            <td className="py-2">{payment.reference ?? "—"}</td>
            <td className="py-2 text-right tabular-nums">{formatPaise(payment.amount)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/** A receipt for one payment (E7-T7): what was received, against which invoice, and what remains. */
export function ReceiptDocument({
  hostel,
  invoice,
  payment,
}: {
  hostel: Letterhead;
  invoice: InvoiceDetail;
  payment: PaymentRow;
}) {
  // As of this payment, so an older receipt keeps showing what was left then.
  const totals = receiptTotals(invoice.amount, invoice.payments, payment.id);
  return (
    <article className="space-y-6 text-slate-900">
      <Header
        hostel={hostel}
        title={payment.voidedAt ? "Receipt (void)" : "Payment receipt"}
        number={documentNumber("RCT", payment.id)}
      />
      {payment.voidedAt && (
        <p className="rounded border border-red-300 px-3 py-2 text-sm text-red-800">
          This payment was voided: {payment.voidReason}
        </p>
      )}
      <p className="text-sm">
        Received from <span className="font-medium">{invoice.residentName}</span> the sum of{" "}
        <span className="font-semibold">{formatPaise(payment.amount)}</span> by{" "}
        {PAYMENT_MODE_LABELS[payment.mode]} on {formatDay(payment.paidAt)}
        {payment.reference && <> (reference {payment.reference})</>}, towards invoice{" "}
        <span className="font-mono">{documentNumber("INV", invoice.id)}</span> for{" "}
        {invoiceLabel(invoice)}.
      </p>
      <Party invoice={invoice} />
      <div className="flex justify-end">
        <dl className="w-full max-w-xs space-y-1 text-sm">
          <Money label="Invoice amount" value={invoice.amount} />
          <Money label="Total paid to date" value={totals.paidToDate} />
          <Money label="Balance due" value={totals.balance} strong total />
        </dl>
      </div>
      {payment.recordedBy && (
        <p className="text-xs text-slate-500">Recorded by {payment.recordedBy}.</p>
      )}
    </article>
  );
}
