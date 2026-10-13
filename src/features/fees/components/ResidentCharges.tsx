import Link from "next/link";

import { Badge, Table, TBody, Td, Th, THead, Tr } from "@/components/ui";
import { formatMonth, formatPaise } from "@/lib/money";

import type { Discount, FeeHead, ResidentCharge } from "../queries";
import {
  AddChargeDialog,
  AddDiscountDialog,
  BillChargesNowButton,
  EndDiscountForm,
} from "./ChargeForms";
import { VoidDialog } from "./VoidDialog";

const day = new Intl.DateTimeFormat("en-IN", { dateStyle: "medium", timeZone: "UTC" });

const STATUS: Record<
  ResidentCharge["status"],
  { label: string; tone: "warning" | "success" | "neutral" }
> = {
  pending: { label: "Next invoice", tone: "warning" },
  invoiced: { label: "Billed", tone: "success" },
  void: { label: "Void", tone: "neutral" },
};

function discountSize(discount: Discount): string {
  return discount.percent !== null ? `${discount.percent}%` : formatPaise(discount.amount ?? 0);
}

/**
 * A resident's one-off charges, late fees and discounts (E13-T2, E13-T5,
 * E13-T6), with the actions each role may take.
 */
export function ResidentCharges({
  resident,
  charges,
  discounts,
  heads,
  isOwner,
}: {
  resident: { id: string; name: string };
  charges: readonly ResidentCharge[];
  discounts: readonly Discount[];
  heads: readonly FeeHead[];
  isOwner: boolean;
}) {
  const pending = charges.filter((charge) => charge.status === "pending");
  const oneTimeHeads = heads.filter((head) => head.billing === "one_time" && head.active);
  const monthlyHeads = heads.filter((head) => head.billing === "monthly" && head.active);

  return (
    <div className="space-y-6">
      <div>
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <h3 className="text-sm font-semibold text-slate-900">Charges and late fees</h3>
          <div className="flex flex-wrap gap-2">
            <AddChargeDialog
              residentId={resident.id}
              residentName={resident.name}
              heads={oneTimeHeads}
            />
            {isOwner && pending.length > 0 && <BillChargesNowButton residentId={resident.id} />}
          </div>
        </div>
        {charges.length === 0 ? (
          <p className="text-sm text-slate-600">No one-off charges.</p>
        ) : (
          <Table caption="Charges and late fees">
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
                <Tr
                  key={charge.id}
                  className={charge.status === "void" ? "text-slate-400" : undefined}
                >
                  <Td>{day.format(new Date(charge.chargeDate))}</Td>
                  <Td className="whitespace-normal">
                    {charge.description}
                    {charge.status === "void" && charge.voidReason && (
                      <span className="block text-xs">Void: {charge.voidReason}</span>
                    )}
                  </Td>
                  <Td className="text-right tabular-nums">{formatPaise(charge.amount)}</Td>
                  <Td>
                    {charge.status === "invoiced" && charge.invoiceId ? (
                      <Link
                        href={`/fees/${charge.invoiceId}`}
                        className="font-medium text-brand-700 hover:underline"
                      >
                        Billed
                      </Link>
                    ) : (
                      <Badge tone={STATUS[charge.status].tone}>{STATUS[charge.status].label}</Badge>
                    )}
                  </Td>
                  <Td className="text-right">
                    {isOwner && charge.status === "pending" && (
                      <VoidDialog
                        kind="charge"
                        id={charge.id}
                        subject={`${charge.kind === "late_fee" ? "late fee" : "charge"} of ${formatPaise(charge.amount)}`}
                      />
                    )}
                  </Td>
                </Tr>
              ))}
            </TBody>
          </Table>
        )}
      </div>

      <div>
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <h3 className="text-sm font-semibold text-slate-900">Discounts</h3>
          {isOwner && (
            <AddDiscountDialog
              residentId={resident.id}
              residentName={resident.name}
              heads={monthlyHeads}
            />
          )}
        </div>
        {discounts.length === 0 ? (
          <p className="text-sm text-slate-600">No discounts.</p>
        ) : (
          <ul className="divide-y divide-slate-100 text-sm">
            {discounts.map((discount) => (
              <li key={discount.id} className="space-y-2 py-3">
                <p>
                  <span className="font-medium">
                    {discountSize(discount)} off {discount.target.toLowerCase()}
                  </span>{" "}
                  from {formatMonth(discount.fromMonth)}
                  {discount.toMonth ? ` to ${formatMonth(discount.toMonth)}` : ", no end date"}
                  <span className="text-slate-600"> · {discount.reason}</span>
                </p>
                {isOwner && !discount.toMonth && (
                  <EndDiscountForm
                    discountId={discount.id}
                    residentId={resident.id}
                    label={`${discountSize(discount)} off ${discount.target.toLowerCase()}`}
                  />
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
