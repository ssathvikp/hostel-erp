import type { Metadata } from "next";

import { PageHeader } from "@/components/shell/PageHeader";
import { Alert, Badge } from "@/components/ui";
import { requirePlatformAdmin } from "@/features/admin/queries";
import { PlanEditForm } from "@/features/billing/components/AdminBillingForms";
import { getPlans } from "@/features/billing/queries";
import { formatPaise } from "@/lib/money";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Plans" };

const limit = (value: number | null) => (value === null ? "no limit" : String(value));

/** Plans, prices and limits (ClickUp EP-14 T1). Every change is audited. */
export default async function AdminPlansPage() {
  await requirePlatformAdmin();
  const plans = await getPlans(await createClient());
  return (
    <div className="max-w-4xl space-y-6">
      <PageHeader
        title="Plans"
        description="Prices and limits. A price change reaches existing subscriptions at renewal."
      />
      <Alert tone="warning">
        The seeded prices are placeholders. Set the real ones before taking payments; see
        docs/pricing.md.
      </Alert>
      <ul className="space-y-4">
        {plans.map((plan) => (
          <li
            key={plan.id}
            className="space-y-3 rounded-lg border border-slate-200 bg-white p-5 shadow-xs"
          >
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-base font-semibold text-slate-900">{plan.name}</h2>
              <span className="font-mono text-xs text-slate-500">{plan.id}</span>
              {!plan.public && <Badge>Not offered</Badge>}
              {!plan.active && <Badge tone="warning">Inactive</Badge>}
            </div>
            <p className="text-sm text-slate-700">
              {formatPaise(plan.monthlyPrice)} a month
              {plan.yearlyPrice !== null && `, ${formatPaise(plan.yearlyPrice)} a year`} (
              {plan.gstInclusive ? "incl." : "+"} GST) · beds {limit(plan.maxBeds)}, hostels{" "}
              {limit(plan.maxHostels)}, staff {limit(plan.maxStaff)}
            </p>
            <details className="text-sm">
              <summary className="cursor-pointer font-medium text-brand-700">Edit</summary>
              <div className="mt-3">
                <PlanEditForm plan={plan} />
              </div>
            </details>
          </li>
        ))}
      </ul>
      <section
        aria-labelledby="new-plan"
        className="rounded-lg border border-slate-200 bg-white p-5 shadow-xs sm:p-6"
      >
        <h2 id="new-plan" className="mb-4 text-base font-semibold text-slate-900">
          Add a plan
        </h2>
        <PlanEditForm />
      </section>
    </div>
  );
}
