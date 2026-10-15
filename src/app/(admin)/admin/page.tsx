import type { Metadata } from "next";

import { PageHeader } from "@/components/shell/PageHeader";
import { Table, TBody, Td, Th, THead, Tr } from "@/components/ui";
import { getRevenueMetrics } from "@/features/admin/billing-queries";
import { getPlatformMetrics } from "@/features/admin/queries";
import { requirePlatformAdmin } from "@/lib/auth/admin";
import { formatMonth, formatPaise } from "@/lib/money";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Overview" };

const week = new Intl.DateTimeFormat("en-IN", { day: "numeric", month: "short", timeZone: "UTC" });

function Tile({ label, value, note }: { label: string; value: string; note?: string }) {
  return (
    <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-xs">
      <p className="text-sm text-slate-500">{label}</p>
      <p className="mt-1 text-2xl font-semibold text-slate-900 tabular-nums">{value}</p>
      {note && <p className="text-xs text-slate-500">{note}</p>}
    </div>
  );
}

/**
 * How the platform is doing (E10-T8): sign-ups, activation and usage across
 * every hostel, as aggregates with no customer names, and Hostel ERP's own
 * subscription revenue (E14-T12).
 */
export default async function AdminOverviewPage() {
  await requirePlatformAdmin();
  const supabase = await createClient();
  const [metrics, revenue] = await Promise.all([
    getPlatformMetrics(supabase),
    getRevenueMetrics(supabase),
  ]);
  const occupancy = metrics.beds ? Math.round((100 * metrics.occupied_beds) / metrics.beds) : 0;

  return (
    <div className="space-y-8">
      <PageHeader title="Platform overview" description="Every hostel on Hostel ERP, in total." />

      <section aria-labelledby="revenue-heading" className="space-y-3">
        <h2 id="revenue-heading" className="text-base font-semibold text-slate-900">
          Subscription revenue
        </h2>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Tile
            label="MRR"
            value={formatPaise(revenue.mrr)}
            note={`ARR ${formatPaise(revenue.arr)} · excluding GST`}
          />
          <Tile
            label="Paying accounts"
            value={String(revenue.paying)}
            note={`${revenue.by_status.trialing} trialing · ${revenue.complimentary} complimentary`}
          />
          <Tile
            label="Trial to paid"
            value={revenue.trial_conversion == null ? "—" : `${revenue.trial_conversion}%`}
            note={`Of ${revenue.trials_finished_90_days} trials ended in 90 days`}
          />
          <Tile
            label="Monthly churn"
            value={revenue.monthly_churn == null ? "—" : `${revenue.monthly_churn}%`}
            note={`${revenue.churned_30_days} left in the last 30 days`}
          />
          <Tile
            label="Failed payments"
            value={String(revenue.past_due.count)}
            note={`${formatPaise(revenue.past_due.amount)} awaiting recovery, GST included`}
          />
          <Tile
            label="Read-only"
            value={String(revenue.by_status.read_only)}
            note={`${revenue.by_status.cancelled} cancelled`}
          />
        </div>
      </section>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Tile label="Owners" value={String(metrics.owners)} />
        <Tile
          label="Hostels"
          value={String(metrics.hostels.total)}
          note={`${metrics.hostels.active} active · ${metrics.hostels.draft} in setup · ${metrics.hostels.suspended} suspended`}
        />
        <Tile
          label="Finished onboarding"
          value={metrics.onboarding_rate == null ? "—" : `${metrics.onboarding_rate}%`}
          note="Owners with at least one active hostel"
        />
        <Tile
          label="Active in the last 30 days"
          value={String(metrics.active_last_30_days)}
          note="Hostels that recorded anything"
        />
        <Tile label="Beds" value={String(metrics.beds)} note={`${occupancy}% occupied`} />
        <Tile label="Occupied beds" value={String(metrics.occupied_beds)} />
        <Tile label="Residents" value={String(metrics.residents)} note="Active or on notice" />
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <section aria-labelledby="signups-heading" className="space-y-3">
          <h2 id="signups-heading" className="text-base font-semibold text-slate-900">
            Sign-ups by week
          </h2>
          {metrics.signups_by_week.length === 0 ? (
            <p className="text-sm text-slate-600">No sign-ups in the last 12 weeks.</p>
          ) : (
            <Table caption="Owner sign-ups by week">
              <THead>
                <tr>
                  <Th>Week of</Th>
                  <Th className="text-right">Sign-ups</Th>
                </tr>
              </THead>
              <TBody>
                {metrics.signups_by_week.map((row) => (
                  <Tr key={row.week}>
                    <Td>{week.format(new Date(row.week))}</Td>
                    <Td className="text-right tabular-nums">{row.count}</Td>
                  </Tr>
                ))}
              </TBody>
            </Table>
          )}
        </section>

        <section aria-labelledby="money-heading" className="space-y-3">
          <h2 id="money-heading" className="text-base font-semibold text-slate-900">
            Billing by hostels, all together
          </h2>
          <Table caption="Invoices and payments recorded across all hostels">
            <THead>
              <tr>
                <Th>Month</Th>
                <Th className="text-right">Invoices</Th>
                <Th className="text-right">Invoiced</Th>
                <Th className="text-right">Payments</Th>
                <Th className="text-right">Collected</Th>
              </tr>
            </THead>
            <TBody>
              {metrics.money_by_month.map((row) => (
                <Tr key={row.month}>
                  <Td>{formatMonth(row.month, { short: true })}</Td>
                  <Td className="text-right tabular-nums">{row.invoices}</Td>
                  <Td className="text-right tabular-nums">{formatPaise(row.invoiced)}</Td>
                  <Td className="text-right tabular-nums">{row.payments}</Td>
                  <Td className="text-right tabular-nums">{formatPaise(row.collected)}</Td>
                </Tr>
              ))}
            </TBody>
          </Table>
          <p className="text-xs text-slate-500">
            Money hostels bill their residents, not revenue for Hostel ERP. Subscription revenue is
            above.
          </p>
        </section>
      </div>
    </div>
  );
}
