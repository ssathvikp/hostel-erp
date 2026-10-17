import type { ReactNode } from "react";

import { AppShell } from "@/components/shell/AppShell";
import { TrialBanner } from "@/features/hostels/components/TrialBanner";
import { requireUser } from "@/lib/auth/session";
import { getHostelContext } from "@/lib/hostels/active";
import { todayIst } from "@/lib/validation";

export default async function AppLayout({ children }: { children: ReactNode }) {
  // Middleware already redirects signed-out visitors; this is the second,
  // independent check so no protected page ever renders without a user.
  const user = await requireUser();
  const { active, hostels, draft } = await getHostelContext();
  const trialEndsAt = user.role === "owner" && active?.plan === "trial" ? active.trialEndsAt : null;

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
      {trialEndsAt && <TrialBanner trialEndsAt={trialEndsAt} today={todayIst()} />}
      {children}
    </AppShell>
  );
}
