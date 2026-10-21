import Link from "next/link";

import { buttonClass } from "@/components/ui";

import { complaintNumber } from "../options";
import type { ComplaintRow } from "../queries";
import { StatusBadge, TargetBadge } from "./ComplaintBadges";

/** Open complaints on a room or resident page (ClickUp EP-15 T2). */
export function OpenComplaints({
  rows,
  raiseHref,
  caption,
}: {
  rows: readonly ComplaintRow[];
  raiseHref: string;
  caption: string;
}) {
  return (
    <div className="space-y-3">
      {rows.length === 0 ? (
        <p className="text-sm text-slate-600">No open complaints.</p>
      ) : (
        <ul aria-label={caption} className="divide-y divide-slate-200 text-sm">
          {rows.map((row) => (
            <li key={row.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
              <span className="min-w-0">
                <Link
                  href={`/complaints/${row.id}`}
                  className="font-medium text-brand-700 hover:underline"
                >
                  {row.title}
                </Link>
                <span className="block text-xs text-slate-500">
                  {complaintNumber(row.number)} · {row.categoryName} · {row.where}
                  {row.workerName && ` · ${row.workerName}`}
                </span>
              </span>
              <span className="flex gap-1">
                <StatusBadge status={row.status} />
                <TargetBadge complaint={row} />
              </span>
            </li>
          ))}
        </ul>
      )}
      <Link href={raiseHref} className={buttonClass({ variant: "secondary", size: "sm" })}>
        Raise complaint
      </Link>
    </div>
  );
}
