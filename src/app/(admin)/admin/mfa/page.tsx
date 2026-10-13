import type { Metadata } from "next";

import { PageHeader } from "@/components/shell/PageHeader";
import { MfaPanel } from "@/features/admin/components/MfaPanel";
import { requirePlatformAdmin } from "@/lib/auth/admin";

export const metadata: Metadata = { title: "Verify it's you" };

/** The one admin page reachable before MFA (E10-T1). */
export default async function MfaPage() {
  await requirePlatformAdmin({ allowWithoutMfa: true });
  return (
    <>
      <PageHeader
        title="Verify it's you"
        description="The admin area can see every hostel's data, so it needs a code from your authenticator app as well as your password."
      />
      <MfaPanel />
    </>
  );
}
