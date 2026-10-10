import Link from "next/link";

import { Badge, Table, TBody, Td, Th, THead, Tr } from "@/components/ui";

import { ALLOCATION_EVENT_LABELS, ALLOCATION_EVENT_TONES } from "../options";
import type { AllocationEvent } from "../queries";

// Calendar dates are stored as YYYY-MM-DD; format them without shifting days.
const day = new Intl.DateTimeFormat("en-IN", { dateStyle: "medium", timeZone: "UTC" });
const moment = new Intl.DateTimeFormat("en-IN", {
  dateStyle: "medium",
  timeStyle: "short",
  timeZone: "Asia/Kolkata",
});

/**
 * The immutable allocation log (E6-T7): who moved where, when, and who
 * recorded it. Shown on the resident profile and the room page.
 */
export function AllocationHistory({
  events,
  show,
  caption,
}: {
  events: AllocationEvent[];
  /** The other side of the move: the bed on a resident page, the resident on a room page. */
  show: "bed" | "resident";
  caption: string;
}) {
  if (events.length === 0) {
    return <p className="text-sm text-slate-600">Nothing recorded yet.</p>;
  }
  return (
    <Table caption={caption}>
      <THead>
        <tr>
          <Th>What</Th>
          <Th>{show === "bed" ? "Bed" : "Resident"}</Th>
          <Th>Effective</Th>
          <Th>Recorded</Th>
        </tr>
      </THead>
      <TBody>
        {events.map((event) => (
          <Tr key={event.id}>
            <Td>
              <Badge tone={ALLOCATION_EVENT_TONES[event.action]}>
                {ALLOCATION_EVENT_LABELS[event.action]}
              </Badge>
            </Td>
            <Td>
              {show === "bed" ? (
                `${event.bedLabel}`
              ) : (
                <Link
                  href={`/residents/${event.residentId}`}
                  className="font-medium text-brand-700 hover:underline"
                >
                  {event.residentName}
                </Link>
              )}
              {show === "resident" && <span className="text-slate-500"> · {event.bedLabel}</span>}
            </Td>
            <Td>{day.format(new Date(event.effectiveDate))}</Td>
            <Td className="text-slate-600">
              {moment.format(new Date(event.recordedAt))}
              {event.actorName && <span> by {event.actorName}</span>}
            </Td>
          </Tr>
        ))}
      </TBody>
    </Table>
  );
}
