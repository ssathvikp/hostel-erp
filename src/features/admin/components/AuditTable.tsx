import Link from "next/link";

import { Table, TBody, Td, Th, THead, Tr } from "@/components/ui";

import type { AuditEntry } from "../queries";

export const AUDIT_ACTION_LABELS: Record<string, string> = {
  plan_changed: "Changed plan",
  hostel_suspended: "Suspended hostel",
  hostel_restored: "Restored hostel",
  trial_length_changed: "Changed trial length",
  support_view_opened: "Opened support view",
  signed_out_everywhere: "Signed out everywhere",
  confirmation_resent: "Resent confirmation",
  password_reset_sent: "Sent password reset",
  announcement_created: "Published announcement",
  announcement_ended: "Ended announcement",
};

const moment = new Intl.DateTimeFormat("en-IN", {
  dateStyle: "medium",
  timeStyle: "short",
  timeZone: "Asia/Kolkata",
});

/** What changed, in a few words, from an entry's details. */
function describe(entry: AuditEntry): string | null {
  const d = entry.details;
  if (entry.action === "plan_changed") {
    const trial = d.to === "trial" && d.trial_ends_at ? ` until ${String(d.trial_ends_at)}` : "";
    return `${String(d.from)} → ${String(d.to)}${trial}`;
  }
  if (entry.action === "trial_length_changed") return `${String(d.from)} → ${String(d.to)} days`;
  if (entry.action === "announcement_created" && typeof d.message === "string") return d.message;
  return null;
}

/** Admin actions, newest first (ClickUp E10-T3). */
export function AuditTable({ entries }: { entries: readonly AuditEntry[] }) {
  return (
    <Table caption="Admin actions">
      <THead>
        <tr>
          <Th>When</Th>
          <Th>Who</Th>
          <Th>Action</Th>
          <Th>On</Th>
          <Th>Reason</Th>
        </tr>
      </THead>
      <TBody>
        {entries.map((entry) => {
          const detail = describe(entry);
          return (
            <Tr key={entry.id}>
              <Td className="whitespace-nowrap">{moment.format(new Date(entry.createdAt))}</Td>
              <Td>{entry.actorEmail}</Td>
              <Td>
                {AUDIT_ACTION_LABELS[entry.action] ?? entry.action}
                {detail && <span className="block text-xs text-slate-500">{detail}</span>}
              </Td>
              <Td>
                {entry.hostelId && entry.hostelName ? (
                  <Link
                    href={`/admin/hostels/${entry.hostelId}`}
                    className="text-brand-700 hover:underline"
                  >
                    {entry.hostelName}
                  </Link>
                ) : (
                  (entry.targetEmail ?? "—")
                )}
              </Td>
              <Td className="whitespace-normal">{entry.reason ?? "—"}</Td>
            </Tr>
          );
        })}
      </TBody>
    </Table>
  );
}
