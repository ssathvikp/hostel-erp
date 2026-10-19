"use client";

import { useState, useTransition } from "react";

import { Button } from "@/components/ui";
import { cn } from "@/lib/cn";

import { dismissAnnouncement } from "../actions";
import type { Announcement } from "../queries";

/** Platform announcements at the top of every page, until dismissed (ClickUp E10-T11). */
export function AnnouncementBanner({ announcements }: { announcements: Announcement[] }) {
  const [hidden, setHidden] = useState<string[]>([]);
  const [, startTransition] = useTransition();
  const shown = announcements.filter((announcement) => !hidden.includes(announcement.id));
  if (shown.length === 0) return null;

  // Already on the page when it loads, so a labelled section rather than a
  // live region: it should not interrupt a screen reader or collide with a
  // page's own status messages.
  return (
    <section aria-label="Announcements" className="mb-6 space-y-2 print:hidden">
      {shown.map((announcement) => (
        <div
          key={announcement.id}
          className={cn(
            "flex flex-wrap items-start justify-between gap-3 rounded-md border px-4 py-3 text-sm",
            announcement.severity === "warning"
              ? "border-amber-200 bg-amber-50 text-amber-900"
              : "border-brand-100 bg-brand-50 text-slate-800",
          )}
        >
          <div>
            <p className="font-medium">From Hostel ERP</p>
            <p className="mt-1 whitespace-pre-line">{announcement.message}</p>
          </div>
          <Button
            size="sm"
            variant="secondary"
            aria-label={`Dismiss: ${announcement.message}`}
            onClick={() => {
              setHidden((ids) => [...ids, announcement.id]);
              startTransition(async () => {
                await dismissAnnouncement(announcement.id);
              });
            }}
          >
            Dismiss
          </Button>
        </div>
      ))}
    </section>
  );
}
