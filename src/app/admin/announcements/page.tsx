import type { Metadata } from "next";

import { PageHeader } from "@/components/shell/PageHeader";
import { Badge, EmptyState, Table, TBody, Td, Th, THead, Tr } from "@/components/ui";
import {
  AnnouncementForm,
  EndAnnouncementButton,
} from "@/features/admin/components/AnnouncementForms";
import { getAdminAnnouncements, requirePlatformAdmin } from "@/features/admin/queries";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Announcements" };

const moment = new Intl.DateTimeFormat("en-IN", {
  dateStyle: "medium",
  timeStyle: "short",
  timeZone: "Asia/Kolkata",
});

/** Messages to every owner and staff member, shown as a banner (ClickUp E10-T11). */
export default async function AdminAnnouncementsPage() {
  await requirePlatformAdmin();
  const announcements = await getAdminAnnouncements(await createClient());
  const now = Date.now();
  const live = (row: (typeof announcements)[number]) =>
    new Date(row.startsAt).getTime() <= now &&
    (!row.endsAt || new Date(row.endsAt).getTime() > now);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Announcements"
        description="A banner every owner and staff member sees until it ends or they dismiss it."
      />
      <section className="max-w-2xl rounded-lg border border-slate-200 bg-white p-5 shadow-xs sm:p-6">
        <AnnouncementForm />
      </section>
      {announcements.length === 0 ? (
        <EmptyState title="No announcements yet" />
      ) : (
        <Table caption="Announcements">
          <THead>
            <tr>
              <Th>Message</Th>
              <Th>Shown</Th>
              <Th className="text-right">Dismissed by</Th>
              <Th>
                <span className="sr-only">Actions</span>
              </Th>
            </tr>
          </THead>
          <TBody>
            {announcements.map((row) => (
              <Tr key={row.id}>
                <Td className="whitespace-normal">
                  <Badge tone={row.severity === "warning" ? "warning" : "info"}>
                    {live(row) ? "Live" : "Ended"}
                  </Badge>{" "}
                  {row.message}
                </Td>
                <Td>
                  {moment.format(new Date(row.startsAt))}
                  <span className="block text-xs text-slate-500">
                    {row.endsAt ? `until ${moment.format(new Date(row.endsAt))}` : "until ended"}
                  </span>
                </Td>
                <Td className="text-right tabular-nums">{row.dismissals}</Td>
                <Td>{live(row) && <EndAnnouncementButton id={row.id} />}</Td>
              </Tr>
            ))}
          </TBody>
        </Table>
      )}
    </div>
  );
}
