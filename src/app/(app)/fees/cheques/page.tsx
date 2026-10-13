import type { Metadata } from "next";
import Link from "next/link";

import { PageHeader } from "@/components/shell/PageHeader";
import { EmptyState, Table, TBody, Td, Th, THead, Tr } from "@/components/ui";
import { ChequeActions } from "@/features/fees/components/ChequeDialogs";
import { getPendingCheques } from "@/features/fees/queries";
import { requireActiveHostel } from "@/lib/hostels/active";
import { formatPaise } from "@/lib/money";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Cheques" };

const day = new Intl.DateTimeFormat("en-IN", { dateStyle: "medium", timeZone: "UTC" });
const formatDay = (value: string) => day.format(new Date(value));

/** Cheques received and not yet cleared, oldest first (E13-T11). */
export default async function ChequesPage() {
  const { user, hostel } = await requireActiveHostel();
  const supabase = await createClient();
  const cheques = await getPendingCheques(supabase, hostel.id);
  const isOwner = user.role === "owner";
  const total = cheques.reduce((sum, cheque) => sum + cheque.amount, 0);

  return (
    <div className="max-w-5xl space-y-6">
      <div>
        <Link href="/fees" className="text-sm font-medium text-brand-700 hover:underline">
          ← All fees
        </Link>
        <div className="mt-2">
          <PageHeader
            title="Cheques waiting to clear"
            description={
              cheques.length > 0
                ? `${cheques.length} ${cheques.length === 1 ? "cheque" : "cheques"}, ${formatPaise(total)}. None of it counts as paid until cleared.`
                : "Cheques count as paid only once the bank clears them."
            }
          />
        </div>
      </div>

      {cheques.length === 0 ? (
        <EmptyState
          title="No cheques waiting"
          description="Record a cheque from an invoice with the mode “Cheque”. It will wait here until it clears or bounces."
        />
      ) : (
        <Table caption="Cheques waiting to clear">
          <THead>
            <tr>
              <Th>Received</Th>
              <Th>Resident</Th>
              <Th>Cheque</Th>
              <Th>Invoice</Th>
              <Th className="text-right">Amount</Th>
              <Th>Recorded by</Th>
              {isOwner && (
                <Th>
                  <span className="sr-only">Actions</span>
                </Th>
              )}
            </tr>
          </THead>
          <TBody>
            {cheques.map((cheque) => (
              <Tr key={cheque.id}>
                <Td>{formatDay(cheque.receivedOn)}</Td>
                <Td>
                  <Link
                    href={`/residents/${cheque.residentId}`}
                    className="font-medium text-brand-700 hover:underline"
                  >
                    {cheque.residentName}
                  </Link>
                </Td>
                <Td>
                  <span className="font-mono">{cheque.chequeNumber}</span>
                  <span className="block text-xs text-slate-500">{cheque.bank}</span>
                </Td>
                <Td>
                  <Link
                    href={`/fees/${cheque.invoiceId}`}
                    className="font-mono text-brand-700 hover:underline"
                  >
                    {cheque.invoiceNumber}
                  </Link>
                </Td>
                <Td className="text-right tabular-nums">{formatPaise(cheque.amount)}</Td>
                <Td>{cheque.recordedBy ?? "—"}</Td>
                {isOwner && (
                  <Td>
                    <ChequeActions
                      id={cheque.id}
                      subject={`cheque ${cheque.chequeNumber} for ${formatPaise(cheque.amount)}`}
                      receivedOn={cheque.receivedOn}
                    />
                  </Td>
                )}
              </Tr>
            ))}
          </TBody>
        </Table>
      )}
    </div>
  );
}
