import type { Metadata } from "next";
import Link from "next/link";

import { PageHeader } from "@/components/shell/PageHeader";
import { Alert, Badge, EmptyState, Table, TBody, Td, Th, THead, Tr } from "@/components/ui";
import {
  BillingProfileForm,
  CancelPlan,
  ChangePlan,
  PlanPicker,
} from "@/features/billing/components/BillingForms";
import { SOURCE_LABELS, STATUS_LABELS, STATUS_TONES } from "@/features/billing/options";
import { getBillingOverview, type BillingOverview } from "@/features/billing/queries";
import { billingGateway } from "@/lib/billing/config";
import { daysUntil } from "@/lib/billing/pricing";
import { requireActiveHostel } from "@/lib/hostels/active";
import { formatPaise } from "@/lib/money";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Billing" };

const day = new Intl.DateTimeFormat("en-IN", { dateStyle: "medium", timeZone: "Asia/Kolkata" });
const when = new Intl.DateTimeFormat("en-IN", {
  dateStyle: "medium",
  timeStyle: "short",
  timeZone: "Asia/Kolkata",
});

function UsageMeter({ label, used, limit }: { label: string; used: number; limit: number | null }) {
  const share = limit ? Math.min(100, Math.round((used / limit) * 100)) : 0;
  const warn = limit !== null && used >= limit * 0.8;
  return (
    <div>
      <div className="flex justify-between text-sm">
        <span className="text-slate-700">{label}</span>
        <span className="text-slate-900 tabular-nums">
          {used.toLocaleString("en-IN")}
          {limit === null ? " · no limit" : ` of ${limit.toLocaleString("en-IN")}`}
        </span>
      </div>
      {limit !== null && (
        <div
          role="meter"
          aria-label={`${label} used`}
          aria-valuemin={0}
          aria-valuemax={limit}
          aria-valuenow={Math.min(used, limit)}
          className="mt-1 h-2 rounded-full bg-slate-100"
        >
          <div
            className={warn ? "h-2 rounded-full bg-amber-500" : "h-2 rounded-full bg-brand-600"}
            style={{ width: `${share}%` }}
          />
        </div>
      )}
      {warn && (
        <p className="mt-1 text-xs text-amber-800">
          {used >= limit! ? "Limit reached." : "Over 80% of your limit."} Upgrade to add more.
        </p>
      )}
    </div>
  );
}

function StatusSummary({ overview }: { overview: BillingOverview }) {
  const { subscription: s, plan } = overview;
  let detail: string;
  if (s.status === "trialing" && s.trial_ends_at) {
    const left = daysUntil(s.trial_ends_at);
    detail = s.can_write
      ? `Your free trial ends on ${day.format(new Date(s.trial_ends_at))} (${left} ${left === 1 ? "day" : "days"} left). Choose a plan to keep working without interruption.`
      : "Your free trial has ended. Choose a plan to start working again; all of your data is kept.";
  } else if (s.status === "past_due") {
    detail = `Your last payment did not go through. The gateway is retrying. Full access continues until ${s.grace_ends_at ? day.format(new Date(s.grace_ends_at)) : "the grace period ends"}; update your payment method to avoid interruption.`;
  } else if (s.status === "read_only" || s.status === "cancelled" || !s.can_write) {
    detail =
      "Your account is read-only. Everything is kept and can be viewed, printed and exported. Choose a plan to work again.";
  } else if (s.complimentary) {
    detail = s.current_period_end
      ? `Complimentary from Hostel ERP until ${day.format(new Date(s.current_period_end))}.`
      : "Complimentary from Hostel ERP.";
  } else if (s.cancel_at_period_end && s.current_period_end) {
    detail = `Cancelled. Full access until ${day.format(new Date(s.current_period_end))}, then read-only.`;
  } else if (s.current_period_end && s.has_gateway) {
    detail = `Next charge ${formatPaise(s.amount_with_gst)} including GST on ${day.format(new Date(s.current_period_end))}.`;
  } else {
    detail = "No payment is due.";
  }

  return (
    <section
      aria-labelledby="plan-heading"
      className="space-y-4 rounded-lg border border-slate-200 bg-white p-4"
    >
      <div className="flex flex-wrap items-center gap-3">
        <h2 id="plan-heading" className="text-lg font-semibold text-slate-900">
          {plan.name}
          {s.status !== "trialing" && !s.complimentary && s.amount > 0 && (
            <span className="ml-2 text-sm font-normal text-slate-500">
              {formatPaise(s.amount)} / {s.billing_interval === "month" ? "month" : "year"} + GST
            </span>
          )}
        </h2>
        <Badge tone={STATUS_TONES[s.status]}>{STATUS_LABELS[s.status]}</Badge>
      </div>
      <p className="text-sm text-slate-700">{detail}</p>
      {s.pending_plan && (
        <p className="text-sm text-slate-700">
          Moving to {s.pending_plan}
          {s.pending_interval && ` (${s.pending_interval === "month" ? "monthly" : "annual"})`} at
          your next renewal.
        </p>
      )}
      {s.checkout_started_at && (
        <Alert tone="info">
          Checkout started {when.format(new Date(s.checkout_started_at))}. Your plan activates as
          soon as the payment gateway confirms; refresh this page after paying.
        </Alert>
      )}
      <div className="grid gap-4 sm:grid-cols-3">
        <UsageMeter label="Beds" used={overview.usage.beds} limit={plan.max_beds} />
        <UsageMeter label="Hostels" used={overview.usage.hostels} limit={plan.max_hostels} />
        <UsageMeter label="Staff accounts" used={overview.usage.staff} limit={plan.max_staff} />
      </div>
    </section>
  );
}

