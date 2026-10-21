import type { ReactNode } from "react";

import { AppShell } from "@/components/shell/AppShell";
import { AnnouncementBanner } from "@/features/announcements/components/AnnouncementBanner";
import { ReadOnlyBanner } from "@/features/billing/components/ReadOnlyBanner";
import { getAccountStatus } from "@/features/billing/queries";
import { getAnnouncements } from "@/features/announcements/queries";
import { TrialBanner } from "@/features/hostels/components/TrialBanner";
import { requireUser } from "@/lib/auth/session";
import { getHostelContext } from "@/lib/hostels/active";
import { createClient } from "@/lib/supabase/server";
import { todayIst } from "@/lib/validation";

export default async function AppLayout({ children }: { children: ReactNode }) {
  // Middleware already redirects signed-out visitors; this is the second,
  // independent check so no protected page ever renders without a user.
  const user = await requireUser();
  const supabase = await createClient();
  const [{ active, hostels, draft }, announcements] = await Promise.all([
    getHostelContext(),
    getAnnouncements(supabase),
  ]);
  const account = active ? await getAccountStatus(supabase, active.id) : null;
  const readOnly = account !== null && !account.canWrite;
  const trialEndsAt =
    !readOnly && user.role === "owner" && account?.effectiveStatus === "trialing"
      ? account.trialEndsAt
      : null;

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
      <AnnouncementBanner announcements={announcements} />
      {readOnly && (
        <ReadOnlyBanner
          isOwner={user.role === "owner"}
          trialEnded={account?.status === "trialing"}
        />
      )}
      {trialEndsAt && <TrialBanner trialEndsAt={trialEndsAt} today={todayIst()} />}
      {children}
    </AppShell>
  );
}
