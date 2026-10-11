import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";

import { PageHeader } from "@/components/shell/PageHeader";
import { Alert } from "@/components/ui";
import { RangeFilter } from "@/features/dashboard/components/RangeFilter";
import {
  KpiSection,
  TrendSection,
  WorkQueueSection,
} from "@/features/dashboard/components/Sections";
import { KpiSkeleton, PanelSkeleton } from "@/features/dashboard/components/Skeletons";
import { parseRange } from "@/features/dashboard/range";
import { requireActiveHostel } from "@/lib/hostels/active";
import { todayIst } from "@/lib/validation";

export const metadata: Metadata = { title: "Dashboard" };

/**
 * How full the hostel is and how much money is owed (EP-08). Each section
 * streams in behind a skeleton of its own shape.
 */
export default async function DashboardPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  // No active hostel yet (new owner, or only a draft): onboarding first (E3-T6).
  const { user, hostel, context } = await requireActiveHostel();
  const firstName = user.fullName.split(/\s+/)[0];
  const today = todayIst();
  const range = parseRange(await searchParams, today);
  const rangeKey = `${range.from}:${range.to}`;

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

      <div className="mb-6 space-y-3">
        <RangeFilter key={rangeKey} range={range} today={today} />
        {range.error && <Alert tone="error">{range.error} Showing this month instead.</Alert>}
      </div>

      <div className="space-y-6">
        <Suspense key={`kpi-${rangeKey}`} fallback={<KpiSkeleton />}>
          <KpiSection hostelId={hostel.id} range={range} />
        </Suspense>
        <Suspense key={`trend-${rangeKey}`} fallback={<PanelSkeleton height="h-60" />}>
          <TrendSection hostelId={hostel.id} range={range} />
        </Suspense>
        <Suspense
          fallback={
            <div className="grid gap-6 lg:grid-cols-2">
              <PanelSkeleton />
              <PanelSkeleton />
            </div>
          }
        >
          <WorkQueueSection hostelId={hostel.id} today={today} />
        </Suspense>
      </div>
    </>
  );
}
