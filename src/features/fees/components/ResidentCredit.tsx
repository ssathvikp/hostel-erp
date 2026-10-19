import Link from "next/link";

import { Table, TBody, Td, Th, THead, Tr } from "@/components/ui";
import { ReasonDialog } from "@/features/charges/components/ReasonDialog";
import { formatPaise } from "@/lib/money";
import { createClient } from "@/lib/supabase/server";

import { voidCreditEntry } from "../actions";
import { PAYMENT_MODE_LABELS } from "../options";
import { getResidentCredit } from "../queries";
import { ApplyCreditButton, CreditDialog } from "./CreditForms";

const day = new Intl.DateTimeFormat("en-IN", { dateStyle: "medium", timeZone: "UTC" });

const KIND_LABELS = { advance: "Advance received", applied: "Used on invoice", refund: "Refunded" };

/** A resident's advance credit: what is held and every entry (ClickUp E13-T7). */
export async function ResidentCredit({
  residentId,
  residentName,
  hostelId,
  isOwner,
  editable,
  hasOpenInvoices,
}: {
  residentId: string;
  residentName: string;
  hostelId: string;
  isOwner: boolean;
  editable: boolean;
  hasOpenInvoices: boolean;
}) {
  const { held, entries } = await getResidentCredit(await createClient(), hostelId, residentId);
  return (
    <div className="space-y-4">
      <p className="text-sm text-slate-700">
        {held > 0 ? (
          <>
            <span className="font-semibold text-slate-900">{formatPaise(held)}</span> held as
            advance credit. It is used automatically on the next invoice.
          </>
        ) : (
          "No advance credit held."
        )}
      </p>
      {editable && (
        <div className="flex flex-wrap gap-2">
          <CreditDialog
            residentId={residentId}
            residentName={residentName}
            kind="advance"
            held={held}
          />
          {isOwner && held > 0 && (
            <CreditDialog
              residentId={residentId}
              residentName={residentName}
              kind="refund"
              held={held}
            />
          )}
        </div>
      )}
      {held > 0 && hasOpenInvoices && <ApplyCreditButton residentId={residentId} />}
      {entries.length > 0 && (
        <Table caption="Advance credit">
          <THead>
            <tr>
              <Th>Date</Th>
              <Th>Entry</Th>
              <Th className="text-right">Amount</Th>
              <Th>
                <span className="sr-only">Actions</span>
              </Th>
            </tr>
          </THead>
          <TBody>
            {entries.map((entry) => (
              <Tr key={entry.id} className={entry.voidedAt ? "text-slate-400" : undefined}>
                <Td>{day.format(new Date(entry.entryDate))}</Td>
                <Td className="whitespace-normal">
                  {KIND_LABELS[entry.kind]}
                  {entry.mode && ` · ${PAYMENT_MODE_LABELS[entry.mode]}`}
                  {entry.invoiceId && (
                    <>
                      {" · "}
                      <Link
                        href={`/fees/${entry.invoiceId}`}
                        className="text-brand-700 hover:underline"
                      >
                        invoice
                      </Link>
                    </>
                  )}
                  {entry.voidedAt && (
                    <span className="block text-xs">Void: {entry.voidReason}</span>
                  )}
                </Td>
                <Td className="text-right tabular-nums">
                  {entry.kind === "advance" ? "" : "−"}
                  {formatPaise(entry.amount)}
                </Td>
                <Td>
                  {isOwner && editable && !entry.voidedAt && entry.kind !== "applied" && (
                    <ReasonDialog
                      action={voidCreditEntry}
                      id={entry.id}
                      button="Void"
                      title="Void this entry"
                      description="Use this for an entry recorded by mistake. It stays on record, marked void."
                      confirm="Void entry"
                      subject={`${KIND_LABELS[entry.kind].toLowerCase()} of ${formatPaise(entry.amount)}`}
                    />
                  )}
                </Td>
              </Tr>
            ))}
          </TBody>
        </Table>
      )}
    </div>
  );
}
