import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { PageHeader } from "@/components/shell/PageHeader";
import { Badge, Table, TBody, Td, Th, THead, Tr } from "@/components/ui";
import { getAccountsBilling, getAdminPlans } from "@/features/admin/billing-queries";
import { SupportActionButton } from "@/features/admin/components/AdminForms";
import {
  ComplimentaryButton,
  CorrectPlanButton,
  ExtendTrialButton,
} from "@/features/admin/components/BillingAdminForms";
import { HostelStatusBadge } from "@/features/admin/components/SearchBar";
import { AUDIT_ACTION_LABELS, getAccount } from "@/features/admin/queries";
import { SOURCE_LABELS, STATUS_LABELS, STATUS_TONES } from "@/features/billing/options";
import { formatPaise } from "@/lib/money";
import { requirePlatformAdmin } from "@/lib/auth/admin";
import { createClient } from "@/lib/supabase/server";
import { uuid } from "@/lib/validation";

export const metadata: Metadata = { title: "Owner" };

const at = new Intl.DateTimeFormat("en-IN", {
  dateStyle: "medium",
  timeStyle: "short",
  timeZone: "Asia/Kolkata",
});

/**
 * One owner account (E10-T4, E10-T9): who they are, their hostels, support
 * actions that never touch a password, their plan with manual adjustments
 * (E10-T7), and what admins have done for them. Opening this page is itself
 * recorded.
 */
