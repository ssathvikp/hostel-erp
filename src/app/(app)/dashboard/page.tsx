import type { Metadata } from "next";
import Link from "next/link";

import { PageHeader } from "@/components/shell/PageHeader";
import { Alert, EmptyState } from "@/components/ui";
import { requireActiveHostel } from "@/lib/hostels/active";

export const metadata: Metadata = { title: "Dashboard" };

export default async function DashboardPage() {
  // No active hostel yet (new owner, or only a draft): onboarding first (E3-T6).
  const { user, hostel, context } = await requireActiveHostel();
  const firstName = user.fullName.split(/\s+/)[0];

  return (
    <>
      <PageHeader title={`Welcome, ${firstName}`} description={`${hostel.name} at a glance.`} />

      {context.draft && user.role === "owner" && (
        <Alert tone="info" className="mb-6">
          You started setting up <span className="font-medium">{context.draft.name}</span>.{" "}
          <Link href="/onboarding" className="font-medium text-brand-700 underline">
            Finish setup
          </Link>
        </Alert>
      )}

      <EmptyState
        title="Nothing to show yet"
        description="KPI cards arrive with the dashboard epic, once rooms, residents and fees exist."
      />
    </>
  );
}
