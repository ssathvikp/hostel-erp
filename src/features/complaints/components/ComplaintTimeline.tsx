import { COMPLAINT_STATUS_LABELS } from "../options";
import type { ComplaintEvent } from "../queries";

const at = new Intl.DateTimeFormat("en-IN", {
  dateStyle: "medium",
  timeStyle: "short",
  timeZone: "Asia/Kolkata",
});

/** What happened, in words, for one history entry. */
function headline(event: ComplaintEvent): string {
  switch (event.kind) {
    case "created":
      return "Raised the complaint";
    case "status":
      return event.toStatus
        ? `Moved it to ${COMPLAINT_STATUS_LABELS[event.toStatus].toLowerCase()}`
        : "Changed the status";
    case "assigned":
      return event.workerName ? `Assigned ${event.workerName}` : "Assigned a worker";
    case "unassigned":
      return event.workerName ? `Took it off ${event.workerName}` : "Removed the worker";
    case "routing":
      return "Could not find a worker";
    case "escalated":
      return "Flagged as overdue";
    case "accepted":
      return "Accepted the job";
    case "declined":
      return "Declined the job";
    case "comment":
      return "Commented";
    case "cost":
      return "Updated the costs";
    case "attachment":
      return "Added a file";
    case "job_link":
      return event.workerName ? `Shared a job link with ${event.workerName}` : "Shared a job link";
    default:
      return event.kind;
  }
}

/** The complaint's immutable history, oldest first (E15-T1). */
export function ComplaintTimeline({ events }: { events: readonly ComplaintEvent[] }) {
  if (events.length === 0) return <p className="text-sm text-slate-600">No history yet.</p>;
  return (
    <ol className="space-y-4 border-l border-slate-200 pl-5">
      {events.map((event) => {
        const title = headline(event);
        // Notes that only repeat the headline add nothing.
        const note =
          event.note && !title.toLowerCase().startsWith(event.note.toLowerCase())
            ? event.note
            : null;
        return (
          <li key={event.id} className="relative text-sm">
            <span
              aria-hidden="true"
              className="absolute top-1.5 -left-[25px] size-2.5 rounded-full border-2 border-white bg-slate-400"
            />
            <p>
              <span className="font-medium text-slate-900">{event.actorName}</span>{" "}
              <span className="text-slate-700">
                {title.charAt(0).toLowerCase() + title.slice(1)}
              </span>
            </p>
            {note && <p className="mt-0.5 whitespace-pre-line text-slate-600">{note}</p>}
            <p className="text-xs text-slate-500">
              <time dateTime={event.createdAt}>{at.format(new Date(event.createdAt))}</time>
            </p>
          </li>
        );
      })}
    </ol>
  );
}
