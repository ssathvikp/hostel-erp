import type { Metadata } from "next";

import { PageHeader } from "@/components/shell/PageHeader";
import { EmptyState } from "@/components/ui";
import { requireUser } from "@/lib/auth/session";

export const metadata: Metadata = { title: "Dashboard" };

export default async function DashboardPage() {
  const user = await requireUser();
  const firstName = user.fullName.split(/\s+/)[0];

  return (
    <>
      <PageHeader
        title={`Welcome, ${firstName}`}
        description="Occupancy and collections at a glance."
      />
      <EmptyState
        title="Nothing to show yet"
        description="KPI cards arrive with the dashboard epic, once rooms, residents and fees exist."
      />
    </>
  );
}
