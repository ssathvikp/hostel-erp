import type { Metadata } from "next";
import Link from "next/link";

import { PageHeader } from "@/components/shell/PageHeader";
import { Alert, buttonClass, EmptyState, Table, TBody, Td, Th, THead, Tr } from "@/components/ui";
import { WORKER_KIND_LABELS } from "@/features/complaints/options";
import { getComplaintReport } from "@/features/complaints/queries";
import { RangeFilter } from "@/features/dashboard/components/RangeFilter";
import { parseRange } from "@/features/dashboard/range";
import { floorLabel } from "@/features/rooms/options";
import { requireActiveHostel } from "@/lib/hostels/active";
import { formatMonth, formatPaise } from "@/lib/money";
import { createClient } from "@/lib/supabase/server";
import { todayIst } from "@/lib/validation";

export const metadata: Metadata = { title: "Complaint reports" };

function Tile({ label, value, note }: { label: string; value: string; note?: string }) {
  return (
    <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-xs">
      <p className="text-sm text-slate-500">{label}</p>
      <p className="mt-1 text-xl font-semibold text-slate-900 tabular-nums">{value}</p>
      {note && <p className="text-xs text-slate-500">{note}</p>}
    </div>
  );
}

/** Hours as "3.5 h" or "2.1 days"; a dash when there is nothing to average. */
function duration(hours: number | null): string {
  if (hours == null) return "—";
  return hours < 48 ? `${hours} h` : `${(hours / 24).toFixed(1)} days`;
}

/**
 * Complaint reports (E15-T11): what goes wrong and where, rooms with the
 * same problem again, how each worker does, and what repairs cost.
 */
