import Link from "next/link";
import type { ReactNode } from "react";

import { Badge } from "@/components/ui";
import { ALLOCATION_EVENT_LABELS, ALLOCATION_EVENT_TONES } from "@/features/allocations/options";
import { PAYMENT_MODE_LABELS } from "@/features/fees/options";
import { daysBetween, formatPaise } from "@/lib/money";

import type { ActivityItem, OverdueResident } from "../queries";

const relative = new Intl.RelativeTimeFormat("en-IN", { numeric: "auto" });

/** "5 minutes ago", "yesterday", "3 days ago". */
export function timeAgo(at: string, now: Date = new Date()): string {
  const seconds = Math.round((new Date(at).getTime() - now.getTime()) / 1000);
  const steps: [Intl.RelativeTimeFormatUnit, number][] = [
    ["year", 31_536_000],
    ["month", 2_592_000],
    ["week", 604_800],
    ["day", 86_400],
    ["hour", 3_600],
    ["minute", 60],
  ];
  for (const [unit, size] of steps) {
    if (Math.abs(seconds) >= size) return relative.format(Math.round(seconds / size), unit);
  }
  return "just now";
}

export function Panel({
  title,
  id,
  action,
  children,
}: {
  title: string;
  id: string;
  action?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section
      aria-labelledby={id}
      className="rounded-lg border border-slate-200 bg-white p-5 shadow-xs"
    >
      <div className="mb-3 flex items-center justify-between gap-3">
        <h2 id={id} className="text-base font-semibold text-slate-900">
          {title}
        </h2>
        {action}
      </div>
      {children}
    </section>
  );
}

/** Latest allocations, moves and payments (E8-T3). */
export function ActivityPanel({ items, now }: { items: readonly ActivityItem[]; now: Date }) {
  return (
    <Panel title="Recent activity" id="activity-heading">
      {items.length === 0 ? (
        <p className="text-sm text-slate-600">
          Nothing yet. Allocations, moves and payments appear here as they are recorded.
        </p>
      ) : (
        <ul className="divide-y divide-slate-100">
          {items.map((item) => (
            <li key={item.id} className="flex items-start justify-between gap-3 py-2.5 text-sm">
              <div className="min-w-0">
                {item.kind === "allocation" ? (
                  <>
                    <Badge tone={ALLOCATION_EVENT_TONES[item.action]}>
                      {ALLOCATION_EVENT_LABELS[item.action]}
                    </Badge>{" "}
                    <Link
                      href={`/residents/${item.residentId}`}
                      className="font-medium text-brand-700 hover:underline"
                    >
                      {item.residentName}
                    </Link>{" "}
                    <span className="text-slate-600">· bed {item.bedLabel}</span>
                  </>
                ) : (
                  <>
                    <Badge tone="success">Payment</Badge>{" "}
                    <Link
                      href={`/fees/${item.invoiceId}`}
                      className="font-medium text-brand-700 hover:underline"
                    >
                      {formatPaise(item.amount)} from {item.residentName}
                    </Link>{" "}
                    <span className="text-slate-600">· {PAYMENT_MODE_LABELS[item.mode]}</span>
                  </>
                )}
              </div>
              <time dateTime={item.at} className="shrink-0 text-xs text-slate-500">
                {timeAgo(item.at, now)}
              </time>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}

/** Who owes money past its due date, and for how long (E8-T3). */
const reminded = new Intl.DateTimeFormat("en-IN", {
  day: "numeric",
  month: "short",
  timeZone: "Asia/Kolkata",
});

export function OverduePanel({
  residents,
  total,
  today,
}: {
  residents: readonly OverdueResident[];
  total: number;
  today: string;
}) {
  return (
    <Panel
      title="Overdue fees"
      id="overdue-heading"
      action={
        total > 0 ? (
          <span className="flex gap-4">
            <Link
              href="/fees/reminders"
              className="text-sm font-medium text-brand-700 hover:underline"
            >
              Send reminders
            </Link>
            <Link
              href="/fees?status=overdue"
              className="text-sm font-medium text-brand-700 hover:underline"
            >
              View all {total}
            </Link>
          </span>
        ) : undefined
      }
    >
      {residents.length === 0 ? (
        <p className="text-sm text-slate-600">No one is overdue. Every past-due invoice is paid.</p>
      ) : (
        <ul className="divide-y divide-slate-100">
          {residents.map((resident) => {
            const late = daysBetween(resident.oldestDueDate, today);
            return (
              <li
                key={resident.residentId}
                className="flex items-center justify-between gap-3 py-2.5 text-sm"
              >
                <div className="min-w-0">
                  <Link
                    href={`/residents/${resident.residentId}`}
                    className="font-medium text-brand-700 hover:underline"
                  >
                    {resident.name}
                  </Link>
                  {resident.phone && (
                    <a
                      href={`tel:+91${resident.phone}`}
                      className="block text-xs text-slate-500 hover:underline"
                    >
                      {resident.phone}
                    </a>
                  )}
                </div>
                <div className="text-right">
                  <p className="font-semibold text-slate-900 tabular-nums">
                    {formatPaise(resident.overdue)}
                  </p>
                  <p className="text-xs text-red-700">
                    {late} {late === 1 ? "day" : "days"} overdue
                  </p>
                  <p className="text-xs text-slate-500">
                    {resident.lastRemindedAt
                      ? `Reminded ${reminded.format(new Date(resident.lastRemindedAt))}`
                      : "Not reminded yet"}
                  </p>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </Panel>
  );
}
