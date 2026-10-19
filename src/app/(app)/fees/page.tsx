import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";

import { PageHeader } from "@/components/shell/PageHeader";
import { Badge, buttonClass, EmptyState, Table, TBody, Td, Th, THead, Tr } from "@/components/ui";
import { ApplyLateFeesForm } from "@/features/fees/components/ApplyLateFeesForm";
import { FeeFilters } from "@/features/fees/components/FeeFilters";
import { GenerateInvoicesForm } from "@/features/fees/components/GenerateInvoicesForm";
import { PaymentDialog } from "@/features/fees/components/PaymentDialog";
import {
  DUE_STATUS_LABELS,
  DUE_STATUS_ORDER,
  DUE_STATUS_TONES,
  invoiceLabel,
  isDueStatus,
} from "@/features/fees/options";
import { describeLateFeeRule } from "@/features/fees/late-fees";
import {
  FEE_PAGE_SIZE,
  FEE_SORTS,
  getBilledMonths,
  getFeeList,
  getFeeTotals,
  getLateFeeRule,
  type FeeListFilters,
  type FeeSort,
} from "@/features/fees/queries";
import { cn } from "@/lib/cn";
import { requireActiveHostel } from "@/lib/hostels/active";
import { formatMonth, formatPaise } from "@/lib/money";
import { createClient } from "@/lib/supabase/server";
import { todayIst, uuid } from "@/lib/validation";

export const metadata: Metadata = { title: "Fees" };

type SearchParams = Record<string, string | string[] | undefined>;

