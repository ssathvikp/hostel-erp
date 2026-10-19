import type { Metadata } from "next";

import { PageHeader } from "@/components/shell/PageHeader";
import { Table, TBody, Td, Th, THead, Tr } from "@/components/ui";
import { TrialDaysForm } from "@/features/admin/components/TrialDaysForm";
import { getAdminMetrics, requirePlatformAdmin } from "@/features/admin/queries";
import { formatMonth, formatPaise } from "@/lib/money";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Metrics" };

const day = new Intl.DateTimeFormat("en-IN", { day: "numeric", month: "short", timeZone: "UTC" });

function percent(part: number, whole: number): string {
  return whole === 0 ? "—" : `${Math.round((part / whole) * 100)}%`;
}

/**
 * Whether the business is working (ClickUp E10 "Platform metrics
 * dashboard"): sign-ups, set-up, use, money handled, trial conversion and
 * churn. Aggregates only; no hostel, owner or resident names.
 */
export default async function AdminMetricsPage() {
  await requirePlatformAdmin();
  const metrics = await getAdminMetrics(await createClient());
  const trialsEnded = metrics.trialsConverted + metrics.trialsLapsed;

  const tiles: [string, string, string?][] = [
    ["Owners signed up", String(metrics.owners)],
    [
      "Finished set-up",
      percent(metrics.ownersSetUp, metrics.owners),
      `${metrics.ownersSetUp} of ${metrics.owners} owners`,
    ],
    [
      "Active in the last 30 days",
      String(metrics.hostelsActive30Days),
      `of ${metrics.hostels} hostels`,
    ],
    [
      "Paying hostels",
      String(metrics.plans.paid),
      `${metrics.plans.trial} on trial, ${metrics.plans.free} free`,
    ],
    [
      "Beds managed",
      String(metrics.beds),
      `${metrics.occupiedBeds} occupied (${percent(metrics.occupiedBeds, metrics.beds)})`,
    ],
    ["Residents managed", String(metrics.residents)],
    [
      "Trial conversion",
      percent(metrics.trialsConverted, trialsEnded),
      `${metrics.trialsConverted} paid, ${metrics.trialsLapsed} lapsed`,
    ],
    [
      "Paying hostels lost, 30 days",
      String(metrics.leftPaid30Days),
      metrics.paying30DaysAgo > 0
        ? `${percent(metrics.leftPaid30Days, metrics.paying30DaysAgo)} of ${metrics.paying30DaysAgo} paying then`
        : "None were paying 30 days ago",
    ],
  ];

  return (
    <div className="space-y-6">
      <PageHeader
        title="Metrics"
        description="Platform-wide numbers. No hostel, owner or resident names appear here."
      />

      <dl className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {tiles.map(([label, value, note]) => (
          <div key={label} className="rounded-lg border border-slate-200 bg-white p-4 shadow-xs">
            <dt className="text-sm text-slate-500">{label}</dt>
            <dd className="mt-1 text-2xl font-semibold text-slate-900 tabular-nums">{value}</dd>
            {note && <dd className="mt-0.5 text-xs text-slate-500">{note}</dd>}
          </div>
        ))}
      </dl>

      <div className="grid gap-6 lg:grid-cols-2">
        <section aria-labelledby="signups-heading">
          <h2 id="signups-heading" className="mb-3 text-base font-semibold text-slate-900">
            Sign-ups per week
          </h2>
          <Table caption="Owner sign-ups per week">
            <THead>
              <tr>
                <Th>Week of</Th>
                <Th className="text-right">Owners</Th>
              </tr>
            </THead>
            <TBody>
              {metrics.signupsByWeek.map((week) => (
                <Tr key={week.weekStart}>
                  <Td>{day.format(new Date(week.weekStart))}</Td>
                  <Td className="text-right tabular-nums">{week.owners}</Td>
                </Tr>
              ))}
            </TBody>
          </Table>
        </section>

        <section aria-labelledby="money-heading">
          <h2 id="money-heading" className="mb-3 text-base font-semibold text-slate-900">
            Rent handled through the app
          </h2>
          <Table caption="Invoices and payments per month across all hostels">
            <THead>
              <tr>
                <Th>Month</Th>
                <Th className="text-right">Invoices</Th>
                <Th className="text-right">Billed</Th>
                <Th className="text-right">Payments</Th>
                <Th className="text-right">Collected</Th>
              </tr>
            </THead>
            <TBody>
              {metrics.monthly.map((month) => (
                <Tr key={month.month}>
                  <Td>{formatMonth(month.month, { short: true })}</Td>
                  <Td className="text-right tabular-nums">{month.invoices}</Td>
                  <Td className="text-right tabular-nums">{formatPaise(month.invoiced)}</Td>
                  <Td className="text-right tabular-nums">{month.payments}</Td>
                  <Td className="text-right tabular-nums">{formatPaise(month.collected)}</Td>
                </Tr>
              ))}
            </TBody>
          </Table>
        </section>
      </div>

      <section
        aria-labelledby="trial-heading"
        className="rounded-lg border border-slate-200 bg-white p-5 shadow-xs sm:p-6"
      >
        <h2 id="trial-heading" className="mb-4 text-base font-semibold text-slate-900">
          Free trial
        </h2>
        <TrialDaysForm trialDays={metrics.trialDays} />
      </section>

      <p className="text-xs text-slate-500">
        Revenue (MRR) and subscriptions appear here once billing is connected to a payment gateway.
      </p>
    </div>
  );
}
