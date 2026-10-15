import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { Alert } from "@/components/ui";
import { PrintButton } from "@/features/fees/components/PrintButton";
import { getPlatformInvoice, type PlatformInvoice } from "@/features/billing/queries";
import { requireUser } from "@/lib/auth/session";
import { stateName } from "@/lib/billing/pricing";
import { formatPaise } from "@/lib/money";
import { createClient } from "@/lib/supabase/server";
import { uuid } from "@/lib/validation";

export const metadata: Metadata = { title: "Tax invoice" };

const day = new Intl.DateTimeFormat("en-IN", { dateStyle: "medium", timeZone: "Asia/Kolkata" });

function Party({ title, party }: { title: string; party: PlatformInvoice["seller"] }) {
  return (
    <div>
      <p className="text-xs font-medium tracking-wide text-slate-500 uppercase">{title}</p>
      <p className="mt-1 font-semibold text-slate-900">{party.legal_name ?? "—"}</p>
      {party.address && (
        <p className="text-sm whitespace-pre-line text-slate-700">{party.address}</p>
      )}
      {party.state_code && (
        <p className="text-sm text-slate-700">
          State: {stateName(party.state_code) ?? party.state_code} ({party.state_code})
        </p>
      )}
      <p className="text-sm text-slate-700">GSTIN: {party.gstin ?? "Unregistered"}</p>
      {party.email && <p className="text-sm text-slate-700">{party.email}</p>}
    </div>
  );
}

/**
 * A GST tax invoice or credit note from Hostel ERP to the owner (E14-T6),
 * printable to PDF from the browser. RLS returns only the owner's own.
 */
export default async function PlatformInvoicePage({ params }: { params: Promise<{ id: string }> }) {
  await requireUser();
  const { id } = await params;
  if (!uuid("Invoice").safeParse(id).success) notFound();
  const invoice = await getPlatformInvoice(await createClient(), id);
  if (!invoice) notFound();

  const credit = invoice.kind === "credit_note";
  const rate = invoice.gst_rate_bps / 100;
  const sellerMissing = !invoice.seller.legal_name || !invoice.seller.gstin;

  return (
    <div className="mx-auto max-w-[210mm] space-y-4">
      <div className="flex items-center justify-between print:hidden">
        <Link
          href="/settings/billing"
          className="text-sm font-medium text-brand-700 hover:underline"
        >
          ← Back to billing
        </Link>
        <PrintButton label="Print or save as PDF" />
      </div>
      {sellerMissing && (
        <Alert tone="warning" className="print:hidden">
          Hostel ERP&apos;s GST registration details are not filled in yet, so this document is not
          yet a valid tax invoice. Contact support for a corrected copy.
        </Alert>
      )}
      <article className="space-y-6 rounded-lg border border-slate-200 bg-white p-8 shadow-xs print:rounded-none print:border-0 print:p-0 print:shadow-none">
        <header className="flex items-start justify-between gap-6 border-b border-slate-300 pb-5">
          <Party title="From" party={invoice.seller} />
          <div className="text-right">
            <p className="text-lg font-semibold tracking-wide text-slate-900 uppercase">
              {credit ? "Credit note" : "Tax invoice"}
            </p>
            <p className="mt-1 font-mono text-sm text-slate-700">{invoice.number}</p>
            <p className="text-sm text-slate-700">{day.format(new Date(invoice.issued_at))}</p>
            {credit && invoice.original_number && (
              <p className="text-sm text-slate-700">Against invoice {invoice.original_number}</p>
            )}
          </div>
        </header>

        <div className="grid gap-6 sm:grid-cols-2">
          <Party title="Billed to" party={invoice.buyer} />
          <dl className="text-sm">
            <dt className="text-slate-500">Place of supply</dt>
            <dd className="text-slate-900">
              {invoice.place_of_supply
                ? `${stateName(invoice.place_of_supply) ?? invoice.place_of_supply} (${invoice.place_of_supply})`
                : "—"}
            </dd>
            {invoice.period_start && invoice.period_end && (
              <>
                <dt className="mt-2 text-slate-500">Service period</dt>
                <dd className="text-slate-900">
                  {day.format(new Date(invoice.period_start))} to{" "}
                  {day.format(new Date(invoice.period_end))}
                </dd>
              </>
            )}
          </dl>
        </div>

        <table className="w-full text-sm">
          <caption className="sr-only">Charges</caption>
          <thead>
            <tr className="border-b border-slate-300 text-left text-slate-500">
              <th scope="col" className="py-2 font-medium">
                Description
              </th>
              <th scope="col" className="py-2 font-medium">
                SAC
              </th>
              <th scope="col" className="py-2 text-right font-medium">
                Taxable value
              </th>
            </tr>
          </thead>
          <tbody>
            <tr className="border-b border-slate-100">
              <td className="py-2 text-slate-900">{invoice.description}</td>
              <td className="py-2 font-mono text-slate-700">{invoice.sac_code}</td>
              <td className="py-2 text-right tabular-nums">{formatPaise(invoice.taxable_value)}</td>
            </tr>
          </tbody>
          <tfoot className="text-slate-700">
            {invoice.igst > 0 ? (
              <tr>
                <td colSpan={2} className="pt-2 text-right">
                  IGST at {rate}%
                </td>
                <td className="pt-2 text-right tabular-nums">{formatPaise(invoice.igst)}</td>
              </tr>
            ) : (
              <>
                <tr>
                  <td colSpan={2} className="pt-2 text-right">
                    CGST at {rate / 2}%
                  </td>
                  <td className="pt-2 text-right tabular-nums">{formatPaise(invoice.cgst)}</td>
                </tr>
                <tr>
                  <td colSpan={2} className="text-right">
                    SGST at {rate / 2}%
                  </td>
                  <td className="text-right tabular-nums">{formatPaise(invoice.sgst)}</td>
                </tr>
              </>
            )}
            <tr className="font-semibold text-slate-900">
              <td colSpan={2} className="border-t border-slate-300 pt-2 text-right">
                {credit ? "Total credited" : "Total paid"}
              </td>
              <td className="border-t border-slate-300 pt-2 text-right tabular-nums">
                {formatPaise(invoice.total)}
              </td>
            </tr>
          </tfoot>
        </table>

        <p className="text-xs text-slate-500">
          {credit
            ? "This credit note reduces the taxable value and tax of the invoice above."
            : "Paid through Razorpay. This is a computer-generated invoice and needs no signature."}
        </p>
      </article>
    </div>
  );
}
