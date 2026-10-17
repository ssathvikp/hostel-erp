import type { Metadata } from "next";
import Link from "next/link";

import { PageHeader } from "@/components/shell/PageHeader";
import { Badge, EmptyState, Table, TBody, Td, Th, THead, Tr } from "@/components/ui";
import { HOSTEL_STATUS_LABELS, HOSTEL_STATUS_TONES, PLAN_LABELS } from "@/features/admin/options";
import { getAdminHostels, requirePlatformAdmin } from "@/features/admin/queries";
import { TRIAL_WARNING_DAYS } from "@/features/hostels/components/TrialBanner";
import { daysBetween, formatPaise } from "@/lib/money";
import { createClient } from "@/lib/supabase/server";
import { todayIst } from "@/lib/validation";

export const metadata: Metadata = { title: "Hostels" };

const day = new Intl.DateTimeFormat("en-IN", { dateStyle: "medium", timeZone: "UTC" });
const moment = new Intl.DateTimeFormat("en-IN", { dateStyle: "medium", timeZone: "Asia/Kolkata" });

/** Every hostel on the platform, its plan and how much it is used (EP-10). */
export default async function AdminHostelsPage() {
  await requirePlatformAdmin();
  const hostels = await getAdminHostels(await createClient());
  const today = todayIst();
  const trialsEnding = hostels.filter(
    (hostel) =>
      hostel.plan === "trial" &&
      hostel.trialEndsAt &&
      daysBetween(today, hostel.trialEndsAt) <= TRIAL_WARNING_DAYS,
  );
  const tiles = [
    ["Hostels", hostels.length],
    ["Paying", hostels.filter((hostel) => hostel.plan === "paid").length],
    ["On trial", hostels.filter((hostel) => hostel.plan === "trial").length],
    [`Trials ending in ${TRIAL_WARNING_DAYS} days or ended`, trialsEnding.length],
  ] as const;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Hostels"
        description="Usage counts only. Resident details stay private to each hostel."
      />

      <dl className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {tiles.map(([label, value]) => (
          <div key={label} className="rounded-lg border border-slate-200 bg-white p-4 shadow-xs">
            <dt className="text-sm text-slate-500">{label}</dt>
            <dd className="mt-1 text-2xl font-semibold text-slate-900 tabular-nums">{value}</dd>
          </div>
        ))}
      </dl>

      {hostels.length === 0 ? (
        <EmptyState title="No hostels yet" description="Hostels appear here as owners sign up." />
      ) : (
        <Table caption="Hostels on the platform">
          <THead>
            <tr>
              <Th>Hostel</Th>
              <Th>Owner</Th>
              <Th>Plan</Th>
              <Th>Status</Th>
              <Th className="text-right">Beds used</Th>
              <Th className="text-right">Collected this month</Th>
              <Th>Last activity</Th>
            </tr>
          </THead>
          <TBody>
            {hostels.map((hostel) => (
              <Tr key={hostel.id}>
                <Td>
                  <Link
                    href={`/admin/hostels/${hostel.id}`}
                    className="font-medium text-brand-700 hover:underline"
                  >
                    {hostel.name}
                  </Link>
                  <span className="block text-xs text-slate-500">{hostel.city ?? "—"}</span>
                </Td>
                <Td>
                  {hostel.ownerName}
                  <span className="block text-xs text-slate-500">{hostel.ownerEmail}</span>
                </Td>
                <Td>
                  {PLAN_LABELS[hostel.plan] ?? hostel.plan}
                  {hostel.plan === "trial" && hostel.trialEndsAt && (
                    <span className="block text-xs text-slate-500">
                      until {day.format(new Date(hostel.trialEndsAt))}
                    </span>
                  )}
                </Td>
                <Td>
                  <Badge tone={HOSTEL_STATUS_TONES[hostel.status] ?? "neutral"}>
                    {HOSTEL_STATUS_LABELS[hostel.status] ?? hostel.status}
                  </Badge>
                </Td>
                <Td className="text-right tabular-nums">
                  {hostel.occupiedBeds} / {hostel.beds}
                </Td>
                <Td className="text-right tabular-nums">
                  {formatPaise(hostel.collectedThisMonth)}
                </Td>
                <Td>
                  {hostel.lastActivityAt ? moment.format(new Date(hostel.lastActivityAt)) : "—"}
                </Td>
              </Tr>
            ))}
          </TBody>
        </Table>
      )}
    </div>
  );
}
