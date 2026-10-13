import Link from "next/link";

import { buttonClass, Table, TBody, Td, Th, THead, Tr } from "@/components/ui";
import { formatPaise, paiseToInput } from "@/lib/money";

import { PAYMENT_MODE_LABELS } from "../options";
import type { MoneyEntry, ResidentMoney } from "../queries";
import { DeductionDialog, MoneyDialog } from "./MoneyForms";

const day = new Intl.DateTimeFormat("en-IN", { dateStyle: "medium", timeZone: "UTC" });

const ENTRY_LABELS: Record<string, string> = {
  "credit:received": "Credit received",
  "credit:adjustment": "Credit given",
  "credit:applied": "Credit used on an invoice",
  "credit:refund": "Credit paid back",
  "deposit:due": "Deposit asked for",
  "deposit:received": "Deposit received",
  "deposit:deduction": "Kept from deposit",
  "deposit:applied": "Deposit used on an invoice",
  "deposit:refund": "Deposit paid back",
};

function entryDetail(entry: MoneyEntry): string {
  const parts = [
    entry.number,
    entry.mode ? PAYMENT_MODE_LABELS[entry.mode as keyof typeof PAYMENT_MODE_LABELS] : null,
    entry.reference,
    entry.note,
  ].filter(Boolean);
  return parts.join(" · ") || "—";
}

function Figure({ label, value, note }: { label: string; value: number; note?: string }) {
  return (
    <div>
      <dt className="text-sm text-slate-500">{label}</dt>
      <dd className="mt-1 text-xl font-semibold text-slate-900 tabular-nums">
        {formatPaise(value)}
      </dd>
      {note && <dd className="text-xs text-slate-500">{note}</dd>}
    </div>
  );
}

/**
 * A resident's credit and deposit (E13-T7, E13-T4): what is held, what is
 * still owed on the deposit, every movement, and the actions for each role.
 */
export function ResidentMoneyPanel({
  residentId,
  money,
  isOwner,
  canSettle,
}: {
  residentId: string;
  money: ResidentMoney;
  isOwner: boolean;
  /** The resident has left their bed. */
  canSettle: boolean;
}) {
  const { credit, deposit, entries } = money;
  return (
    <div className="space-y-5">
      <dl className="grid gap-4 sm:grid-cols-3">
        <Figure label="Credit" value={credit} note="Used on the next invoices." />
        <Figure
          label="Deposit held"
          value={deposit.held}
          note={
            deposit.outstanding > 0
              ? `${formatPaise(deposit.outstanding)} still to receive`
              : undefined
          }
        />
        <Figure label="Kept from deposit" value={deposit.deducted} />
      </dl>

      <div className="flex flex-wrap gap-2">
        <MoneyDialog kind="advance" residentId={residentId} />
        <MoneyDialog
          kind="deposit"
          residentId={residentId}
          defaultAmount={deposit.outstanding > 0 ? paiseToInput(deposit.outstanding) : undefined}
        />
        {isOwner && credit > 0 && (
          <MoneyDialog
            kind="refundCredit"
            residentId={residentId}
            defaultAmount={paiseToInput(credit)}
          />
        )}
        {isOwner && deposit.held > 0 && (
          <>
            <DeductionDialog residentId={residentId} />
            <MoneyDialog
              kind="refundDeposit"
              residentId={residentId}
              defaultAmount={paiseToInput(deposit.held)}
            />
          </>
        )}
        {isOwner && canSettle && (
          <Link
            href={`/residents/${residentId}/settlement`}
            className={buttonClass({ size: "sm" })}
          >
            Settle and close
          </Link>
        )}
      </div>

      {entries.length > 0 && (
        <Table caption="Credit and deposit movements">
          <THead>
            <tr>
              <Th>Date</Th>
              <Th>What</Th>
              <Th className="text-right">Amount</Th>
              <Th>Details</Th>
            </tr>
          </THead>
          <TBody>
            {entries.map((entry) => (
              <Tr key={`${entry.ledger}-${entry.id}`}>
                <Td>{day.format(new Date(entry.date))}</Td>
                <Td>
                  {entry.invoiceId ? (
                    <Link
                      href={`/fees/${entry.invoiceId}`}
                      className="font-medium text-brand-700 hover:underline"
                    >
                      {ENTRY_LABELS[`${entry.ledger}:${entry.kind}`]}
                    </Link>
                  ) : (
                    ENTRY_LABELS[`${entry.ledger}:${entry.kind}`]
                  )}
                </Td>
                <Td className="text-right tabular-nums">{formatPaise(entry.amount)}</Td>
                <Td className="whitespace-normal text-slate-600">{entryDetail(entry)}</Td>
              </Tr>
            ))}
          </TBody>
        </Table>
      )}
    </div>
  );
}
