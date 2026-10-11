import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { InvoiceDocument, ReceiptDocument } from "@/features/fees/components/InvoiceDocument";
import { PrintButton } from "@/features/fees/components/PrintButton";
import { getInvoice, getLetterhead } from "@/features/fees/queries";
import { requireActiveHostel } from "@/lib/hostels/active";
import { createClient } from "@/lib/supabase/server";
import { uuid } from "@/lib/validation";

export const metadata: Metadata = { title: "Print" };

/**
 * A4 print view of an invoice, or of one payment's receipt with
 * `?payment=<id>` (E7-T7). Read-only: nothing here writes data. The app
 * chrome is hidden in print by the shell's print styles.
 */
export default async function PrintPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ payment?: string }>;
}) {
  const { hostel } = await requireActiveHostel();
  const { id } = await params;
  const { payment: paymentId } = await searchParams;
  if (!uuid("Invoice").safeParse(id).success) notFound();

  const supabase = await createClient();
  const [invoice, letterhead] = await Promise.all([
    getInvoice(supabase, hostel.id, id),
    getLetterhead(supabase, hostel.id),
  ]);
  if (!invoice) notFound();
  const payment = paymentId ? invoice.payments.find((row) => row.id === paymentId) : undefined;
  if (paymentId && !payment) notFound();

  return (
    <div className="mx-auto max-w-[210mm]">
      <div className="mb-4 flex items-center justify-between print:hidden">
        <Link
          href={`/fees/${invoice.id}`}
          className="text-sm font-medium text-brand-700 hover:underline"
        >
          ← Back to invoice
        </Link>
        <PrintButton label={payment ? "Print receipt" : "Print invoice"} />
      </div>
      <div className="rounded-lg border border-slate-200 bg-white p-8 shadow-xs print:rounded-none print:border-0 print:p-0 print:shadow-none">
        {payment ? (
          <ReceiptDocument hostel={letterhead} invoice={invoice} payment={payment} />
        ) : (
          <InvoiceDocument hostel={letterhead} invoice={invoice} />
        )}
      </div>
    </div>
  );
}
