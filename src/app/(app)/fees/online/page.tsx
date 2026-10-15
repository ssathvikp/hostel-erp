import type { Metadata } from "next";
import Link from "next/link";

import { PageHeader } from "@/components/shell/PageHeader";
import { Badge, EmptyState, Table, TBody, Td, Th, THead, Tr } from "@/components/ui";
import { getGatewayAccount, getReconciliation } from "@/features/online-payments/queries";
import { requireActiveHostel } from "@/lib/hostels/active";
import { formatPaise } from "@/lib/money";
import { createClient } from "@/lib/supabase/server";
import { todayIst } from "@/lib/validation";

export const metadata: Metadata = { title: "Online payments" };

const at = new Intl.DateTimeFormat("en-IN", {
  dateStyle: "medium",
  timeStyle: "short",
  timeZone: "Asia/Kolkata",
});

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

const MIRRORED: Record<string, string> = {
  voided: "Payment voided",
  credit: "Taken from credit",
  partly: "Partly mirrored",
  not_found: "Not a Hostel ERP payment",
};

function Tile({ label, value, note }: { label: string; value: string; note?: string }) {
  return (
    <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-xs">
      <p className="text-sm text-slate-500">{label}</p>
      <p className="mt-1 text-xl font-semibold text-slate-900 tabular-nums">{value}</p>
      {note && <p className="text-xs text-slate-500">{note}</p>}
    </div>
  );
}

/**
 * Reconciliation (E13-T10): what the gateway collected, its fees, what
 * Hostel ERP recorded (receipts and credit), refunds and settlements to the
 * bank, for a date range.
 */
