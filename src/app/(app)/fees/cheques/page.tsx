import type { Metadata } from "next";
import Link from "next/link";

import { PageHeader } from "@/components/shell/PageHeader";
import { EmptyState, Table, TBody, Td, Th, THead, Tr } from "@/components/ui";
import { ClearChequeButton } from "@/features/fees/components/ClearChequeButton";
import { VoidDialog } from "@/features/fees/components/VoidDialog";
import { requireActiveHostel } from "@/lib/hostels/active";
import { formatPaise } from "@/lib/money";
import { fetchAll } from "@/lib/pagination";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Pending cheques" };

const day = new Intl.DateTimeFormat("en-IN", { dateStyle: "medium", timeZone: "UTC" });

/**
 * Cheques received but not yet cleared, oldest deposit date first (ClickUp
 * E13-T11). Until cleared they do not count as paid.
 */
export default async function PendingChequesPage() {
  const { user, hostel } = await requireActiveHostel();
  const supabase = await createClient();
  const cheques = await fetchAll((from, to) =>
    supabase
      .from("payments")
      .select(
        "id, amount, paid_at, cheque_number, cheque_bank, receipt_number, invoice_id, invoices!payments_invoice_fkey(resident_id, residents!invoices_resident_fkey(full_name))",
      )
      .eq("hostel_id", hostel.id)
      .eq("mode", "cheque")
      .is("cleared_at", null)
      .is("voided_at", null)
      .order("paid_at")
      .order("id")
      .range(from, to),
  );
  const total = cheques.reduce((sum, cheque) => sum + cheque.amount, 0);

  return (
    <div className="max-w-4xl space-y-6">
      <div>
        <Link href="/fees" className="text-sm font-medium text-brand-700 hover:underline">
          ← All fees
        </Link>
        <div className="mt-2">
          <PageHeader
            title="Pending cheques"
            description={
              cheques.length
                ? `${cheques.length} ${cheques.length === 1 ? "cheque" : "cheques"} worth ${formatPaise(total)} not yet cleared. They count as paid once marked cleared.`
                : "Cheques received but not yet cleared appear here."
            }
          />
        </div>
      </div>
      {cheques.length === 0 ? (
        <EmptyState title="No cheques waiting" />
      ) : (
        <Table caption="Pending cheques">
          <THead>
            <tr>
              <Th>Deposited</Th>
              <Th>Resident</Th>
              <Th>Cheque</Th>
              <Th className="text-right">Amount</Th>
              <Th>
                <span className="sr-only">Actions</span>
              </Th>
            </tr>
          </THead>
          <TBody>
            {cheques.map((cheque) => (
              <Tr key={cheque.id}>
                <Td>{day.format(new Date(cheque.paid_at))}</Td>
                <Td>
                  <Link
                    href={`/fees/${cheque.invoice_id}`}
                    className="text-brand-700 hover:underline"
                  >
                    {cheque.invoices?.residents?.full_name ?? "Resident"}
                  </Link>
                  <span className="block font-mono text-xs text-slate-500">
                    {cheque.receipt_number}
                  </span>
                </Td>
                <Td>
                  No. {cheque.cheque_number}
                  <span className="block text-xs text-slate-500">{cheque.cheque_bank}</span>
                </Td>
                <Td className="text-right tabular-nums">{formatPaise(cheque.amount)}</Td>
                <Td>
                  <div className="flex justify-end gap-2">
                    <ClearChequeButton id={cheque.id} subject={`cheque ${cheque.cheque_number}`} />
                    {user.role === "owner" && (
                      <VoidDialog
                        kind="cheque"
                        id={cheque.id}
                        subject={`cheque ${cheque.cheque_number}`}
                      />
                    )}
                  </div>
                </Td>
              </Tr>
            ))}
          </TBody>
        </Table>
      )}
    </div>
  );
}
