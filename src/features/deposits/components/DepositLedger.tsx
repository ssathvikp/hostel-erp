import { Badge, Table, TBody, Td, Th, THead, Tr } from "@/components/ui";
import { VoidDialog } from "@/features/fees/components/VoidDialog";
import { PAYMENT_MODE_LABELS } from "@/features/fees/options";
import { formatPaise } from "@/lib/money";

import { DEPOSIT_KIND_LABELS, DEPOSIT_KIND_TONES } from "../options";
import type { DepositBalance, DepositEntry } from "../queries";

const day = new Intl.DateTimeFormat("en-IN", { dateStyle: "medium", timeZone: "UTC" });

/** What is held and every entry behind it (EP-12). */
export function DepositLedger({
  balance,
  entries,
  canVoid,
}: {
  balance: DepositBalance;
  entries: DepositEntry[];
  canVoid: boolean;
}) {
  if (entries.length === 0) {
    return <p className="text-sm text-slate-600">No security deposit recorded.</p>;
  }

  return (
    <div className="space-y-4">
      <dl className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
        {(
          [
            ["Held now", balance.held],
            ["Collected", balance.collected],
            ["Deducted", balance.deducted],
            ["Refunded", balance.refunded],
          ] as const
        ).map(([label, amount]) => (
          <div key={label} className="rounded-md border border-slate-200 p-3">
            <dt className="text-slate-500">{label}</dt>
            <dd className="mt-0.5 font-semibold text-slate-900 tabular-nums">
              {formatPaise(amount)}
            </dd>
          </div>
        ))}
      </dl>
      <Table caption="Security deposit entries">
        <THead>
          <tr>
            <Th>Date</Th>
            <Th>Entry</Th>
            <Th>Amount</Th>
            <Th>Details</Th>
            <Th>Recorded by</Th>
            {canVoid && (
              <Th>
                <span className="sr-only">Actions</span>
              </Th>
            )}
          </tr>
        </THead>
        <TBody>
          {entries.map((entry) => {
            const voided = entry.voidedAt !== null;
            const details = [
              entry.mode ? PAYMENT_MODE_LABELS[entry.mode] : null,
              entry.reference,
              entry.reason,
              voided ? `Void: ${entry.voidReason}` : null,
            ].filter(Boolean);
            return (
              <Tr key={entry.id}>
                <Td>{day.format(new Date(entry.entryDate))}</Td>
                <Td>
                  <Badge tone={voided ? "neutral" : DEPOSIT_KIND_TONES[entry.kind]}>
                    {DEPOSIT_KIND_LABELS[entry.kind]}
                    {voided && " (void)"}
                  </Badge>
                </Td>
                <Td className={voided ? "text-slate-400 line-through" : "tabular-nums"}>
                  {formatPaise(entry.amount)}
                </Td>
                <Td className="max-w-xs break-words">{details.join(" · ") || "—"}</Td>
                <Td>{entry.recordedByName ?? "—"}</Td>
                {canVoid && (
                  <Td>
                    {!voided && (
                      <VoidDialog
                        kind="deposit"
                        id={entry.id}
                        subject={`${DEPOSIT_KIND_LABELS[entry.kind].toLowerCase()} entry of ${formatPaise(entry.amount)}`}
                      />
                    )}
                  </Td>
                )}
              </Tr>
            );
          })}
        </TBody>
      </Table>
    </div>
  );
}
