import Link from "next/link";

import { Badge, Table, TBody, Td, Th, THead, Tr } from "@/components/ui";
import { formatMonth, formatPaise } from "@/lib/money";
import { createClient } from "@/lib/supabase/server";
import { todayIst } from "@/lib/validation";

import { endDiscount, voidCharge } from "../actions";
import { getFeeHeads, getOptOuts, getResidentCharges } from "../queries";
import { ReasonDialog } from "./ReasonDialog";
import { BillNowButton, ChargeForm, DiscountForm, OptOutForm } from "./ResidentChargeForms";

const day = new Intl.DateTimeFormat("en-IN", { dateStyle: "medium", timeZone: "UTC" });
const formatDay = (value: string) => day.format(new Date(value));

export const CHARGE_CATEGORY_LABELS: Record<string, string> = {
  ad_hoc: "Charge",
  admission: "Admission",
  electricity: "Electricity",
  cheque_bounce: "Cheque bounce",
};

/**
 * A resident's charges besides rent, their discounts, and which monthly
 * charges their stay pays (ClickUp E13-T1, E13-T2, E13-T5).
 */
export async function ResidentCharges({
  residentId,
  hostelId,
  isOwner,
  editable,
  currentAllocationId,
}: {
  residentId: string;
  hostelId: string;
  isOwner: boolean;
  /** False for an erased resident: history only. */
  editable: boolean;
  currentAllocationId: string | null;
}) {
  const supabase = await createClient();
  const [{ charges, discounts }, heads, optedOut] = await Promise.all([
    getResidentCharges(supabase, hostelId, residentId),
    getFeeHeads(supabase, hostelId),
    currentAllocationId ? getOptOuts(supabase, currentAllocationId) : Promise.resolve([]),
  ]);
  const monthly = heads.filter((head) => head.kind === "monthly");
  const oneTime = heads.filter((head) => head.kind === "one_time");
  const pending = charges.filter((charge) => !charge.invoiceId && !charge.voidedAt);
  const today = todayIst();

  return (
    <div className="space-y-6">
      <section aria-labelledby="charges-list">
        <h3 id="charges-list" className="mb-2 text-sm font-semibold text-slate-900">
          Charges
        </h3>
        {charges.length === 0 ? (
          <p className="text-sm text-slate-600">No charges besides rent.</p>
        ) : (
          <Table caption="Charges">
            <THead>
              <tr>
                <Th>Date</Th>
                <Th>Charge</Th>
                <Th className="text-right">Amount</Th>
                <Th>Status</Th>
                <Th>
                  <span className="sr-only">Actions</span>
                </Th>
              </tr>
            </THead>
            <TBody>
              {charges.map((charge) => (
                <Tr key={charge.id} className={charge.voidedAt ? "text-slate-400" : undefined}>
                  <Td>{formatDay(charge.chargeDate)}</Td>
                  <Td className="whitespace-normal">
                    {charge.description}
                    <span className="block text-xs text-slate-500">
                      {CHARGE_CATEGORY_LABELS[charge.category] ?? charge.category}
                    </span>
                  </Td>
                  <Td className="text-right tabular-nums">{formatPaise(charge.amount)}</Td>
                  <Td>
                    {charge.voidedAt ? (
                      <span className="text-xs whitespace-normal">Void: {charge.voidReason}</span>
                    ) : charge.invoiceId ? (
                      <Link
                        href={`/fees/${charge.invoiceId}`}
                        className="text-brand-700 hover:underline"
                      >
                        On invoice
                      </Link>
                    ) : (
                      <Badge tone="info">Pending</Badge>
                    )}
                  </Td>
                  <Td>
                    {isOwner && editable && !charge.voidedAt && !charge.invoiceId && (
                      <ReasonDialog
                        action={voidCharge}
                        id={charge.id}
                        button="Void"
                        title="Void this charge"
                        description="A void charge stays on record but is never billed."
                        confirm="Void charge"
                        subject={`charge of ${formatPaise(charge.amount)}`}
                      />
                    )}
                  </Td>
                </Tr>
              ))}
            </TBody>
          </Table>
        )}
        {pending.length > 0 && (
          <p className="mt-2 text-sm text-slate-600">
            {formatPaise(pending.reduce((sum, charge) => sum + charge.amount, 0))} pending: it goes
            on the next monthly invoice.
          </p>
        )}
        {editable && (
          <div className="mt-4 space-y-4">
            {isOwner && pending.length > 0 && <BillNowButton residentId={residentId} />}
            <ChargeForm
              residentId={residentId}
              heads={oneTime.map((head) => ({ value: head.id, label: head.name }))}
              today={today}
            />
          </div>
        )}
      </section>

      <section aria-labelledby="discounts-list">
        <h3 id="discounts-list" className="mb-2 text-sm font-semibold text-slate-900">
          Discounts
        </h3>
        {discounts.length === 0 ? (
          <p className="text-sm text-slate-600">No discounts.</p>
        ) : (
          <ul className="divide-y divide-slate-100 rounded-lg border border-slate-200 text-sm">
            {discounts.map((discount) => (
              <li
                key={discount.id}
                className={`flex flex-wrap items-center justify-between gap-2 px-4 py-3 ${discount.voidedAt ? "text-slate-400" : ""}`}
              >
                <span>
                  <span className="font-medium">
                    {discount.kind === "percent"
                      ? `${discount.value}%`
                      : formatPaise(discount.value)}{" "}
                    off {discount.headName ?? "rent"}
                  </span>
                  , {formatMonth(discount.fromMonth, { short: true })}
                  {discount.toMonth
                    ? ` to ${formatMonth(discount.toMonth, { short: true })}`
                    : " onwards"}
                  : {discount.reason}
                  {discount.voidedAt && ` (ended: ${discount.voidReason})`}
                </span>
                {isOwner && editable && !discount.voidedAt && (
                  <ReasonDialog
                    action={endDiscount}
                    id={discount.id}
                    button="End"
                    title="End this discount"
                    description="Invoices already issued keep it; new ones will not."
                    confirm="End discount"
                    subject={`discount: ${discount.reason}`}
                  />
                )}
              </li>
            ))}
          </ul>
        )}
        {isOwner && editable && (
          <div className="mt-4">
            <DiscountForm
              residentId={residentId}
              heads={monthly.map((head) => ({ value: head.id, label: head.name }))}
              currentMonth={today.slice(0, 7)}
            />
          </div>
        )}
      </section>

      {isOwner && editable && currentAllocationId && monthly.length > 0 && (
        <section aria-labelledby="opt-outs">
          <h3 id="opt-outs" className="sr-only">
            Monthly charges
          </h3>
          <OptOutForm
            allocationId={currentAllocationId}
            heads={monthly.map((head) => ({ value: head.id, label: head.name }))}
            optedOut={optedOut}
          />
        </section>
      )}
    </div>
  );
}
