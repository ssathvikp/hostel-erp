import type { Metadata } from "next";
import Link from "next/link";

import { PageHeader } from "@/components/shell/PageHeader";
import {
  Alert,
  Button,
  buttonClass,
  EmptyState,
  Input,
  Table,
  TBody,
  Td,
  Th,
  THead,
  Tr,
} from "@/components/ui";
import { RangeFilter } from "@/features/dashboard/components/RangeFilter";
import { parseRange } from "@/features/dashboard/range";
import { PAYMENT_MODE_LABELS } from "@/features/fees/options";
import {
  AGEING_BUCKETS,
  AGEING_LABELS,
  getCollections,
  getDuesAgeing,
} from "@/features/reports/queries";
import { requireActiveHostel } from "@/lib/hostels/active";
import { formatPaise, shiftMonth } from "@/lib/money";
import { createClient } from "@/lib/supabase/server";
import { todayIst } from "@/lib/validation";

export const metadata: Metadata = { title: "Reports" };

const day = new Intl.DateTimeFormat("en-IN", { dateStyle: "medium", timeZone: "UTC" });
const formatDay = (value: string) => day.format(new Date(value));

function Tile({ label, value, note }: { label: string; value: string; note?: string }) {
  return (
    <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-xs">
      <p className="text-sm text-slate-500">{label}</p>
      <p className="mt-1 text-xl font-semibold text-slate-900 tabular-nums">{value}</p>
      {note && <p className="text-xs text-slate-500">{note}</p>}
    </div>
  );
}

/**
 * Collection reports (E13-T12): money received by mode, collector and day,
 * dues by age, and CSV exports for reconciling and for the accountant.
 */