/**
 * The owner's billing page (E14-T8): plan and status, usage against limits,
 * choosing or changing a plan, cancelling, business details for invoices,
 * and every invoice. Staff never see it.
 */
export default async function BillingPage() {
  const { user } = await requireActiveHostel();
  if (user.role !== "owner") {
    return (
      <>
        <PageHeader title="Billing" />
        <Alert tone="info">Only the owner manages billing.</Alert>
      </>
    );
  }

  const supabase = await createClient();
  const overview = await getBillingOverview(supabase);
  const gatewayReady = billingGateway() !== null;

  if (!overview) {
    return (
      <>
        <PageHeader title="Billing" />
        <EmptyState
          title="No subscription yet"
          description="Your free trial starts when you create your first hostel."
        />
      </>
    );
  }

  const s = overview.subscription;
  const paid = (s.status === "active" || s.status === "past_due") && s.has_gateway;

  return (
    <div className="space-y-8">
      <PageHeader
        title="Billing"
        description="Your Hostel ERP plan, what it costs and your invoices. Prices exclude GST."
      />
      <StatusSummary overview={overview} />

      {paid && !s.cancel_at_period_end ? (
        <>
          <ChangePlan overview={overview} gatewayReady={gatewayReady} />
          <div className="flex flex-wrap items-center gap-3">
            <CancelPlan periodEnd={s.current_period_end} />
            <p className="text-sm text-slate-600">
              To change your card or UPI mandate, use the link in the payment gateway&apos;s emails,
              or contact support.
            </p>
          </div>
        </>
      ) : (
        !(s.complimentary && s.can_write) && (
          <PlanPicker overview={overview} gatewayReady={gatewayReady} />
        )
      )}

      <section aria-labelledby="details-heading" className="space-y-3">
        <div>
          <h2 id="details-heading" className="text-lg font-semibold text-slate-900">
            Billing details
          </h2>
          <p className="text-sm text-slate-600">
            Shown on your tax invoices. Add your GSTIN to claim input tax credit.
          </p>
        </div>
        <BillingProfileForm profile={overview.profile} />
      </section>

      <section aria-labelledby="invoices-heading" className="space-y-3">
        <h2 id="invoices-heading" className="text-lg font-semibold text-slate-900">
          Invoices
        </h2>
        {overview.invoices.length === 0 ? (
          <p className="text-sm text-slate-600">
            No invoices yet. One is issued for every payment.
          </p>
        ) : (
          <Table caption="Invoices">
            <THead>
              <tr>
                <Th>Number</Th>
                <Th>Date</Th>
                <Th>Description</Th>
                <Th className="text-right">Amount</Th>
                <Th>
                  <span className="sr-only">Download</span>
                </Th>
              </tr>
            </THead>
            <TBody>
              {overview.invoices.map((invoice) => (
                <Tr key={invoice.id}>
                  <Td className="font-mono">
                    {invoice.number}
                    {invoice.kind === "credit_note" && (
                      <span className="ml-2">
                        <Badge>Credit note</Badge>
                      </span>
                    )}
                  </Td>
                  <Td>{day.format(new Date(invoice.issued_at))}</Td>
                  <Td className="whitespace-normal">{invoice.description}</Td>
                  <Td className="text-right tabular-nums">
                    {invoice.kind === "credit_note" ? "−" : ""}
                    {formatPaise(invoice.total)}
                  </Td>
                  <Td className="text-right">
                    <Link
                      href={`/settings/billing/invoices/${invoice.id}`}
                      className="font-medium text-brand-700 hover:underline"
                      aria-label={`View or download ${invoice.number}`}
                    >
                      View / PDF
                    </Link>
                  </Td>
                </Tr>
              ))}
            </TBody>
          </Table>
        )}
      </section>

      {overview.history.length > 0 && (
        <section aria-labelledby="history-heading" className="space-y-3">
          <h2 id="history-heading" className="text-lg font-semibold text-slate-900">
            History
          </h2>
          <ul className="divide-y divide-slate-100 rounded-lg border border-slate-200 bg-white">
            {overview.history.map((event, index) => (
              <li key={`${event.created_at}-${index}`} className="px-4 py-2 text-sm">
                <span className="text-slate-500">{when.format(new Date(event.created_at))}</span>{" "}
                <span className="text-slate-900">
                  {event.from_status && event.from_status !== event.to_status
                    ? `${STATUS_LABELS[event.from_status]} → ${STATUS_LABELS[event.to_status]}`
                    : STATUS_LABELS[event.to_status]}
                  {event.plan && ` · ${event.plan}`}
                </span>{" "}
                <span className="text-slate-500">
                  by {SOURCE_LABELS[event.source] ?? event.source}
                  {event.reason && ` · ${event.reason}`}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
