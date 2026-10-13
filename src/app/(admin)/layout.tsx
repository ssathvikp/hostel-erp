import type { Metadata } from "next";
import type { ReactNode } from "react";

import { AdminShell } from "@/components/shell/AdminShell";
import { requirePlatformAdmin } from "@/lib/auth/admin";

// No title here: a non-admin's 404 must not name the area.
export const metadata: Metadata = { robots: { index: false, follow: false } };

/**
 * Every admin page sits under this layout. Non-admins get a 404 here; each
 * page checks again, and so does every admin database function.
 */
export default async function AdminLayout({ children }: { children: ReactNode }) {
  const user = await requirePlatformAdmin({ allowWithoutMfa: true });
  return <AdminShell email={user.email}>{children}</AdminShell>;
}
