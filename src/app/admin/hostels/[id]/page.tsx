import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { PageHeader } from "@/components/shell/PageHeader";
import { Badge } from "@/components/ui";
import { PlanForm } from "@/features/admin/components/PlanForm";
import { SuspendForm } from "@/features/admin/components/SuspendForm";
import { HOSTEL_STATUS_LABELS, HOSTEL_STATUS_TONES } from "@/features/admin/options";
import { getAdminHostels, requirePlatformAdmin } from "@/features/admin/queries";
import { formatPaise } from "@/lib/money";
import { createClient } from "@/lib/supabase/server";
import { uuid } from "@/lib/validation";

export const metadata: Metadata = { title: "Hostel" };

const moment = new Intl.DateTimeFormat("en-IN", { dateStyle: "medium", timeZone: "Asia/Kolkata" });

/**
 * One hostel, read-only apart from its plan and suspension (EP-10). There
 * is deliberately no way to act inside the hostel from here.
 */
export default async function AdminHostelPage({ params }: { params: Promise<{ id: string }> }) {
  await requirePlatformAdmin();
  const { id } = await params;
  if (!uuid("Hostel").safeParse(id).success) notFound();
  const hostel = (await getAdminHostels(await createClient())).find((row) => row.id === id);
  if (!hostel) notFound();

  const usage: [string, string][] = [
    ["Rooms", String(hostel.rooms)],
    ["Beds in use", `${hostel.occupiedBeds} of ${hostel.beds}`],
    ["Current residents", String(hostel.residents)],
    ["Staff", String(hostel.staff)],
    ["Invoices this month", String(hostel.invoicesThisMonth)],
    ["Collected this month", formatPaise(hostel.collectedThisMonth)],
    ["Signed up", moment.format(new Date(hostel.createdAt))],
    ["Last activity", hostel.lastActivityAt ? moment.format(new Date(hostel.lastActivityAt)) : "—"],
  ];

  return (
    <div className="max-w-4xl space-y-6">
      <div>
        <Link href="/admin" className="text-sm font-medium text-brand-700 hover:underline">
          ← All hostels
        </Link>
        <div className="mt-2">
          <PageHeader
            title={hostel.name}
            description={
              <span className="inline-flex flex-wrap items-center gap-2">
                <Badge tone={HOSTEL_STATUS_TONES[hostel.status] ?? "neutral"}>
                  {HOSTEL_STATUS_LABELS[hostel.status] ?? hostel.status}
                </Badge>
                <span>
                  {hostel.ownerName} · {hostel.ownerEmail}
                </span>
              </span>
            }
          />
        </div>
      </div>

      <section
        aria-labelledby="usage-heading"
        className="rounded-lg border border-slate-200 bg-white p-5 shadow-xs sm:p-6"
      >
        <h2 id="usage-heading" className="mb-4 text-base font-semibold text-slate-900">
          Usage
        </h2>
        <dl className="grid gap-x-6 gap-y-3 text-sm sm:grid-cols-2">
          {usage.map(([label, value]) => (
            <div key={label} className="flex justify-between gap-4 border-b border-slate-100 pb-2">
              <dt className="text-slate-500">{label}</dt>
              <dd className="font-medium text-slate-900 tabular-nums">{value}</dd>
            </div>
          ))}
        </dl>
      </section>

      <section
        aria-labelledby="plan-heading"
        className="rounded-lg border border-slate-200 bg-white p-5 shadow-xs sm:p-6"
      >
        <h2 id="plan-heading" className="mb-4 text-base font-semibold text-slate-900">
          Plan
        </h2>
        <PlanForm hostelId={hostel.id} plan={hostel.plan} trialEndsAt={hostel.trialEndsAt} />
      </section>

      {hostel.status !== "draft" && (
        <section
          aria-labelledby="suspend-heading"
          className="rounded-lg border border-red-200 bg-white p-5 sm:p-6"
        >
          <h2 id="suspend-heading" className="mb-4 text-base font-semibold text-slate-900">
            {hostel.status === "suspended" ? "Suspended" : "Suspend"}
          </h2>
          {hostel.suspensionReason && (
            <p className="mb-4 text-sm text-slate-700">Reason: {hostel.suspensionReason}</p>
          )}
          <SuspendForm hostelId={hostel.id} suspended={hostel.status === "suspended"} />
        </section>
      )}
    </div>
  );
}
