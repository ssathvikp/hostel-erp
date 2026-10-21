import type { Metadata } from "next";
import Link from "next/link";

import { Alert, Badge, Table, TBody, Td, Th, THead, Tr } from "@/components/ui";
import { UsagePanel } from "@/features/billing/components/UsagePanel";
import { SUBSCRIPTION_STATUS_LABELS, SUBSCRIPTION_STATUS_TONES } from "@/features/billing/options";
import { getAccountStatus, getPlans } from "@/features/billing/queries";
import { requireActiveHostel } from "@/lib/hostels/active";
import { daysBetween, formatPaise } from "@/lib/money";
import { createClient } from "@/lib/supabase/server";
import { todayIst } from "@/lib/validation";

export const metadata: Metadata = { title: "Billing" };

const day = new Intl.DateTimeFormat("en-IN", { dateStyle: "medium", timeZone: "UTC" });
const limit = (value: number | null, unit: string) =>
  value === null ? `Unlimited ${unit}` : `${value} ${unit}`;

/**
 * The owner's plan, status and usage (ClickUp EP-14). Changing plan is done
 * with Hostel ERP for now; online payment, invoices and the payment method
 * arrive with a payment gateway.
 */
export default async function BillingPage() {
  const { user, hostel } = await requireActiveHostel();
  if (user.role !== "owner") {
    return <Alert tone="info">Only the hostel owner can see billing.</Alert>;
  }
  const supabase = await createClient();
  const [account, plans] = await Promise.all([
    getAccountStatus(supabase, hostel.id),
    getPlans(supabase),
  ]);
  if (!account) return <Alert tone="info">No subscription is set up for this account yet.</Alert>;
  const today = todayIst();
  const trialLeft =
    account.effectiveStatus === "trialing" && account.trialEndsAt
      ? daysBetween(today, account.trialEndsAt)
      : null;
  const offered = plans.filter((plan) => plan.public && plan.active);

  return (
    <div className="max-w-4xl space-y-6">
      <section
        aria-labelledby="plan-heading"
        className="space-y-4 rounded-lg border border-slate-200 bg-white p-5 shadow-xs sm:p-6"
      >
        <div className="flex flex-wrap items-center gap-3">
          <h2 id="plan-heading" className="text-lg font-semibold text-slate-900">
            {account.planName}
          </h2>
          <Badge tone={SUBSCRIPTION_STATUS_TONES[account.effectiveStatus]}>
            {SUBSCRIPTION_STATUS_LABELS[account.effectiveStatus]}
          </Badge>
        </div>
        <p className="text-sm text-slate-700">
          {trialLeft !== null
            ? `Your free trial ends on ${day.format(new Date(account.trialEndsAt!))}${
                trialLeft === 0
                  ? " (today)"
                  : ` (${trialLeft} ${trialLeft === 1 ? "day" : "days"} left)`
              }. Everything is included while it runs.`
            : account.effectiveStatus === "read_only"
              ? "The account is read-only: you can view, print and download everything, but not change it."
              : account.effectiveStatus === "active"
                ? `${account.priceMonthly ? `${formatPaise(account.priceMonthly)} a month. ` : ""}${
                    account.currentPeriodEnd
                      ? `Paid until ${day.format(new Date(account.currentPeriodEnd))}.`
                      : ""
                  }`
                : SUBSCRIPTION_STATUS_LABELS[account.effectiveStatus]}
        </p>
        <UsagePanel account={account} />
      </section>

      <section
        aria-labelledby="plans-heading"
        className="space-y-4 rounded-lg border border-slate-200 bg-white p-5 shadow-xs sm:p-6"
      >
        <div>
          <h2 id="plans-heading" className="text-lg font-semibold text-slate-900">
            Plans
          </h2>
          <p className="mt-1 text-sm text-slate-600">
            To choose or change a plan, write to us from the{" "}
            <Link href="/legal/contact" className="text-brand-700 underline">
              contact page
            </Link>
            . Upgrades apply at once; downgrades at the end of the period paid for.
          </p>
        </div>
        <Table caption="Plans on offer">
          <THead>
            <tr>
              <Th>Plan</Th>
              <Th className="text-right">Per month</Th>
              <Th>Includes</Th>
            </tr>
          </THead>
          <TBody>
            {offered.map((plan) => (
              <Tr key={plan.id}>
                <Td>
                  <span className="font-medium">{plan.name}</span>
                  {plan.id === account.planId && <Badge className="ml-2">Your plan</Badge>}
                </Td>
                <Td className="text-right tabular-nums">
                  {formatPaise(plan.monthlyPrice)}
                  <span className="block text-xs text-slate-500">
                    {plan.gstInclusive ? "incl. GST" : "+ GST"}
                  </span>
                </Td>
                <Td>
                  {limit(plan.maxBeds, "beds")} · {limit(plan.maxHostels, "hostels")} ·{" "}
                  {limit(plan.maxStaff, "staff")}
                </Td>
              </Tr>
            ))}
          </TBody>
        </Table>
      </section>
    </div>
  );
}