export default async function OnlinePaymentsReportPage({
  searchParams,
}: {
  searchParams: Promise<{ from?: string; to?: string }>;
}) {
  const { hostel } = await requireActiveHostel();
  const params = await searchParams;
  const today = todayIst();
  const to = params.to && ISO_DATE.test(params.to) ? params.to : today;
  const from =
    params.from && ISO_DATE.test(params.from) && params.from <= to
      ? params.from
      : `${to.slice(0, 8)}01`;

  const supabase = await createClient();
  const [account, report] = await Promise.all([
    getGatewayAccount(supabase, hostel.id),
    getReconciliation(supabase, hostel.id, from, to),
  ]);
  const { totals } = report;
  const net = totals.captured - totals.fees - totals.tax - totals.refunded;

  return (
    <div className="space-y-6">
      <div>
        <Link href="/fees" className="text-sm font-medium text-brand-700 hover:underline">
          ← All fees
        </Link>
        <div className="mt-2">
          <PageHeader
            title="Online payments"
            description={
              account
                ? "Rent paid through your Razorpay account, against what Hostel ERP recorded and what reached your bank."
                : "Online payments are not connected for this hostel."
            }
          />
        </div>
      </div>

      <form className="flex flex-wrap items-end gap-3" aria-label="Date range">
        <label className="text-sm">
          <span className="block text-slate-700">From</span>
          <input
            type="date"
            name="from"
            defaultValue={from}
            className="mt-1 rounded-md border border-slate-300 px-2 py-1.5"
          />
        </label>
        <label className="text-sm">
          <span className="block text-slate-700">To</span>
          <input
            type="date"
            name="to"
            defaultValue={to}
            className="mt-1 rounded-md border border-slate-300 px-2 py-1.5"
          />
        </label>
        <button
          type="submit"
          className="h-9 rounded-md border border-slate-300 bg-white px-3 text-sm font-medium text-slate-700 hover:bg-slate-50"
        >
          Show
        </button>
      </form>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Tile label="Collected online" value={formatPaise(totals.captured)} />
        <Tile
          label="Gateway fees"
          value={formatPaise(totals.fees + totals.tax)}
          note={`${formatPaise(totals.tax)} of it GST`}
        />
        <Tile label="Refunded" value={formatPaise(totals.refunded)} />
        <Tile
          label="Net to your bank"
          value={formatPaise(net)}
          note="Collected less fees and refunds"
        />
        <Tile
          label="Recorded as receipts"
          value={formatPaise(totals.recorded)}
          note={`${formatPaise(totals.to_credit)} kept as credit`}
        />
        <Tile
          label="Settled to the bank"
          value={formatPaise(totals.settled)}
          note={`${formatPaise(totals.settlement_fees)} fees on settlements`}
        />
        <Tile label="Failed attempts" value={String(totals.failed)} />
        <Tile
          label="Needs attention"
          value={String(totals.unrecorded)}
          note="Paid online but not recorded"
        />
      </div>

      <section aria-labelledby="payments-heading" className="space-y-3">
        <h2 id="payments-heading" className="text-base font-semibold text-slate-900">
          Payments
        </h2>
        {report.payments.length === 0 ? (
          <EmptyState title="No online payments in this period" />
        ) : (
          <Table caption="Online payments">
            <THead>
              <tr>
                <Th>When</Th>
                <Th>Resident</Th>
                <Th className="text-right">Amount</Th>
                <Th className="text-right">Fee + GST</Th>
                <Th>Recorded as</Th>
                <Th>Gateway id</Th>
              </tr>
            </THead>
            <TBody>
              {report.payments.map((payment) => (
                <Tr key={payment.gateway_payment_id}>
                  <Td>{at.format(new Date(payment.received_at))}</Td>
                  <Td className="whitespace-normal">
                    {payment.resident_name ?? "—"}
                    {payment.invoice_id && payment.invoice_number && (
                      <Link
                        href={`/fees/${payment.invoice_id}`}
                        className="block font-mono text-xs text-brand-700 hover:underline"
                      >
                        {payment.invoice_number}
                      </Link>
                    )}
                  </Td>
                  <Td className="text-right tabular-nums">
                    {formatPaise(payment.amount)}
                    {payment.refunded_amount > 0 && (
                      <span className="block text-xs text-slate-500">
                        {formatPaise(payment.refunded_amount)} refunded
                      </span>
                    )}
                  </Td>
                  <Td className="text-right tabular-nums">
                    {payment.fee === null ? "—" : formatPaise(payment.fee + (payment.tax ?? 0))}
                  </Td>
                  <Td className="whitespace-normal">
                    {payment.status === "failed" ? (
                      <Badge tone="neutral">Failed{payment.note ? `: ${payment.note}` : ""}</Badge>
                    ) : payment.receipt_number || payment.credit_number ? (
                      <span className="font-mono text-xs">
                        {[
                          payment.receipt_number,
                          payment.credit_number && `${payment.credit_number} (credit)`,
                        ]
                          .filter(Boolean)
                          .join(", ")}
                      </span>
                    ) : (
                      <Badge tone="danger">{payment.note ?? "Not recorded"}</Badge>
                    )}
                    {payment.status === "refunded" && (
                      <span className="ml-1">
                        <Badge tone="warning">Refunded</Badge>
                      </span>
                    )}
                  </Td>
                  <Td className="font-mono text-xs">{payment.gateway_payment_id}</Td>
                </Tr>
              ))}
            </TBody>
          </Table>
        )}
      </section>

      {report.refunds.length > 0 && (
        <section aria-labelledby="refunds-heading" className="space-y-3">
          <h2 id="refunds-heading" className="text-base font-semibold text-slate-900">
            Refunds
          </h2>
          <Table caption="Refunds made in the gateway">
            <THead>
              <tr>
                <Th>When</Th>
                <Th className="text-right">Amount</Th>
                <Th>In Hostel ERP</Th>
                <Th>Gateway ids</Th>
              </tr>
            </THead>
            <TBody>
              {report.refunds.map((refund) => (
                <Tr key={refund.gateway_refund_id}>
                  <Td>{at.format(new Date(refund.created_at))}</Td>
                  <Td className="text-right tabular-nums">{formatPaise(refund.amount)}</Td>
                  <Td className="whitespace-normal">
                    <Badge
                      tone={
                        refund.mirrored === "partly" || refund.mirrored === "not_found"
                          ? "warning"
                          : "neutral"
                      }
                    >
                      {MIRRORED[refund.mirrored]}
                    </Badge>
                    {refund.note && (
                      <span className="block text-xs text-slate-600">{refund.note}</span>
                    )}
                  </Td>
                  <Td className="font-mono text-xs">
                    {refund.gateway_refund_id}
                    <span className="block">{refund.gateway_payment_id}</span>
                  </Td>
                </Tr>
              ))}
            </TBody>
          </Table>
        </section>
      )}

      <section aria-labelledby="settlements-heading" className="space-y-3">
        <h2 id="settlements-heading" className="text-base font-semibold text-slate-900">
          Settlements to your bank
        </h2>
        {report.settlements.length === 0 ? (
          <p className="text-sm text-slate-600">No settlements in this period.</p>
        ) : (
          <Table caption="Settlements">
            <THead>
              <tr>
                <Th>Settled</Th>
                <Th className="text-right">Amount</Th>
                <Th className="text-right">Fees + GST</Th>
                <Th>UTR</Th>
              </tr>
            </THead>
            <TBody>
              {report.settlements.map((settlement) => (
                <Tr key={settlement.gateway_settlement_id}>
                  <Td>{at.format(new Date(settlement.settled_at))}</Td>
                  <Td className="text-right tabular-nums">{formatPaise(settlement.amount)}</Td>
                  <Td className="text-right tabular-nums">
                    {formatPaise(settlement.fees + settlement.tax)}
                  </Td>
                  <Td className="font-mono text-xs">{settlement.utr ?? "—"}</Td>
                </Tr>
              ))}
            </TBody>
          </Table>
        )}
      </section>
    </div>
  );
}
