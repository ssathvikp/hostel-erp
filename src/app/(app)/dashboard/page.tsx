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
import { SetupChecklist } from "@/features/hostels/components/SetupChecklist";
import { getSetupFacts } from "@/features/hostels/setup";
import { completedSteps, SETUP_STEPS } from "@/lib/hostels/activation";
import { daysBetween } from "@/lib/money";
import { createClient } from "@/lib/supabase/server";
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
  // Owners see what is left to set up until every step is done (plan E15-T2).
  const setup = user.role === "owner" ? await getSetupFacts(await createClient(), hostel.id) : null;
  const setupDone = setup ? SETUP_STEPS.every((step) => completedSteps(setup)[step]) : true;
  const trialLeft =
    hostel.plan === "trial" && hostel.trialEndsAt ? daysBetween(today, hostel.trialEndsAt) : null;

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

      {setup && !setupDone && (
        <section
          aria-labelledby="setup-heading"
          className="mb-6 rounded-lg border border-brand-200 bg-white p-5 shadow-xs sm:p-6"
        >
          <h2 id="setup-heading" className="text-base font-semibold text-slate-900">
            Get {hostel.name} running
          </h2>
          <p className="mt-1 mb-4 text-sm text-slate-600">
            {trialLeft !== null && trialLeft >= 0
              ? `${trialLeft} ${trialLeft === 1 ? "day" : "days"} left in your free trial. `
              : ""}
            Finish these steps to run your rent through the app.
          </p>
          <SetupChecklist facts={setup} links />
        </section>
      )}

      <div className="mb-6 space-y-3">
        <RangeFilter key={rangeKey} range={range} today={today} />
        {range.error && <Alert tone="error">{range.error} Showing this month instead.</Alert>}
      </div>

      <div className="space-y-6">
        <Suspense key={`kpi-${rangeKey}`} fallback={<KpiSkeleton />}>
          <KpiSection hostelId={hostel.id} range={range} canAddRooms={user.role === "owner"} />
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
