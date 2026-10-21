import type { Metadata } from "next";
import Link from "next/link";
import type { ReactNode } from "react";

import { PageHeader } from "@/components/shell/PageHeader";
import { Button, buttonClass, Table, TBody, Td, Th, THead, Tr } from "@/components/ui";
import { reportPeriod } from "@/features/fees/reports";
import { requireActiveHostel } from "@/lib/hostels/active";
import { formatPaise } from "@/lib/money";
import { createClient } from "@/lib/supabase/server";
import { todayIst } from "@/lib/validation";

export const metadata: Metadata = { title: "Complaint reports" };

interface Report {
  total: number;
  reported: number;
  scheduled: number;
  scheduled_overdue: number;
  open: number;
  avg_response_minutes: number | null;
  avg_resolve_minutes: number | null;
  by_category: {
    name: string;
    count: number;
    avg_response_minutes: number | null;
    avg_resolve_minutes: number | null;
  }[];
  by_room: { room_number: string; floor: number; count: number }[];
  by_floor: { floor: number; count: number }[];
  repeats: { room_number: string; category: string; count: number }[];
  workers: {
    name: string;
    kind: string;
    jobs: number;
    done: number;
    avg_resolve_minutes: number | null;
    declines: number;
  }[];
  costs: { hostel: number; resident: number; by_category: { name: string; amount: number }[] };
}

/** "3 h 20 min", "2 days 4 h". */
function duration(minutes: number | null): string {
  if (minutes === null || minutes === undefined) return "—";
  if (minutes < 60) return `${Math.round(minutes)} min`;
  if (minutes < 60 * 24) {
    const hours = Math.floor(minutes / 60);
    const rest = Math.round(minutes % 60);
    return rest ? `${hours} h ${rest} min` : `${hours} h`;
  }
  const days = Math.floor(minutes / (60 * 24));
  const hours = Math.round((minutes % (60 * 24)) / 60);
  return `${days} ${days === 1 ? "day" : "days"}${hours ? ` ${hours} h` : ""}`;
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="min-w-0 space-y-3 rounded-lg border border-slate-200 bg-white p-5 shadow-xs sm:p-6">
      <h2 className="text-lg font-semibold text-slate-900">{title}</h2>
      {children}
    </section>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-slate-200 bg-white p-4">
      <p className="text-sm text-slate-600">{label}</p>
      <p className="mt-1 text-xl font-semibold text-slate-900 tabular-nums">{value}</p>
    </div>
  );
}

/**
 * Complaint reports (ClickUp EP-15 T11): volume by category, room and floor,
 * response and fix times, rooms with repeat problems, how each worker does,
 * and what repairs cost. Computed in the database.
 */
