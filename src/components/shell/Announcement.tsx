import { dismissAnnouncement } from "@/features/announcements/actions";
import type { CurrentAnnouncement } from "@/features/announcements/queries";
import { cn } from "@/lib/cn";

import { focusRing } from "../ui";

const TONES: Record<CurrentAnnouncement["severity"], string> = {
  info: "border-brand-100 bg-brand-50 text-slate-800",
  warning: "border-amber-200 bg-amber-50 text-amber-900",
  critical: "border-red-200 bg-red-50 text-red-800",
};

/** A platform announcement from Hostel ERP, dismissible per user (E10-T11). */
export function Announcements({ items }: { items: readonly CurrentAnnouncement[] }) {
  if (items.length === 0) return null;
  return (
    <div className="mb-6 space-y-2 print:hidden">
      {items.map((item) => (
        <div
          key={item.id}
          role={item.severity === "critical" ? "alert" : "status"}
          className={cn(
            "flex items-start justify-between gap-3 rounded-md border px-4 py-3 text-sm",
            TONES[item.severity],
          )}
        >
          <p>
            <span className="font-medium">From Hostel ERP: </span>
            {item.message}
          </p>
          <form action={dismissAnnouncement}>
            <input type="hidden" name="id" value={item.id} />
            <button
              type="submit"
              className={cn("rounded px-1 text-xs font-medium underline", focusRing)}
            >
              Dismiss
            </button>
          </form>
        </div>
      ))}
    </div>
  );
}
