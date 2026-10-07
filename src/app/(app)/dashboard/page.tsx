import type { Metadata } from "next";

import { PageHeader } from "@/components/shell/PageHeader";
import { Badge, EmptyState } from "@/components/ui";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Dashboard" };

export default async function DashboardPage() {
  const supabase = await createClient();
  // getUser() revalidates the token with Supabase Auth, unlike getSession(),
  // so it is the safe call for anything that gates data on the server.
  const {
    data: { user },
  } = await supabase.auth.getUser();

  return (
    <>
      <PageHeader
        title="Dashboard"
        description="Occupancy and collections at a glance."
        actions={
          user ? (
            <Badge tone="success">Signed in as {user.email}</Badge>
          ) : (
            <Badge tone="warning">Not signed in</Badge>
          )
        }
      />
      <EmptyState
        title="Nothing to show yet"
        description="KPI cards arrive with the dashboard epic, once rooms, residents and fees exist."
      />
    </>
  );
}