export default async function ComplaintReportsPage({
  searchParams,
}: {
  searchParams: Promise<{ from?: string; to?: string }>;
}) {
  const { hostel } = await requireActiveHostel();
  const params = await searchParams;
  const today = todayIst();
  const { from, to } = reportPeriod({ from: params.from, to: params.to }, today);
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("complaint_report", {
    p_hostel_id: hostel.id,
    p_from: from,
    p_to: to,
  });
  if (error) throw error;
  const report = data as unknown as Report;

  return (
    <div className="max-w-5xl space-y-6">
      <Link href="/complaints" className="text-sm font-medium text-brand-700 hover:underline">
        ← All complaints
      </Link>
      <PageHeader
        title="Complaint reports"
        description="Complaints raised in the dates chosen."
        actions={
          <a
            href={`/complaints/reports/export?${new URLSearchParams({ from, to })}`}
            className={buttonClass({ variant: "secondary" })}
            download
          >
            Download CSV
          </a>
        }
      />
      <form
        method="get"
        aria-label="Report period"
        className="grid gap-3 rounded-lg border border-slate-200 bg-white p-4 sm:grid-cols-3 sm:items-end"
      >
        <label className="text-sm font-medium text-slate-700">
          From
          <input
            type="date"
            name="from"
            defaultValue={from}
            max={today}
            className="mt-1 block w-full rounded-md border border-slate-300 px-3 py-2"
          />
        </label>
        <label className="text-sm font-medium text-slate-700">
          To
          <input
            type="date"
            name="to"
            defaultValue={to}
            max={today}
            className="mt-1 block w-full rounded-md border border-slate-300 px-3 py-2"
          />
        </label>
        <Button type="submit">Show</Button>
      </form>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Complaints" value={String(report.total)} />
        <Stat label="Still open" value={String(report.open)} />
        <Stat label="Average response" value={duration(report.avg_response_minutes)} />
        <Stat label="Average fix" value={duration(report.avg_resolve_minutes)} />
      </div>
      <p className="text-sm text-slate-600">
        {report.reported} reported, {report.scheduled} scheduled maintenance
        {report.scheduled_overdue > 0 &&
          `, ${report.scheduled_overdue} scheduled jobs open for over a week`}
        .
      </p>

      <Section title="By category">
        <Table caption="Complaints by category">
          <THead>
            <tr>
              <Th>Category</Th>
              <Th className="text-right">Complaints</Th>
              <Th className="text-right">Avg response</Th>
              <Th className="text-right">Avg fix</Th>
            </tr>
          </THead>
          <TBody>
            {report.by_category.map((row) => (
              <Tr key={row.name}>
                <Td>{row.name}</Td>
                <Td className="text-right tabular-nums">{row.count}</Td>
                <Td className="text-right">{duration(row.avg_response_minutes)}</Td>
                <Td className="text-right">{duration(row.avg_resolve_minutes)}</Td>
              </Tr>
            ))}
          </TBody>
        </Table>
      </Section>

      <div className="grid min-w-0 gap-6 lg:grid-cols-2">
        <Section title="Rooms with repeat problems">
          {report.repeats.length === 0 ? (
            <p className="text-sm text-slate-600">No room had the same problem twice.</p>
          ) : (
            <Table caption="Repeat problems">
              <THead>
                <tr>
                  <Th>Room</Th>
                  <Th>Category</Th>
                  <Th className="text-right">Times</Th>
                </tr>
              </THead>
              <TBody>
                {report.repeats.map((row) => (
                  <Tr key={`${row.room_number}-${row.category}`}>
                    <Td>{row.room_number}</Td>
                    <Td>{row.category}</Td>
                    <Td className="text-right tabular-nums">{row.count}</Td>
                  </Tr>
                ))}
              </TBody>
            </Table>
          )}
        </Section>
        <Section title="By floor">
          <Table caption="Complaints by floor">
            <THead>
              <tr>
                <Th>Floor</Th>
                <Th className="text-right">Complaints</Th>
              </tr>
            </THead>
            <TBody>
              {report.by_floor.map((row) => (
                <Tr key={row.floor}>
                  <Td>{row.floor}</Td>
                  <Td className="text-right tabular-nums">{row.count}</Td>
                </Tr>
              ))}
            </TBody>
          </Table>
        </Section>
      </div>

      <Section title="Workers">
        <Table caption="Worker performance">
          <THead>
            <tr>
              <Th>Worker</Th>
              <Th className="text-right">Jobs</Th>
              <Th className="text-right">Done</Th>
              <Th className="text-right">Avg fix</Th>
              <Th className="text-right">Declined</Th>
            </tr>
          </THead>
          <TBody>
            {report.workers.map((row) => (
              <Tr key={row.name}>
                <Td>
                  {row.name}
                  <span className="block text-xs text-slate-500">
                    {row.kind === "vendor" ? "Vendor" : "On-site"}
                  </span>
                </Td>
                <Td className="text-right tabular-nums">{row.jobs}</Td>
                <Td className="text-right tabular-nums">{row.done}</Td>
                <Td className="text-right">{duration(row.avg_resolve_minutes)}</Td>
                <Td className="text-right tabular-nums">{row.declines}</Td>
              </Tr>
            ))}
          </TBody>
        </Table>
      </Section>

      <Section title="Repair costs">
        <p className="text-sm text-slate-700">
          {formatPaise(report.costs.hostel)} paid by the hostel,{" "}
          {formatPaise(report.costs.resident)} charged to residents.
        </p>
        {report.costs.by_category.length > 0 && (
          <Table caption="Repair costs by category">
            <THead>
              <tr>
                <Th>Category</Th>
                <Th className="text-right">Spent</Th>
              </tr>
            </THead>
            <TBody>
              {report.costs.by_category.map((row) => (
                <Tr key={row.name}>
                  <Td>{row.name}</Td>
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