function single(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

function parseFilters(params: SearchParams): FeeListFilters {
  const status = single(params.status);
  const room = single(params.room);
  const month = single(params.month);
  const sort = single(params.sort);
  const page = Number(single(params.page));
  return {
    status: isDueStatus(status) ? status : null,
    roomId: room && uuid("Room").safeParse(room).success ? room : null,
    month: month && /^\d{4}-(0[1-9]|1[0-2])-01$/.test(month) ? month : null,
    sort: (FEE_SORTS as readonly string[]).includes(sort ?? "") ? (sort as FeeSort) : "outstanding",
    page: Number.isInteger(page) && page > 1 ? page : 1,
  };
}

const day = new Intl.DateTimeFormat("en-IN", { dateStyle: "medium", timeZone: "UTC" });
const formatDay = (value: string) => day.format(new Date(value));

/**
 * The rent register (E7-T6): every issued invoice with what was paid and
 * what is still due, running totals per status, and collection actions.
 */
export default async function FeesPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const { user, hostel } = await requireActiveHostel();
  const params = await searchParams;
  const filters = parseFilters(params);
  const supabase = await createClient();

  const [list, totals, months, lateFeeRule, { data: rooms, error: roomsError }] = await Promise.all(
    [
      getFeeList(supabase, hostel.id, filters),
      getFeeTotals(supabase, hostel.id, filters),
      getBilledMonths(supabase, hostel.id),
      getLateFeeRule(supabase, hostel.id),
      supabase
        .from("room_inventory")
        .select("id, room_number")
        .eq("hostel_id", hostel.id)
        .order("floor")
        .order("room_sort"),
    ],
  );
  if (roomsError) throw roomsError;

  const href = (changes: Record<string, string | null>) => {
    const next = new URLSearchParams();
    for (const [key, value] of Object.entries(params)) {
      const text = single(value);
      if (text) next.set(key, text);
    }
    for (const [key, value] of Object.entries(changes)) {
      if (value) next.set(key, value);
      else next.delete(key);
    }
    return next.size ? `/fees?${next}` : "/fees";
  };

  if (!list) redirect(href({ page: null }));
  const { rows, total } = list;

  const isOwner = user.role === "owner";
  const lastPage = Math.max(1, Math.ceil(total / FEE_PAGE_SIZE));
  const anyInvoices = months.length > 0;
  const filtered = Boolean(filters.status || filters.roomId || filters.month);

  return (
    <>
      <PageHeader
        title="Fees"
        description="Invoices, payments and what is still due."
        actions={
          <div className="flex flex-wrap gap-2">
            <Link href="/fees/reminders" className={buttonClass({ variant: "secondary" })}>
              Send reminders
            </Link>
            <Link href="/fees/electricity" className={buttonClass({ variant: "secondary" })}>
              Electricity
            </Link>
            <Link href="/fees/cheques" className={buttonClass({ variant: "secondary" })}>
              Cheques
            </Link>
            {isOwner && (
              <Link href="/fees/reports" className={buttonClass({ variant: "secondary" })}>
                Reports
              </Link>
            )}
            <Link href="/settings/fees" className={buttonClass({ variant: "secondary" })}>
              Rates
            </Link>
          </div>
        }
      />

      {isOwner && (
        <section
          aria-labelledby="generate-heading"
          className="mb-6 rounded-lg border border-slate-200 bg-white p-5 shadow-xs sm:p-6"
        >
          <h2 id="generate-heading" className="mb-4 text-base font-semibold text-slate-900">
            Generate monthly invoices
          </h2>
          <GenerateInvoicesForm currentMonth={todayIst().slice(0, 7)} />
        </section>
      )}

      {isOwner && lateFeeRule.mode !== "off" && (
        <section
          aria-labelledby="late-fees-heading"
          className="mb-6 rounded-lg border border-slate-200 bg-white p-5 shadow-xs sm:p-6"
        >
          <h2 id="late-fees-heading" className="text-base font-semibold text-slate-900">
            Late fees
          </h2>
          <p className="mt-1 mb-4 text-sm text-slate-600">
            {describeLateFeeRule(lateFeeRule)}{" "}
            <Link href="/settings/fees#late-fees" className="font-medium text-brand-700 underline">
              Change the rule
            </Link>
          </p>
          <ApplyLateFeesForm />
        </section>
      )}

      {!anyInvoices ? (
        <EmptyState
          title="No invoices yet"
          description={
            isOwner
              ? "Set rates in Settings → Fees, allocate beds, then generate invoices for the month."
              : "The hostel owner generates invoices each month. They will appear here."
          }
        />
      ) : (
        <>
          <section
            aria-label="Totals by status"
            className="mb-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-4"
          >
            {DUE_STATUS_ORDER.map((status) => {
              const bucket = totals[status];
              const active = filters.status === status;
              return (
                <Link
                  key={status}
                  href={href({ status: active ? null : status, page: null })}
                  aria-current={active ? "true" : undefined}
                  className={cn(
                    "rounded-lg border bg-white p-4 shadow-xs hover:border-brand-300",
                    active ? "border-brand-600 ring-1 ring-brand-600" : "border-slate-200",
                  )}
                >
                  <div className="flex items-center justify-between">
                    <Badge tone={DUE_STATUS_TONES[status]}>{DUE_STATUS_LABELS[status]}</Badge>
                    <span className="text-xs text-slate-500">
                      {bucket.invoices} {bucket.invoices === 1 ? "invoice" : "invoices"}
                    </span>
                  </div>
                  <p className="mt-3 text-xl font-semibold text-slate-900">
                    {formatPaise(status === "paid" ? bucket.paid : bucket.balance)}
                  </p>
                  <p className="text-xs text-slate-500">
                    {status === "paid" ? "collected" : `still due of ${formatPaise(bucket.amount)}`}
                  </p>
                </Link>
              );
            })}
          </section>

          <FeeFilters
            rooms={(rooms ?? []).map((room) => ({
              value: room.id ?? "",
              label: `Room ${room.room_number}`,
            }))}
            months={months.map((month) => ({ value: month, label: formatMonth(month) }))}
          />

          {rows.length === 0 ? (
            <EmptyState
              title="No invoices match"
              description={filtered ? "Try a different status, month or room." : undefined}
              action={
                filtered ? (
                  <Link href="/fees" className={buttonClass({ variant: "secondary" })}>
                    Clear filters
                  </Link>
                ) : undefined
              }
            />
          ) : (
            <>
              <Table caption="Invoices">
                <THead>
                  <tr>
                    <Th>Resident</Th>
                    <Th>Bed</Th>
                    <Th>Month</Th>
                    <Th className="text-right">Amount</Th>
                    <Th className="text-right">Paid</Th>
                    <Th className="text-right">Balance</Th>
                    <Th>Due</Th>
                    <Th>Status</Th>
                    <Th>
                      <span className="sr-only">Actions</span>
                    </Th>
                  </tr>
                </THead>
                <TBody>
                  {rows.map((row) => (
                    <Tr key={row.id}>
                      <Td>
                        <Link
                          href={`/residents/${row.residentId}`}
                          className="font-medium text-brand-700 hover:underline"
                        >
                          {row.residentName}
                        </Link>
                        {row.residentPhone && (
                          <a
                            href={`tel:+91${row.residentPhone}`}
                            className="block text-xs text-slate-600 hover:underline"
                          >
                            {row.residentPhone}
                          </a>
                        )}
                        {row.residentEmail && (
                          <a
                            href={`mailto:${row.residentEmail}`}
                            className="block text-xs text-slate-500 hover:underline"
                          >
                            {row.residentEmail}
                          </a>
                        )}
                      </Td>
                      <Td>{row.bedLabel ?? row.roomNumber ?? "—"}</Td>
                      <Td>
                        {formatMonth(row.periodMonth, { short: true })}
                        {row.kind === "late_fee" && (
                          <span className="block text-xs text-slate-500">Late fee</span>
                        )}
                        <span className="block font-mono text-xs text-slate-500">
                          {row.invoiceNumber}
                        </span>
                      </Td>
                      <Td className="text-right tabular-nums">{formatPaise(row.amount)}</Td>
                      <Td className="text-right tabular-nums">{formatPaise(row.paid)}</Td>
                      <Td className="text-right font-medium tabular-nums">
                        {formatPaise(row.balance)}
                        {row.pendingCheques > 0 && (
                          <span className="block text-xs font-normal text-slate-500">
                            {formatPaise(row.pendingCheques)} cheque pending
                          </span>
                        )}
                      </Td>
                      <Td>{formatDay(row.dueDate)}</Td>
                      <Td>
                        {row.dueStatus && (
                          <Badge tone={DUE_STATUS_TONES[row.dueStatus]}>
                            {DUE_STATUS_LABELS[row.dueStatus]}
                          </Badge>
                        )}
                      </Td>
                      <Td>
                        <div className="flex justify-end gap-2">
                          {row.balance - row.pendingCheques > 0 && (
                            <PaymentDialog
                              residentName={row.residentName}
                              invoices={[
                                {
                                  id: row.id,
                                  label: invoiceLabel(row),
                                  balance: row.balance - row.pendingCheques,
                                },
                              ]}
                              triggerLabel="Record"
                              size="sm"
                            />
                          )}
                          <Link
                            href={`/fees/${row.id}`}
                            className={buttonClass({ variant: "secondary", size: "sm" })}
                            aria-label={`View invoice for ${row.residentName}, ${invoiceLabel(row)}`}
                          >
                            View
                          </Link>
                        </div>
                      </Td>
                    </Tr>
                  ))}
                </TBody>
              </Table>

              <nav
                aria-label="Pagination"
                className="mt-4 flex items-center justify-between text-sm text-slate-600"
              >
                <span>
                  {total} {total === 1 ? "invoice" : "invoices"}
                </span>
                <div className="flex items-center gap-3">
                  {filters.page > 1 && (
                    <Link
                      href={href({ page: filters.page > 2 ? String(filters.page - 1) : null })}
                      className={buttonClass({ variant: "secondary", size: "sm" })}
                    >
                      Previous
                    </Link>
                  )}
                  <span>
                    Page {filters.page} of {lastPage}
                  </span>
                  {filters.page < lastPage && (
                    <Link
                      href={href({ page: String(filters.page + 1) })}
                      className={buttonClass({ variant: "secondary", size: "sm" })}
                    >
                      Next
                    </Link>
                  )}
                </div>
              </nav>
            </>
          )}
        </>
      )}
    </>
  );
}