export default async function ComplaintReportsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { hostel } = await requireActiveHostel();
  const today = todayIst();
  const range = parseRange(await searchParams, today);
  const supabase = await createClient();
  const report = await getComplaintReport(supabase, hostel.id, range.from, range.to);
  const exportQuery = new URLSearchParams({ kind: "complaints", from: range.from, to: range.to });

  return (
    <div className="space-y-8">
      <div>
        <Link href="/reports" className="text-sm font-medium text-brand-700 hover:underline">
          ← Collection reports
        </Link>
        <div className="mt-2">
          <PageHeader
            title="Complaint reports"
            description="What breaks, where, how fast it is fixed and what it costs."
            actions={
              <Link
                href={`/reports/export?${exportQuery}`}
                className={buttonClass({ variant: "secondary" })}
                prefetch={false}
              >
                Download complaints (CSV)
              </Link>
            }
          />
        </div>
      </div>

      <RangeFilter key={`${range.from}:${range.to}`} range={range} today={today} />
      {range.error && <Alert tone="error">{range.error} Showing this month instead.</Alert>}

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Tile
          label="Complaints raised"
          value={String(report.total)}
          note={`${report.open} still open`}
        />
        <Tile label="Past their target" value={String(report.overdue)} />
        <Tile label="Average response" value={duration(report.avgResponseHours)} />
        <Tile label="Average time to fix" value={duration(report.avgResolutionHours)} />
      </div>

      {report.total === 0 && report.scheduled.total === 0 ? (
        <EmptyState title="No complaints in this range" />
      ) : (
        <>
          <section aria-labelledby="category-heading" className="space-y-3">
            <h2 id="category-heading" className="text-base font-semibold text-slate-900">
              By category
            </h2>
            <Table caption="Complaints by category">
              <THead>
                <tr>
                  <Th>Category</Th>
                  <Th className="text-right">Complaints</Th>
                  <Th className="text-right">Open</Th>
                  <Th className="text-right">Average response</Th>
                  <Th className="text-right">Average fix</Th>
                </tr>
              </THead>
              <TBody>
                {report.byCategory.map((row) => (
                  <Tr key={row.category}>
                    <Td>{row.category}</Td>
                    <Td className="text-right tabular-nums">{row.count}</Td>
                    <Td className="text-right tabular-nums">{row.open}</Td>
                    <Td className="text-right tabular-nums">{duration(row.avg_response_hours)}</Td>
                    <Td className="text-right tabular-nums">
                      {duration(row.avg_resolution_hours)}
                    </Td>
                  </Tr>
                ))}
              </TBody>
            </Table>
          </section>

          <section aria-labelledby="repeat-heading" className="space-y-3">
            <h2 id="repeat-heading" className="text-base font-semibold text-slate-900">
              Same problem again
            </h2>
            {report.repeatRooms.length === 0 ? (
              <p className="text-sm text-slate-600">No room had the same kind of problem twice.</p>
            ) : (
              <>
                <p className="text-sm text-slate-600">
                  Rooms with more than one complaint of the same kind. Worth replacing rather than
                  repairing again.
                </p>
                <Table caption="Rooms with repeat complaints">
                  <THead>
                    <tr>
                      <Th>Room</Th>
                      <Th>Category</Th>
                      <Th className="text-right">Complaints</Th>
                    </tr>
                  </THead>
                  <TBody>
                    {report.repeatRooms.map((row) => (
                      <Tr key={`${row.room_id}-${row.category}`}>
                        <Td>
                          <Link
                            href={`/complaints?room=${row.room_id}&status=all`}
                            className="font-medium text-brand-700 hover:underline"
                          >
                            Room {row.room_number}
                          </Link>
                        </Td>
                        <Td>{row.category}</Td>
                        <Td className="text-right tabular-nums">{row.count}</Td>
                      </Tr>
                    ))}
                  </TBody>
                </Table>
              </>
            )}
          </section>

          <div className="grid gap-6 lg:grid-cols-2">
            <section aria-labelledby="rooms-heading" className="space-y-3">
              <h2 id="rooms-heading" className="text-base font-semibold text-slate-900">
                Rooms with the most complaints
              </h2>
              <Table caption="Complaints by room">
                <THead>
                  <tr>
                    <Th>Room</Th>
                    <Th className="text-right">Complaints</Th>
                  </tr>
                </THead>
                <TBody>
                  {report.byRoom.map((row) => (
                    <Tr key={row.room_id}>
                      <Td>Room {row.room_number}</Td>
                      <Td className="text-right tabular-nums">{row.count}</Td>
                    </Tr>
                  ))}
                </TBody>
              </Table>
            </section>
            <section aria-labelledby="floors-heading" className="space-y-3">
              <h2 id="floors-heading" className="text-base font-semibold text-slate-900">
                By floor
              </h2>
              <Table caption="Complaints by floor">
                <THead>
                  <tr>
                    <Th>Floor</Th>
                    <Th className="text-right">Complaints</Th>
                  </tr>
                </THead>
                <TBody>
                  {report.byFloor.map((row) => (
                    <Tr key={row.floor}>
                      <Td>{floorLabel(row.floor)}</Td>
                      <Td className="text-right tabular-nums">{row.count}</Td>
                    </Tr>
                  ))}
                </TBody>
              </Table>
            </section>
          </div>

          <section aria-labelledby="workers-heading" className="space-y-3">
            <h2 id="workers-heading" className="text-base font-semibold text-slate-900">
              Workers
            </h2>
            {report.workers.length === 0 ? (
              <p className="text-sm text-slate-600">No workers yet.</p>
            ) : (
              <Table caption="Worker performance">
                <THead>
                  <tr>
                    <Th>Worker</Th>
                    <Th className="text-right">Jobs done</Th>
                    <Th className="text-right">Open</Th>
                    <Th className="text-right">Average fix</Th>
                    <Th className="text-right">Declined</Th>
                  </tr>
                </THead>
                <TBody>
                  {report.workers.map((row) => (
                    <Tr key={row.name}>
                      <Td>
                        {row.name}
                        <span className="block text-xs text-slate-500">
                          {WORKER_KIND_LABELS[row.kind]}
                        </span>
                      </Td>
                      <Td className="text-right tabular-nums">{row.jobs_done}</Td>
                      <Td className="text-right tabular-nums">{row.open}</Td>
                      <Td className="text-right tabular-nums">
                        {duration(row.avg_resolution_hours)}
                      </Td>
                      <Td className="text-right tabular-nums">{row.declines}</Td>
                    </Tr>
                  ))}
                </TBody>
              </Table>
            )}
          </section>

          <section aria-labelledby="spend-heading" className="space-y-3">
            <h2 id="spend-heading" className="text-base font-semibold text-slate-900">
              Maintenance spend
            </h2>
            <div className="grid gap-3 sm:grid-cols-3">
              <Tile label="Repair costs" value={formatPaise(report.spend.total)} />
              <Tile
                label="Charged to residents"
                value={formatPaise(report.spend.chargedToResidents)}
              />
              <Tile label="Paid to workers" value={formatPaise(report.spend.paidToWorkers)} />
            </div>
            {report.spend.byCategory.length > 0 && (
              <div className="grid gap-4 lg:grid-cols-2">
                <Table caption="Spend by category">
                  <THead>
                    <tr>
                      <Th>Category</Th>
                      <Th className="text-right">Amount</Th>
                    </tr>
                  </THead>
                  <TBody>
                    {report.spend.byCategory.map((row) => (
                      <Tr key={row.category}>
                        <Td>{row.category}</Td>
                        <Td className="text-right tabular-nums">{formatPaise(row.amount)}</Td>
                      </Tr>
                    ))}
                  </TBody>
                </Table>
                <Table caption="Spend by month">
                  <THead>
                    <tr>
                      <Th>Month</Th>
                      <Th className="text-right">Amount</Th>
                    </tr>
                  </THead>
                  <TBody>
                    {report.spend.byMonth.map((row) => (
                      <Tr key={row.month}>
                        <Td>{formatMonth(row.month)}</Td>
                        <Td className="text-right tabular-nums">{formatPaise(row.amount)}</Td>
                      </Tr>
                    ))}
                  </TBody>
                </Table>
              </div>
            )}
          </section>

          <section aria-labelledby="scheduled-heading" className="space-y-3">
            <h2 id="scheduled-heading" className="text-base font-semibold text-slate-900">
              Preventive maintenance
            </h2>
            <div className="grid gap-3 sm:grid-cols-3">
              <Tile label="Scheduled jobs" value={String(report.scheduled.total)} />
              <Tile label="Done" value={String(report.scheduled.done)} />
              <Tile label="Overdue" value={String(report.scheduled.overdue)} />
            </div>
          </section>
        </>
      )}
    </div>
  );
}
