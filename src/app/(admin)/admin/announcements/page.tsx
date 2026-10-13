import type { Metadata } from "next";

import { PageHeader } from "@/components/shell/PageHeader";
import { Badge, EmptyState, Table, TBody, Td, Th, THead, Tr } from "@/components/ui";
import { AnnouncementForm, EndAnnouncementButton } from "@/features/admin/components/AdminForms";
import { requirePlatformAdmin } from "@/lib/auth/admin";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Announcements" };

const at = new Intl.DateTimeFormat("en-IN", {
  dateStyle: "medium",
  timeStyle: "short",
  timeZone: "Asia/Kolkata",
});

/** `YYYY-MM-DDTHH:mm` in India time, for a datetime-local field. */
function istLocal(date: Date): string {
  return new Intl.DateTimeFormat("sv-SE", {
    timeZone: "Asia/Kolkata",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  })
    .format(date)
    .replace(" ", "T");
}

/** Banners for every owner and staff member (E10-T11). */
export default async function AnnouncementsPage() {
  await requirePlatformAdmin();
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("announcements")
    .select("id, message, severity, starts_at, ends_at")
    .order("starts_at", { ascending: false })
    .limit(50);
  if (error) throw error;
  const now = new Date();

  return (
    <div className="space-y-8">
      <PageHeader
        title="Announcements"
        description="A banner at the top of the app for every owner and staff member, until it ends or they dismiss it."
      />
      <AnnouncementForm now={istLocal(now)} />

      {(data ?? []).length === 0 ? (
        <EmptyState title="No announcements yet" />
      ) : (
        <Table caption="Announcements">
          <THead>
            <tr>
              <Th>Message</Th>
              <Th>Severity</Th>
              <Th>Shown</Th>
              <Th>
                <span className="sr-only">Actions</span>
              </Th>
            </tr>
          </THead>
          <TBody>
            {(data ?? []).map((row) => {
              const live = new Date(row.starts_at) <= now && new Date(row.ends_at) > now;
              const upcoming = new Date(row.starts_at) > now;
              return (
                <Tr key={row.id}>
                  <Td className="whitespace-normal">{row.message}</Td>
                  <Td>
                    <Badge
                      tone={
                        row.severity === "critical"
                          ? "danger"
                          : row.severity === "warning"
                            ? "warning"
                            : "info"
                      }
                    >
                      {row.severity}
                    </Badge>
                  </Td>
                  <Td className="whitespace-normal">
                    {at.format(new Date(row.starts_at))} to {at.format(new Date(row.ends_at))}
                    <span className="block text-xs text-slate-500">
                      {live ? "Showing now" : upcoming ? "Scheduled" : "Ended"}
                    </span>
                  </Td>
                  <Td className="text-right">
                    {(live || upcoming) && <EndAnnouncementButton id={row.id} />}
                  </Td>
                </Tr>
              );
            })}
          </TBody>
        </Table>
      )}
    </div>
  );
}
