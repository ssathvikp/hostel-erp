import Link from "next/link";

import { Badge, Table, TBody, Td, Th, THead, Tr } from "@/components/ui";

import {
  COMPLAINT_STATUS_LABELS,
  COMPLAINT_STATUS_TONES,
  PRIORITY_LABELS,
  PRIORITY_TONES,
  TARGET_LABELS,
  TARGET_TONES,
} from "../options";
import type { ComplaintRow } from "../queries";

const raised = new Intl.DateTimeFormat("en-IN", {
  dateStyle: "medium",
  timeStyle: "short",
  timeZone: "Asia/Kolkata",
});

export function ComplaintStatusBadge({ status }: { status: ComplaintRow["status"] }) {
  return <Badge tone={COMPLAINT_STATUS_TONES[status]}>{COMPLAINT_STATUS_LABELS[status]}</Badge>;
}

export function PriorityBadge({ priority }: { priority: ComplaintRow["priority"] }) {
  return <Badge tone={PRIORITY_TONES[priority]}>{PRIORITY_LABELS[priority]}</Badge>;
}

export function TargetBadge({ state }: { state: ComplaintRow["targetState"] }) {
  if (state === "done") return null;
  return <Badge tone={TARGET_TONES[state]}>{TARGET_LABELS[state]}</Badge>;
}

/**
 * Complaints in a table (E15-T2), used by the complaint list and by the room
 * and resident pages. `compact` drops the columns those pages already imply.
 */
export function ComplaintTable({
  rows,
  caption,
  compact = false,
}: {
  rows: readonly ComplaintRow[];
  caption: string;
  compact?: boolean;
}) {
  return (
    <Table caption={caption}>
      <THead>
        <tr>
          <Th>#</Th>
          <Th>Complaint</Th>
          {!compact && <Th>Where</Th>}
          <Th>Priority</Th>
          <Th>Status</Th>
          <Th>Target</Th>
          <Th>Worker</Th>
          {!compact && <Th>Raised</Th>}
        </tr>
      </THead>
      <TBody>
        {rows.map((row) => (
          <Tr key={row.id}>
            <Td className="text-slate-500 tabular-nums">{row.number}</Td>
            <Td className="whitespace-normal">
              <Link
                href={`/complaints/${row.id}`}
                className="font-medium text-brand-700 hover:underline"
              >
                {row.title}
              </Link>
              <span className="block text-xs text-slate-500">
                {row.categoryName}
                {row.kind === "scheduled" && " · Scheduled"}
                {row.residentName && ` · ${row.residentName}`}
              </span>
            </Td>
            {!compact && <Td>{row.where}</Td>}
            <Td>
              <PriorityBadge priority={row.priority} />
            </Td>
            <Td>
              <ComplaintStatusBadge status={row.status} />
            </Td>
            <Td>
              <TargetBadge state={row.targetState} />
            </Td>
            <Td>
              {row.workerName ?? (
                <span className={row.needsWorker ? "font-medium text-red-700" : "text-slate-500"}>
                  {row.needsWorker ? "Needs a worker" : "—"}
                </span>
              )}
            </Td>
            {!compact && (
              <Td className="text-slate-600">{raised.format(new Date(row.createdAt))}</Td>
            )}
          </Tr>
        ))}
      </TBody>
    </Table>
  );
}