export default async function OwnerPage({ params }: { params: Promise<{ id: string }> }) {
  await requirePlatformAdmin();
  const { id } = await params;
  if (!uuid("Account").safeParse(id).success) notFound();
  const supabase = await createClient();
  const account = await getAccount(supabase, id);
  if (!account) notFound();
  const [billingById, plans] = await Promise.all([
    getAccountsBilling(supabase, [account.id]),
    getAdminPlans(supabase),
  ]);
  const billing = billingById[account.id];
  const activePlans = plans.filter((plan) => plan.is_active);

  return (
    <div className="space-y-8">
      <div>
        <Link
          href="/admin/customers"
          className="text-sm font-medium text-brand-700 hover:underline"
        >
          ← All owners
        </Link>
        <div className="mt-2">
          <PageHeader title={account.full_name} description={account.email} />
        </div>
      </div>

      <dl className="grid gap-4 rounded-lg border border-slate-200 bg-white p-5 text-sm sm:grid-cols-4">
        <div>
          <dt className="text-slate-500">Signed up</dt>
          <dd>{at.format(new Date(account.created_at))}</dd>
        </div>
        <div>
          <dt className="text-slate-500">Email</dt>
          <dd>
            {account.email_confirmed_at ? (
              <Badge tone="success">Confirmed</Badge>
            ) : (
              <Badge tone="warning">Not confirmed</Badge>
            )}
          </dd>
        </div>
        <div>
          <dt className="text-slate-500">Last sign-in</dt>
          <dd>
            {account.last_sign_in_at ? at.format(new Date(account.last_sign_in_at)) : "Never"}
          </dd>
        </div>
        <div>
          <dt className="text-slate-500">Signed-in devices</dt>
          <dd className="tabular-nums">{account.sessions}</dd>
        </div>
      </dl>

      <section aria-labelledby="support-heading" className="space-y-3">
        <h2 id="support-heading" className="text-base font-semibold text-slate-900">
          Support
        </h2>
        <div className="flex flex-wrap items-start gap-3">
          {!account.email_confirmed_at && (
            <SupportActionButton accountId={account.id} action="resend_confirmation" />
          )}
          <SupportActionButton accountId={account.id} action="password_reset" />
          <SupportActionButton accountId={account.id} action="sign_out_everywhere" />
        </div>
        <p className="text-xs text-slate-500">
          To change an owner&apos;s email address, they change it themselves; Supabase confirms both
          the old and the new address.
        </p>
      </section>

      <section aria-labelledby="billing-heading" className="space-y-3">
        <h2 id="billing-heading" className="text-base font-semibold text-slate-900">
          Plan and billing
        </h2>
        {!billing ? (
          <p className="text-sm text-slate-600">
            No subscription yet: the trial starts with the owner&apos;s first hostel.
          </p>
        ) : (
          <>
            <dl className="grid gap-4 rounded-lg border border-slate-200 bg-white p-5 text-sm sm:grid-cols-4">
              <div>
                <dt className="text-slate-500">Plan</dt>
                <dd>
                  {billing.plan_name}{" "}
                  <Badge tone={STATUS_TONES[billing.status]}>{STATUS_LABELS[billing.status]}</Badge>
                  {billing.complimentary && (
                    <span className="ml-1">
                      <Badge tone="info">Complimentary</Badge>
                    </span>
                  )}
                </dd>
              </div>
              <div>
                <dt className="text-slate-500">Price</dt>
                <dd>
                  {billing.amount > 0
                    ? `${formatPaise(billing.amount)} / ${billing.billing_interval === "month" ? "month" : "year"} + GST`
                    : "Free"}
                </dd>
              </div>
              <div>
                <dt className="text-slate-500">
                  {billing.status === "trialing" ? "Trial ends" : "Next billing"}
                </dt>
                <dd>
                  {(() => {
                    const date =
                      billing.status === "trialing"
                        ? billing.trial_ends_at
                        : billing.next_billing_at;
                    return date ? at.format(new Date(date)) : "—";
                  })()}
                  {billing.cancel_at_period_end && billing.current_period_end && (
                    <span className="block text-xs text-slate-500">
                      Ends {at.format(new Date(billing.current_period_end))}
                    </span>
                  )}
                </dd>
              </div>
              <div>
                <dt className="text-slate-500">Can work</dt>
                <dd>
                  {billing.can_write ? (
                    <Badge tone="success">Yes</Badge>
                  ) : (
                    <Badge tone="danger">Read-only</Badge>
                  )}
                </dd>
              </div>
              <div>
                <dt className="text-slate-500">Usage</dt>
                <dd className="tabular-nums">
                  {billing.usage.beds} beds · {billing.usage.hostels} hostels ·{" "}
                  {billing.usage.staff} staff
                </dd>
              </div>
              <div className="sm:col-span-3">
                <dt className="text-slate-500">Gateway subscription</dt>
                <dd className="font-mono text-xs">{billing.gateway_subscription_id ?? "None"}</dd>
              </div>
            </dl>
            <div className="flex flex-wrap items-start gap-3">
              <ExtendTrialButton accountId={account.id} />
              <ComplimentaryButton accountId={account.id} plans={activePlans} />
              <CorrectPlanButton
                accountId={account.id}
                plans={activePlans}
                current={{ plan: billing.plan_code, interval: billing.billing_interval }}
              />
            </div>
            {billing.history.length > 0 && (
              <ul className="divide-y divide-slate-100 rounded-lg border border-slate-200 bg-white text-sm">
                {billing.history.map((event, index) => (
                  <li key={`${event.created_at}-${index}`} className="px-4 py-2">
                    <span className="font-medium">
                      {event.from_status && event.from_status !== event.to_status
                        ? `${STATUS_LABELS[event.from_status]} → ${STATUS_LABELS[event.to_status]}`
                        : STATUS_LABELS[event.to_status]}
                    </span>
                    {event.plan && ` · ${event.plan}`}
                    {event.reason && <span className="text-slate-600"> · {event.reason}</span>}
                    <span className="block text-xs text-slate-500">
                      {SOURCE_LABELS[event.source] ?? event.source},{" "}
                      {at.format(new Date(event.created_at))}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </>
        )}
      </section>

      <section aria-labelledby="hostels-heading" className="space-y-3">
        <h2 id="hostels-heading" className="text-base font-semibold text-slate-900">
          Hostels
        </h2>
        {account.hostels.length === 0 ? (
          <p className="text-sm text-slate-600">
            No hostel yet: the sign-up stalled before onboarding.
          </p>
        ) : (
          <Table caption="The owner's hostels">
            <THead>
              <tr>
                <Th>Hostel</Th>
                <Th>Status</Th>
                <Th>City</Th>
                <Th>Created</Th>
              </tr>
            </THead>
            <TBody>
              {account.hostels.map((hostel) => (
                <Tr key={hostel.id}>
                  <Td>
                    <Link
                      href={`/admin/hostels/${hostel.id}`}
                      className="font-medium text-brand-700 hover:underline"
                    >
                      {hostel.name}
                    </Link>
                  </Td>
                  <Td>
                    <HostelStatusBadge status={hostel.status} />
                  </Td>
                  <Td>{hostel.city ?? "—"}</Td>
                  <Td>{at.format(new Date(hostel.created_at))}</Td>
                </Tr>
              ))}
            </TBody>
          </Table>
        )}
      </section>

      <section aria-labelledby="activity-heading" className="space-y-3">
        <h2 id="activity-heading" className="text-base font-semibold text-slate-900">
          Admin activity
        </h2>
        {account.activity.length === 0 ? (
          <p className="text-sm text-slate-600">No admin has acted on this account.</p>
        ) : (
          <ul className="divide-y divide-slate-100 rounded-lg border border-slate-200 bg-white text-sm">
            {account.activity.map((row, i) => (
              <li key={i} className="px-4 py-2">
                <span className="font-medium">{AUDIT_ACTION_LABELS[row.action] ?? row.action}</span>
                {row.hostel_name && ` · ${row.hostel_name}`}
                {row.reason && <span className="text-slate-600"> · {row.reason}</span>}
                <span className="block text-xs text-slate-500">
                  {row.actor_email}, {at.format(new Date(row.created_at))}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
