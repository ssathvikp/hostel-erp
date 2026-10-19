import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";

import { PageHeader } from "@/components/shell/PageHeader";
import { Button, buttonClass, EmptyState, Table, TBody, Td, Th, THead, Tr } from "@/components/ui";
import { DUE_STATUS_LABELS, invoiceLabel, PAYMENT_MODE_LABELS } from "@/features/fees/options";
import {
  getDiscounts,
  getFeeRegister,
  getMoneyIn,
  getOpenDues,
} from "@/features/fees/report-queries";
import { AGE_BUCKETS, ageDues, reportPeriod, summariseCollections } from "@/features/fees/reports";
import { requireActiveHostel } from "@/lib/hostels/active";
import { formatMonth, formatPaise } from "@/lib/money";
import { createClient } from "@/lib/supabase/server";
import { todayIst } from "@/lib/validation";
import type { InvoiceDueStatus, InvoiceKind, PaymentMode } from "@/types";

export const metadata: Metadata = { title: "Fee reports" };

const day = new Intl.DateTimeFormat("en-IN", { dateStyle: "medium", timeZone: "UTC" });

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

function single(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

function modeLabel(mode: string): string {
  return PAYMENT_MODE_LABELS[mode as PaymentMode] ?? mode;
}

function Section({
  id,
  title,
  description,
  download,
  children,
}: {
  id: string;
  title: string;
  description: string;
  download?: { href: string; label: string };
  children: React.ReactNode;
}) {
  return (
    <section
      aria-labelledby={`${id}-heading`}
      className="min-w-0 space-y-4 rounded-lg border border-slate-200 bg-white p-5 shadow-xs sm:p-6"
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 id={`${id}-heading`} className="text-lg font-semibold text-slate-900">
            {title}
          </h2>
          <p className="mt-1 text-sm text-slate-600">{description}</p>
        </div>
        {download && (
          <a href={download.href} className={buttonClass({ variant: "secondary" })} download>
            {download.label}
          </a>
        )}
      </div>
      {children}
    </section>
  );
}

/**
 * Collection reports for the owner (ClickUp E13-T12): money in by day, mode
 * and collector; dues by age; the monthly fee register; discounts given.
 * Each has a CSV download with the same numbers.
 */
export default async function FeeReportsPage({ searchParams }: { searchParams: SearchParams }) {
  const { user, hostel } = await requireActiveHostel();
  if (user.role !== "owner") redirect("/fees");

  const params = await searchParams;
  const today = todayIst();
  const { from, to, month } = reportPeriod(
    { from: single(params.from), to: single(params.to), month: single(params.month) },
    today,
  );

  const supabase = await createClient();
  const [moneyIn, dues, register, discounts] = await Promise.all([
    getMoneyIn(supabase, hostel.id, from, to),
    getOpenDues(supabase, hostel.id),
    getFeeRegister(supabase, hostel.id, month),
    getDiscounts(supabase, hostel.id, month),
  ]);
  const collections = summariseCollections(moneyIn);
  const modes = collections.byMode.map((row) => row.key);
  const ageing = ageDues(dues, today);
  const owed = dues.reduce((sum, due) => sum + due.balance, 0);
  const registerTotals = register.reduce(
    (sum, row) => ({
      amount: sum.amount + row.amount,
      paid: sum.paid + row.paid,
      balance: sum.balance + row.balance,
    }),
    { amount: 0, paid: 0, balance: 0 },
  );
  const discountTotal = discounts.reduce((sum, row) => sum + row.amount, 0);
  const csv = (report: string, extra: Record<string, string>) =>
    `/fees/reports/export?${new URLSearchParams({ report, ...extra })}`;
  const monthValue = month.slice(0, 7);

  return (
    <div className="max-w-5xl space-y-6">
      <div>
        <Link href="/fees" className="text-sm font-medium text-brand-700 hover:underline">
          ← All fees
        </Link>
        <div className="mt-2">
          <PageHeader
            title="Fee reports"
            description="What came in, what is still owed, and the month's fee register. Amounts in downloads are in rupees."
          />
        </div>
      </div>

      <form
        method="get"
        aria-label="Report period"
        className="grid gap-3 rounded-lg border border-slate-200 bg-white p-4 sm:grid-cols-4 sm:items-end"
      >
        <label className="text-sm font-medium text-slate-700">
          Money in from
          <input
            type="date"
            name="from"
            defaultValue={from}
            max={today}
            className="mt-1 block w-full rounded-md border border-slate-300 px-3 py-2"
          />
        </label>
        <label className="text-sm font-medium text-slate-700">
          to
          <input
            type="date"
            name="to"
            defaultValue={to}
            max={today}
            className="mt-1 block w-full rounded-md border border-slate-300 px-3 py-2"
          />
        </label>
        <label className="text-sm font-medium text-slate-700">
          Billing month
          <input
            type="month"
            name="month"
            defaultValue={monthValue}
            className="mt-1 block w-full rounded-md border border-slate-300 px-3 py-2"
          />
        </label>
        <Button type="submit">Show</Button>
      </form>

      <Section
        id="money-in"
        title="Money in"
        description={`${day.format(new Date(from))} to ${day.format(new Date(to))}: ${formatPaise(collections.total)}. Cheques count once cleared; advances kept as credit are included.`}
        download={{ href: csv("collections", { from, to }), label: "Download CSV" }}
      >
        {moneyIn.length === 0 ? (
          <EmptyState title="Nothing received in these dates" />
        ) : (
          <div className="grid min-w-0 gap-6 lg:grid-cols-2">
            <Table caption="By payment mode">
              <THead>
                <tr>
                  <Th>Mode</Th>
                  <Th className="text-right">Entries</Th>
                  <Th className="text-right">Amount</Th>
                </tr>
              </THead>
              <TBody>
                {collections.byMode.map((row) => (
                  <Tr key={row.key}>
                    <Td>{modeLabel(row.key)}</Td>
                    <Td className="text-right tabular-nums">{row.count}</Td>
                    <Td className="text-right tabular-nums">{formatPaise(row.amount)}</Td>
                  </Tr>
                ))}
              </TBody>
            </Table>
            <Table caption="By who collected it">
              <THead>
                <tr>
                  <Th>Collected by</Th>
                  <Th className="text-right">Entries</Th>
                  <Th className="text-right">Amount</Th>
                </tr>
              </THead>
              <TBody>
                {collections.byCollector.map((row) => (
                  <Tr key={row.key}>
                    <Td>{row.key}</Td>
                    <Td className="text-right tabular-nums">{row.count}</Td>
                    <Td className="text-right tabular-nums">{formatPaise(row.amount)}</Td>
                  </Tr>
                ))}
              </TBody>
            </Table>
            <div className="min-w-0 lg:col-span-2">
              <Table caption="By day">
                <THead>
                  <tr>
                    <Th>Date</Th>
                    {modes.map((mode) => (
                      <Th key={mode} className="text-right">
                        {modeLabel(mode)}
                      </Th>
                    ))}
                    <Th className="text-right">Total</Th>
                  </tr>
                </THead>
                <TBody>
                  {collections.byDay.map((row) => (
                    <Tr key={row.date}>
                      <Td>{day.format(new Date(row.date))}</Td>
                      {modes.map((mode) => (
                        <Td key={mode} className="text-right tabular-nums">
                          {row.byMode[mode] ? formatPaise(row.byMode[mode]) : "–"}
                        </Td>
                      ))}
                      <Td className="text-right font-medium tabular-nums">
                        {formatPaise(row.total)}
                      </Td>
                    </Tr>
                  ))}
                </TBody>
              </Table>
            </div>
          </div>
        )}
      </Section>

      <Section
        id="dues"
        title="Dues by age"
        description={`${formatPaise(owed)} owed across ${dues.length} ${dues.length === 1 ? "invoice" : "invoices"}, by days past the due date. Pending cheques still count as owed.`}
        download={{ href: csv("dues", {}), label: "Download CSV" }}
      >
        <Table caption="Dues by age">
          <THead>
            <tr>
              <Th>Age</Th>
              <Th className="text-right">Invoices</Th>
              <Th className="text-right">Owed</Th>
            </tr>
          </THead>
          <TBody>
            {AGE_BUCKETS.map((bucket) => (
              <Tr key={bucket.key}>
                <Td>{bucket.label}</Td>
                <Td className="text-right tabular-nums">{ageing[bucket.key].count}</Td>
                <Td className="text-right tabular-nums">
                  {formatPaise(ageing[bucket.key].amount)}
                </Td>
              </Tr>
            ))}
          </TBody>
        </Table>
      </Section>

      <Section
        id="register"
        title={`Fee register, ${formatMonth(month)}`}
        description={
          register.length
            ? `${register.length} ${register.length === 1 ? "invoice" : "invoices"}: ${formatPaise(registerTotals.amount)} billed, ${formatPaise(registerTotals.paid)} paid, ${formatPaise(registerTotals.balance)} owed.`
            : "Every invoice for the month, by room."
        }
        download={{ href: csv("register", { month: monthValue }), label: "Download CSV" }}
      >
        {register.length === 0 ? (
          <EmptyState title={`No invoices for ${formatMonth(month)}`} />
        ) : (
          <Table caption={`Fee register, ${formatMonth(month)}`}>
            <THead>
              <tr>
                <Th>Invoice</Th>
                <Th>Resident</Th>
                <Th>Room</Th>
                <Th className="text-right">Billed</Th>
                <Th className="text-right">Paid</Th>
                <Th className="text-right">Owed</Th>
                <Th>Status</Th>
              </tr>
            </THead>
            <TBody>
              {register.map((row) => (
                <Tr key={row.id}>
                  <Td>
                    <Link href={`/fees/${row.id}`} className="text-brand-700 hover:underline">
                      {invoiceLabel({
                        periodMonth: row.periodMonth,
                        kind: row.kind as InvoiceKind,
                      })}
                    </Link>
                    <span className="block font-mono text-xs text-slate-500">
                      {row.invoiceNumber}
                    </span>
                  </Td>
                  <Td>{row.residentName}</Td>
                  <Td>{row.room}</Td>
                  <Td className="text-right tabular-nums">{formatPaise(row.amount)}</Td>
                  <Td className="text-right tabular-nums">{formatPaise(row.paid)}</Td>
                  <Td className="text-right tabular-nums">{formatPaise(row.balance)}</Td>
                  <Td>{DUE_STATUS_LABELS[row.dueStatus as InvoiceDueStatus] ?? row.dueStatus}</Td>
                </Tr>
              ))}
            </TBody>
          </Table>
        )}
      </Section>

      <Section
        id="discounts"
        title={`Discounts, ${formatMonth(month)}`}
        description={
          discounts.length
            ? `${formatPaise(discountTotal)} taken off ${discounts.length} ${discounts.length === 1 ? "invoice line" : "invoice lines"}.`
            : "Discounts and concessions given on the month's invoices."
        }
        download={{ href: csv("discounts", { month: monthValue }), label: "Download CSV" }}
      >
        {discounts.length === 0 ? (
          <EmptyState title={`No discounts in ${formatMonth(month)}`} />
        ) : (
          <Table caption={`Discounts, ${formatMonth(month)}`}>
            <THead>
              <tr>
                <Th>Resident</Th>
                <Th>Discount</Th>
                <Th className="text-right">Amount</Th>
              </tr>
            </THead>
            <TBody>
              {discounts.map((row, index) => (
                <Tr key={`${row.invoiceId}-${index}`}>
                  <Td>
                    <Link
                      href={`/fees/${row.invoiceId}`}
                      className="text-brand-700 hover:underline"
                    >
                      {row.residentName}
                    </Link>
                    <span className="block font-mono text-xs text-slate-500">
                      {row.invoiceNumber}
                    </span>
                  </Td>
                  <Td>{row.description}</Td>
                  <Td className="text-right tabular-nums">{formatPaise(row.amount)}</Td>
                </Tr>
              ))}
            </TBody>
          </Table>
        )}
      </Section>
    </div>
  );
}
