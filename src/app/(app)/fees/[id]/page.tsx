import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { PageHeader } from "@/components/shell/PageHeader";
import { Badge, buttonClass, Table, TBody, Td, Th, THead, Tr } from "@/components/ui";
import { PaymentDialog } from "@/features/fees/components/PaymentDialog";
import { VoidDialog } from "@/features/fees/components/VoidDialog";
import { DUE_STATUS_LABELS, DUE_STATUS_TONES, PAYMENT_MODE_LABELS } from "@/features/fees/options";
import { getInvoice } from "@/features/fees/queries";
import { requireActiveHostel } from "@/lib/hostels/active";
import { formatMonth, formatPaise } from "@/lib/money";
import { createClient } from "@/lib/supabase/server";
import { uuid } from "@/lib/validation";

export const metadata: Metadata = { title: "Invoice" };

const day = new Intl.DateTimeFormat("en-IN", { dateStyle: "medium", timeZone: "UTC" });
const formatDay = (value: string) => day.format(new Date(value));

/** One invoice with its payments, and the actions that apply to it (E7-T4). */
export default async function InvoicePage({ params }: { params: Promise<{ id: string }> }) {
  const { user, hostel } = await requireActiveHostel();
  const { id } = await params;
  if (!uuid("Invoice").safeParse(id).success) notFound();

  const supabase = await createClient();
  const invoice = await getInvoice(supabase, hostel.id, id);
  if (!invoice) notFound();

  const isOwner = user.role === "owner";
  const month = formatMonth(invoice.periodMonth);
  const livePayments = invoice.payments.filter((payment) => !payment.voidedAt);

  return (
    <div className="max-w-4xl space-y-6">
      <div>
        <Link href="/fees" className="text-sm font-medium text-brand-700 hover:underline">
          ← All fees
        </Link>
        <div className="mt-2">
          <PageHeader
            title={`${invoice.residentName}, ${month}`}
            description={
              <span className="inline-flex items-center gap-2">
                <span className="font-mono">{invoice.number}</span>
                {invoice.dueStatus ? (
                  <Badge tone={DUE_STATUS_TONES[invoice.dueStatus]}>
                    {DUE_STATUS_LABELS[invoice.dueStatus]}
                  </Badge>
                ) : (
                  <Badge tone="neutral">Void</Badge>
                )}
              </span>
            }
            actions={
              <>
                <Link
                  href={`/fees/${invoice.id}/print`}
                  className={buttonClass({ variant: "secondary" })}
                >
                  Print invoice
                </Link>
                {invoice.balance > 0 && (
                  <PaymentDialog
                    residentName={invoice.residentName}
                    invoices={[{ id: invoice.id, label: month, balance: invoice.balance }]}
                  />
                )}
              </>
            }
          />
        </div>
      </div>

      <section className="grid gap-4 sm:grid-cols-4" aria-label="Amounts">
        {[
          ["Amount", invoice.amount],
          ["Paid", invoice.status === "void" ? 0 : invoice.paid],
          ["Balance", invoice.balance],
        ].map(([label, value]) => (
          <div key={label} className="rounded-lg border border-slate-200 bg-white p-4 shadow-xs">
            <p className="text-sm text-slate-500">{label}</p>
            <p className="mt-1 text-xl font-semibold text-slate-900 tabular-nums">
              {formatPaise(value as number)}
            </p>
          </div>
        ))}
        <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-xs">
          <p className="text-sm text-slate-500">Due by</p>
          <p className="mt-1 text-xl font-semibold text-slate-900">{formatDay(invoice.dueDate)}</p>
        </div>
      </section>

      {invoice.status === "void" && (
        <p className="rounded-md border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-700">
          Voided: {invoice.voidReason}. It does not count towards any balance.
        </p>
      )}

      <section aria-labelledby="resident-heading" className="text-sm text-slate-700">
        <h2 id="resident-heading" className="sr-only">
          Resident
        </h2>
        <Link
          href={`/residents/${invoice.residentId}`}
          className="font-medium text-brand-700 hover:underline"
        >
          {invoice.residentName}
        </Link>{" "}
        · {invoice.residentPhone}
        {invoice.residentEmail && ` · ${invoice.residentEmail}`}
        {invoice.bedLabel && ` · Bed ${invoice.bedLabel}`}
      </section>

      <section aria-labelledby="lines-heading">
        <h2 id="lines-heading" className="mb-3 text-base font-semibold text-slate-900">
          What it is for
        </h2>
        <dl className="max-w-md divide-y divide-slate-100 rounded-lg border border-slate-200 bg-white text-sm">
          {invoice.lines.map((line) => (
            <div key={line.position} className="flex justify-between gap-4 px-4 py-2">
              <dt className="text-slate-700">{line.description}</dt>
              <dd className="text-slate-900 tabular-nums">{formatPaise(line.amount)}</dd>
            </div>
          ))}
        </dl>
      </section>

      <section aria-labelledby="payments-heading">
        <h2 id="payments-heading" className="mb-3 text-base font-semibold text-slate-900">
          Payments
        </h2>
        {invoice.payments.length === 0 ? (
          <p className="text-sm text-slate-600">No payments recorded yet.</p>
        ) : (
          <Table caption="Payments">
            <THead>
              <tr>
                <Th>Received</Th>
                <Th>Mode</Th>
                <Th>Reference</Th>
                <Th className="text-right">Amount</Th>
                <Th>Recorded by</Th>
                <Th>
                  <span className="sr-only">Actions</span>
                </Th>
              </tr>
            </THead>
            <TBody>
              {invoice.payments.map((payment) => (
                <Tr key={payment.id} className={payment.voidedAt ? "text-slate-400" : undefined}>
                  <Td>{formatDay(payment.paidAt)}</Td>
                  <Td>{PAYMENT_MODE_LABELS[payment.mode]}</Td>
                  <Td>{payment.reference ?? "—"}</Td>
                  <Td className="text-right tabular-nums">
                    {payment.voidedAt ? (
                      <s>{formatPaise(payment.amount)}</s>
                    ) : (
                      formatPaise(payment.amount)
                    )}
                  </Td>
                  <Td>{payment.recordedBy ?? "—"}</Td>
                  <Td>
                    {payment.voidedAt ? (
                      <span className="text-xs whitespace-normal">Void: {payment.voidReason}</span>
                    ) : (
                      <div className="flex justify-end gap-2">
                        <Link
                          href={`/fees/${invoice.id}/print?payment=${payment.id}`}
                          className={buttonClass({ variant: "secondary", size: "sm" })}
                          aria-label={`Receipt for ${formatPaise(payment.amount)} on ${formatDay(payment.paidAt)}`}
                        >
                          Receipt
                        </Link>
                        {isOwner && (
                          <VoidDialog
                            kind="payment"
                            id={payment.id}
                            subject={`payment of ${formatPaise(payment.amount)} on ${formatDay(payment.paidAt)}`}
                          />
                        )}
                      </div>
                    )}
                  </Td>
                </Tr>
              ))}
            </TBody>
          </Table>
        )}
      </section>

      {isOwner && invoice.status === "issued" && (
        <section
          aria-labelledby="void-heading"
          className="rounded-lg border border-red-200 bg-white p-5 sm:p-6"
        >
          <h2 id="void-heading" className="text-base font-semibold text-slate-900">
            Void this invoice
          </h2>
          <p className="mt-1 mb-4 text-sm text-slate-600">
            {livePayments.length > 0
              ? "This invoice has payments. Void them first if the invoice was issued in error."
              : "For an invoice issued in error. The month can then be generated again for this resident."}
          </p>
          {livePayments.length === 0 && (
            <VoidDialog kind="invoice" id={invoice.id} subject={`invoice for ${month}`} size="md" />
          )}
        </section>
      )}
    </div>
  );
}
