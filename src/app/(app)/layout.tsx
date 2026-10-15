import { redirect } from "next/navigation";
import type { ReactNode } from "react";

import { AccountBanner } from "@/components/shell/AccountBanner";
import { Announcements } from "@/components/shell/Announcement";
import { AppShell } from "@/components/shell/AppShell";
import { getCurrentAnnouncements } from "@/features/announcements/queries";
import { getAccountState } from "@/features/billing/queries";
import { requireUser } from "@/lib/auth/session";
import { getHostelContext } from "@/lib/hostels/active";
import { createClient } from "@/lib/supabase/server";

export default async function AppLayout({ children }: { children: ReactNode }) {
  // Middleware already redirects signed-out visitors; this is the second,
  // independent check so no protected page ever renders without a user.
  const user = await requireUser();
  // Platform admins belong to no hostel; their area is separate (E10-T2).
  if (user.role === "platform_admin") redirect("/admin");
  const supabase = await createClient();
  const [{ active, hostels, draft }, announcements] = await Promise.all([
    getHostelContext(),
    getCurrentAnnouncements(supabase),
  ]);
  // Trial days left, a failed payment or read-only mode (E14-T3, T9).
  const account = active ? await getAccountState(supabase, active.id) : null;

  return (
    <AppShell
      user={{ fullName: user.fullName, email: user.email }}
      hostels={{
        hostels: hostels.map(({ id, name }) => ({ id, name })),
        activeId: active?.id ?? null,
        draftName: draft?.name ?? null,
        canAddHostel: user.role === "owner",
      }}
    >
      <AccountBanner state={account} isOwner={user.role === "owner"} />
      <Announcements items={announcements} />
      {children}
    </AppShell>
  );
}
