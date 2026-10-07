import type { ReactNode } from "react";

import { AppShell } from "@/components/shell/AppShell";
import { requireUser } from "@/lib/auth/session";

export default async function AppLayout({ children }: { children: ReactNode }) {
  // Middleware already redirects signed-out visitors; this is the second,
  // independent check so no protected page ever renders without a user.
  const user = await requireUser();

  return <AppShell user={{ fullName: user.fullName, email: user.email }}>{children}</AppShell>;
}
