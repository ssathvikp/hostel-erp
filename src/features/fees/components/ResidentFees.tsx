import Link from "next/link";

import { Badge, Table, TBody, Td, Th, THead, Tr } from "@/components/ui";
import { daysBetween, formatPaise } from "@/lib/money";
import { todayIst } from "@/lib/validation";

import { DUE_STATUS_LABELS, DUE_STATUS_TONES, invoiceLabel } from "../options";
import type { InvoiceRow, ResidentBalance } from "../queries";

/** What the resident owes, in one sentence. Shown before a transfer is confirmed (E6-T4). */
export function BalanceSentence({ balance }: { balance: ResidentBalance }) {
  if (balance.outstanding === 0) {
    return <p>No fees are outstanding.</p>;
  }
  return (
    <p>
      <span className="font-semibold">{formatPaise(balance.outstanding)}</span> is outstanding
      across {balance.openInvoices} {balance.openInvoices === 1 ? "invoice" : "invoices"}
      {balance.overdue > 0 && (
        <>
          , of which <span className="font-semibold">{formatPaise(balance.overdue)}</span> is
          overdue
        </>
      )}
      . It stays with the resident after the move; settle it before or after as agreed.
    </p>
  );
}

/** Fee history and the outstanding balance on the resident profile (E7-T5). */
export function ResidentFees({
  balance,
  invoices,
}: {
  balance: ResidentBalance;
  invoices: readonly InvoiceRow[];
}) {
  const overdueDays = balance.oldestOverdueDueDate
    ? daysBetween(balance.oldestOverdueDueDate, todayIst())
    : 0;

  return (
    <div className="space-y-5">
      <dl className="grid gap-4 sm:grid-cols-3">
        <div>
          <dt className="text-sm text-slate-500">Outstanding</dt>
          <dd className="mt-1 text-xl font-semibold text-slate-900 tabular-nums">
            {formatPaise(balance.outstanding)}
          </dd>
        </div>
        <div>
          <dt className="text-sm text-slate-500">Overdue</dt>
          <dd
            className={
              balance.overdue > 0
                ? "mt-1 text-xl font-semibold text-red-700 tabular-nums"
                : "mt-1 text-xl font-semibold text-slate-900 tabular-nums"
            }
          >
            {formatPaise(balance.overdue)}
          </dd>
          {overdueDays > 0 && (
            <dd className="text-xs text-slate-500">
              oldest {overdueDays} {overdueDays === 1 ? "day" : "days"} late
            </dd>
          )}
        </div>
        <div>
          <dt className="text-sm text-slate-500">Paid to date</dt>
          <dd className="mt-1 text-xl font-semibold text-slate-900 tabular-nums">
            {formatPaise(balance.paid)}
          </dd>
          <dd className="text-xs text-slate-500">of {formatPaise(balance.invoiced)} invoiced</dd>
        </div>
      </dl>

      {invoices.length === 0 ? (
        <p className="text-sm text-slate-600">No invoices yet.</p>
      ) : (
        <Table caption="Fee history">
          <THead>
            <tr>
              <Th>Month</Th>
              <Th className="text-right">Amount</Th>
              <Th className="text-right">Paid</Th>
              <Th className="text-right">Balance</Th>
              <Th>Status</Th>
              <Th>
                <span className="sr-only">Invoice</span>
              </Th>
            </tr>
          </THead>
          <TBody>
            {invoices.map((invoice) => (
              <Tr
                key={invoice.id}
                className={invoice.status === "void" ? "text-slate-400" : undefined}
              >
                <Td>{invoiceLabel(invoice)}</Td>
                <Td className="text-right tabular-nums">{formatPaise(invoice.amount)}</Td>
                <Td className="text-right tabular-nums">{formatPaise(invoice.paid)}</Td>
                <Td className="text-right tabular-nums">{formatPaise(invoice.balance)}</Td>
                <Td>
                  {invoice.dueStatus ? (
                    <Badge tone={DUE_STATUS_TONES[invoice.dueStatus]}>
                      {DUE_STATUS_LABELS[invoice.dueStatus]}
                    </Badge>
                  ) : (
                    <Badge tone="neutral">Void</Badge>
                  )}
                </Td>
                <Td>
                  <Link
                    href={`/fees/${invoice.id}`}
                    className="font-medium text-brand-700 hover:underline"
                    aria-label={`Invoice for ${invoiceLabel(invoice)}`}
                  >
                    View
                  </Link>
                </Td>
              </Tr>
            ))}
          </TBody>
        </Table>
      )}
    </div>
  );
}
