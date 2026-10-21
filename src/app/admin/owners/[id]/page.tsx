import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { PageHeader } from "@/components/shell/PageHeader";
import { Badge } from "@/components/ui";
import { SupportActionForm } from "@/features/admin/components/SupportForms";
import { HOSTEL_STATUS_LABELS, HOSTEL_STATUS_TONES, PLAN_LABELS } from "@/features/admin/options";
import {
  getAdminHostels,
  getAdminOwners,
  getAuditEntries,
  requirePlatformAdmin,
} from "@/features/admin/queries";
import { AuditTable } from "@/features/admin/components/AuditTable";
import { SubscriptionForm } from "@/features/billing/components/AdminBillingForms";
import { SUBSCRIPTION_STATUS_LABELS, SUBSCRIPTION_STATUS_TONES } from "@/features/billing/options";
import { getAdminSubscription, getPlans } from "@/features/billing/queries";
import { formatPaise } from "@/lib/money";
import { createClient } from "@/lib/supabase/server";
import { uuid } from "@/lib/validation";

export const metadata: Metadata = { title: "Owner" };

const moment = new Intl.DateTimeFormat("en-IN", {
  dateStyle: "medium",
  timeStyle: "short",
  timeZone: "Asia/Kolkata",
});

/** One owner: account state, hostels, and support actions (ClickUp E10-T4, E10-T8). */
export default async function AdminOwnerPage({ params }: { params: Promise<{ id: string }> }) {
  await requirePlatformAdmin();
  const { id } = await params;
  if (!uuid("Owner").safeParse(id).success) notFound();
  const supabase = await createClient();
  const [{ owners }, hostels] = await Promise.all([
    getAdminOwners(supabase, { ownerId: id }),
    getAdminHostels(supabase),
  ]);
  const owner = owners[0];
  if (!owner) notFound();
  const theirs = hostels.filter((hostel) => hostel.ownerEmail === owner.email);
  const [{ entries: history }, subscription, plans] = await Promise.all([
    getAuditEntries(supabase, { targetUserId: id, limit: 20 }),
    getAdminSubscription(supabase, id),
    getPlans(supabase),
  ]);

  const facts: [string, string][] = [
    ["E-mail", owner.email],
    ["Phone", owner.phone ?? "—"],
    ["Signed up", moment.format(new Date(owner.createdAt))],
    [
      "E-mail confirmed",
      owner.emailConfirmedAt ? moment.format(new Date(owner.emailConfirmedAt)) : "Not yet",
    ],
    ["Last sign-in", owner.lastSignInAt ? moment.format(new Date(owner.lastSignInAt)) : "Never"],
    ["Referred by", owner.referredByName ?? "—"],
  ];

  return (
    <div className="max-w-4xl space-y-6">
      <div>
        <Link href="/admin/owners" className="text-sm font-medium text-brand-700 hover:underline">
          ← All owners
        </Link>
        <div className="mt-2">
          <PageHeader title={owner.fullName} />
        </div>
      </div>

      <dl className="grid gap-x-6 gap-y-3 rounded-lg border border-slate-200 bg-white p-5 text-sm shadow-xs sm:grid-cols-2 sm:p-6">
        {facts.map(([label, value]) => (
          <div key={label} className="flex justify-between gap-4 border-b border-slate-100 pb-2">
            <dt className="text-slate-500">{label}</dt>
            <dd className="text-right font-medium break-all text-slate-900">{value}</dd>
          </div>
        ))}
      </dl>

      {subscription && (
        <section
          aria-labelledby="owner-subscription"
          className="space-y-4 rounded-lg border border-slate-200 bg-white p-5 shadow-xs sm:p-6"
        >
          <div className="flex flex-wrap items-center gap-3">
            <h2 id="owner-subscription" className="text-base font-semibold text-slate-900">
              Subscription
            </h2>
            <Badge tone={SUBSCRIPTION_STATUS_TONES[subscription.effectiveStatus]}>
              {SUBSCRIPTION_STATUS_LABELS[subscription.effectiveStatus]}
            </Badge>
          </div>
          <p className="text-sm text-slate-600">
            {plans.find((plan) => plan.id === subscription.planId)?.name ?? subscription.planId}
            {subscription.priceMonthly > 0 &&
              ` at ${formatPaise(subscription.priceMonthly)} a month`}{" "}
            · {subscription.usage.beds} beds, {subscription.usage.hostels} hostels,{" "}
            {subscription.usage.staff} staff
          </p>
          <SubscriptionForm
            ownerId={id}
            plans={plans}
            current={{
              planId: subscription.planId,
              status: subscription.status,
              trialEndsAt: subscription.trialEndsAt,
              periodEnd: subscription.currentPeriodEnd,
            }}
          />
          {subscription.events.length > 0 && (
            <details className="text-sm">
              <summary className="cursor-pointer font-medium text-brand-700">History</summary>
              <ul className="mt-2 space-y-1 text-slate-700">
                {subscription.events.map((event, index) => (
                  <li key={index}>
                    {moment.format(new Date(event.createdAt))}:{" "}
                    {event.fromPlan ? `${event.fromPlan} → ` : ""}
                    {event.toPlan}, {event.fromStatus ? `${event.fromStatus} → ` : ""}
                    {event.toStatus}
                    {event.reason && ` (${event.reason})`}
                  </li>
                ))}
              </ul>
            </details>
          )}
        </section>
      )}

      <section aria-labelledby="owner-hostels">
        <h2 id="owner-hostels" className="mb-3 text-base font-semibold text-slate-900">
          Hostels
        </h2>
        {theirs.length === 0 ? (
          <p className="text-sm text-slate-600">No hostels yet.</p>
        ) : (
          <ul className="divide-y divide-slate-100 rounded-lg border border-slate-200 bg-white shadow-xs">
            {theirs.map((hostel) => (
              <li key={hostel.id} className="flex flex-wrap items-center gap-3 px-4 py-3 text-sm">
                <Link
                  href={`/admin/hostels/${hostel.id}`}
                  className="font-medium text-brand-700 hover:underline"
                >
                  {hostel.name}
                </Link>
                <Badge tone={HOSTEL_STATUS_TONES[hostel.status] ?? "neutral"}>
                  {HOSTEL_STATUS_LABELS[hostel.status] ?? hostel.status}
                </Badge>
                <span className="text-slate-600">{PLAN_LABELS[hostel.plan] ?? hostel.plan}</span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section
        aria-labelledby="support-actions"
        className="rounded-lg border border-slate-200 bg-white p-5 shadow-xs sm:p-6"
      >
        <h2 id="support-actions" className="text-base font-semibold text-slate-900">
          Help with their account
        </h2>
        <p className="mt-1 mb-4 text-sm text-slate-600">
          You never see or set their password. E-mail address changes are made by the owner from
          their own account.
        </p>
        <SupportActionForm
          userId={owner.id}
          email={owner.email}
          confirmed={owner.emailConfirmedAt !== null}
        />
      </section>

      {history.length > 0 && (
        <section aria-labelledby="owner-history">
          <h2 id="owner-history" className="mb-3 text-base font-semibold text-slate-900">
            Support history
          </h2>
          <AuditTable entries={history} />
        </section>
      )}
    </div>
  );
}
