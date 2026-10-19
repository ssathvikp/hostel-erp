import type { Metadata } from "next";
import { headers } from "next/headers";

import { PageHeader } from "@/components/shell/PageHeader";
import { Alert } from "@/components/ui";
import { ShareLink } from "@/features/referrals/components/ShareLink";
import { getReferralSummary } from "@/features/referrals/queries";
import { requireActiveHostel } from "@/lib/hostels/active";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Refer a hostel" };

/** This deployment's address, from the request, for links that leave the app. */
async function siteOrigin(): Promise<string> {
  const list = await headers();
  const host = list.get("x-forwarded-host") ?? list.get("host") ?? "localhost:3000";
  const proto = list.get("x-forwarded-proto") ?? (host.startsWith("localhost") ? "http" : "https");
  return `${proto}://${host}`;
}

/** Owners share a signup link; each referred hostel that pays earns a free month (plan E14-T12). */
export default async function ReferralsPage() {
  const { user } = await requireActiveHostel();

  if (user.role !== "owner") {
    return (
      <div className="max-w-4xl space-y-6">
        <PageHeader title="Refer a hostel" />
        <Alert tone="info">Only the hostel owner can refer other owners.</Alert>
      </div>
    );
  }

  const [summary, origin] = await Promise.all([
    getReferralSummary(await createClient()),
    siteOrigin(),
  ]);
  const link = `${origin}/signup?ref=${summary.code}`;
  const tiles: [string, number][] = [
    ["Signed up", summary.signedUp],
    ["Set up a hostel", summary.setUp],
    ["Paying", summary.paying],
  ];

  return (
    <div className="max-w-4xl space-y-6">
      <PageHeader
        title="Refer a hostel"
        description="Know another hostel or PG owner? Send them your link. For every hostel that signs up with it and starts paying, you get a month free."
      />

      <section
        aria-labelledby="link-heading"
        className="rounded-lg border border-slate-200 bg-white p-5 shadow-xs sm:p-6"
      >
        <h2 id="link-heading" className="mb-4 text-base font-semibold text-slate-900">
          Your link
        </h2>
        <ShareLink link={link} />
      </section>

      <section aria-labelledby="referrals-heading">
        <h2 id="referrals-heading" className="mb-3 text-base font-semibold text-slate-900">
          Your referrals
        </h2>
        <dl className="grid grid-cols-3 gap-3">
          {tiles.map(([label, value]) => (
            <div key={label} className="rounded-lg border border-slate-200 bg-white p-4 shadow-xs">
              <dt className="text-sm text-slate-500">{label}</dt>
              <dd className="mt-1 text-2xl font-semibold text-slate-900 tabular-nums">{value}</dd>
            </div>
          ))}
        </dl>
        <p className="mt-3 text-sm text-slate-600">
          You only see counts, never who signed up. Free months are added to your plan by the Hostel
          ERP team once a referred hostel pays.
        </p>
      </section>
    </div>
  );
}