export default async function ReportsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { hostel } = await requireActiveHostel();
  const today = todayIst();
  const range = parseRange(await searchParams, today);
  const supabase = await createClient();
  const [collections, ageing] = await Promise.all([
    getCollections(supabase, hostel.id, range.from, range.to),
    getDuesAgeing(supabase, hostel.id),
  ]);
  const exportQuery = new URLSearchParams({ kind: "collections", from: range.from, to: range.to });

  return (
    <div className="space-y-8">
      <PageHeader title="Reports" description="What came in, how, and what is still owed." />

      <section aria-labelledby="collections-heading" className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 id="collections-heading" className="text-base font-semibold text-slate-900">
            Collections
          </h2>
          <Link
            href={`/reports/export?${exportQuery}`}
            className={buttonClass({ variant: "secondary", size: "sm" })}
            prefetch={false}
          >
            Download receipts (CSV)
          </Link>
        </div>
        <RangeFilter key={`${range.from}:${range.to}`} range={range} today={today} />
        {range.error && <Alert tone="error">{range.error} Showing this month instead.</Alert>}

        <div className="grid gap-3 sm:grid-cols-3">
          <Tile
            label="Collected"
            value={formatPaise(collections.total)}
            note={`${collections.count} ${collections.count === 1 ? "receipt" : "receipts"}, the same as the dashboard`}
          />
          <Tile
            label="Deposits received"
            value={formatPaise(collections.deposits.amount)}
            note="Held for residents, not counted as collected"
          />
          <Tile label="Range" value={`${formatDay(range.from)} – ${formatDay(range.to)}`} />
        </div>

        {collections.count === 0 ? (
          <EmptyState title="Nothing collected in this range" />
        ) : (
          <>
            <div className="grid gap-4 lg:grid-cols-2">
              <Table caption="By mode">
                <THead>
                  <tr>
                    <Th>Mode</Th>
                    <Th className="text-right">Receipts</Th>
                    <Th className="text-right">Amount</Th>
                  </tr>
                </THead>
                <TBody>
                  {collections.byMode.map((row) => (
                    <Tr key={row.mode}>
                      <Td>{PAYMENT_MODE_LABELS[row.mode]}</Td>
                      <Td className="text-right tabular-nums">{row.count}</Td>
                      <Td className="text-right tabular-nums">{formatPaise(row.amount)}</Td>
                    </Tr>
                  ))}
                </TBody>
              </Table>
              <Table caption="By collector">
                <THead>
                  <tr>
                    <Th>Collected by</Th>
                    <Th className="text-right">Receipts</Th>
                    <Th className="text-right">Amount</Th>
                  </tr>
                </THead>
                <TBody>
                  {collections.byCollector.map((row) => (
                    <Tr key={row.collector ?? "unknown"}>
                      <Td>{row.collector ?? "Unknown"}</Td>
                      <Td className="text-right tabular-nums">{row.count}</Td>
                      <Td className="text-right tabular-nums">{formatPaise(row.amount)}</Td>
                    </Tr>
                  ))}
                </TBody>
              </Table>
            </div>

            <Table caption="By day">
              <THead>
                <tr>
                  <Th>Day</Th>
                  <Th>Mode</Th>
                  <Th>Collected by</Th>
                  <Th className="text-right">Receipts</Th>
                  <Th className="text-right">Amount</Th>
                </tr>
              </THead>
              <TBody>
                {collections.days.map((row) => (
                  <Tr key={`${row.day}-${row.mode}-${row.collector}`}>
                    <Td>{formatDay(row.day)}</Td>
                    <Td>{PAYMENT_MODE_LABELS[row.mode]}</Td>
                    <Td>{row.collector ?? "Unknown"}</Td>
                    <Td className="text-right tabular-nums">{row.count}</Td>
                    <Td className="text-right tabular-nums">{formatPaise(row.amount)}</Td>
                  </Tr>
                ))}
              </TBody>
            </Table>
          </>
        )}
      </section>

      <section aria-labelledby="ageing-heading" className="space-y-4">
        <h2 id="ageing-heading" className="text-base font-semibold text-slate-900">
          Dues by age{" "}
          <span className="font-normal text-slate-500">{formatPaise(ageing.total)} owed today</span>
        </h2>
        <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-5">
          {AGEING_BUCKETS.map((bucket) => (
            <Tile
              key={bucket}
              label={AGEING_LABELS[bucket]}
              value={formatPaise(ageing.buckets[bucket])}
            />
          ))}
        </div>
        {ageing.residents.length === 0 ? (
          <EmptyState title="Nobody owes anything" />
        ) : (
          <Table caption="Dues by resident and age">
            <THead>
              <tr>
                <Th>Resident</Th>
                {AGEING_BUCKETS.map((bucket) => (
                  <Th key={bucket} className="text-right">
                    {AGEING_LABELS[bucket]}
                  </Th>
                ))}
                <Th className="text-right">Total</Th>
              </tr>
            </THead>
            <TBody>
              {ageing.residents.map((row) => (
                <Tr key={row.residentId}>
                  <Td>
                    <Link
                      href={`/residents/${row.residentId}`}
                      className="font-medium text-brand-700 hover:underline"
                    >
                      {row.name}
                    </Link>
                    <span className="block text-xs text-slate-500">{row.phone}</span>
                  </Td>
                  {AGEING_BUCKETS.map((bucket) => (
                    <Td key={bucket} className="text-right tabular-nums">
                      {row[bucket] ? formatPaise(row[bucket]) : "—"}
                    </Td>
                  ))}
                  <Td className="text-right font-medium tabular-nums">{formatPaise(row.total)}</Td>
                </Tr>
              ))}
            </TBody>
          </Table>
        )}
      </section>

      <section
        aria-labelledby="register-heading"
        className="rounded-lg border border-slate-200 bg-white p-5 shadow-xs sm:p-6"
      >
        <h2 id="register-heading" className="text-base font-semibold text-slate-900">
          Monthly fee register
        </h2>
        <p className="mt-1 mb-4 text-sm text-slate-600">
          For your accountant: the month&apos;s invoices with their lines, and every payment, credit
          and deposit movement dated in it, as one CSV file.
        </p>
        <form action="/reports/export" method="get" className="flex flex-wrap items-end gap-4">
          <input type="hidden" name="kind" value="register" />
          <Input
            id="register-month"
            name="month"
            type="month"
            label="Month"
            max={today.slice(0, 7)}
            defaultValue={shiftMonth(today, -1).slice(0, 7)}
            required
            className="w-44"
          />
          <Button type="submit" variant="secondary">
            Download register (CSV)
          </Button>
        </form>
      </section>
    </div>
  );
}
