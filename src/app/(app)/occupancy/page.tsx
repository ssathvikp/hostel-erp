import type { Metadata } from "next";
import Link from "next/link";

import { PageHeader } from "@/components/shell/PageHeader";
import { buttonClass, EmptyState } from "@/components/ui";
import { AllocateBedButton, AllocateBoard } from "@/features/allocations/components/AllocateBoard";
import { getUnallocatedResidents } from "@/features/allocations/queries";
import {
  getOccupancySnapshot,
  occupancyPercent,
  type OccupancyBed,
  type OccupancyTotals,
} from "@/features/occupancy/queries";
import { BED_STATUS_LABELS, floorLabel, SHARING_TYPE_LABELS } from "@/features/rooms/options";
import { cn } from "@/lib/cn";
import { requireActiveHostel } from "@/lib/hostels/active";
import { createClient } from "@/lib/supabase/server";
import type { BedStatus } from "@/types";

export const metadata: Metadata = { title: "Occupancy" };

/** Each state has its own colour and border style, and is always labelled in text too. */
const BED_STYLES: Record<BedStatus, string> = {
  occupied: "border-sky-200 bg-sky-50",
  available: "border-emerald-300 bg-white",
  blocked: "border-dashed border-amber-400 bg-amber-50",
  maintenance: "border-dashed border-red-300 bg-red-50",
};
const BED_TEXT: Record<BedStatus, string> = {
  occupied: "text-sky-800",
  available: "text-emerald-700",
  blocked: "text-amber-800",
  maintenance: "text-red-700",
};

function Stat({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-xs">
      <dt className="text-xs font-medium tracking-wide text-slate-500 uppercase">{label}</dt>
      <dd className="mt-1 text-2xl font-semibold text-slate-900 tabular-nums">{value}</dd>
    </div>
  );
}

function Summary({ totals }: { totals: OccupancyTotals }) {
  return (
    <dl className="grid grid-cols-2 gap-3 sm:grid-cols-5">
      <Stat label="Occupancy" value={`${occupancyPercent(totals)}%`} />
      <Stat label="Total beds" value={totals.totalBeds} />
      <Stat label="Occupied" value={totals.occupiedBeds} />
      <Stat label="Vacant" value={totals.vacantBeds} />
      <Stat label="Out of service" value={totals.outOfServiceBeds} />
    </dl>
  );
}

function Bed({ bed }: { bed: OccupancyBed }) {
  return (
    <li className={cn("rounded-md border px-3 py-2 text-sm", BED_STYLES[bed.status])}>
      <div className="flex items-center justify-between gap-2">
        <span className="font-medium text-slate-900">{bed.label}</span>
        <span className={cn("text-xs font-medium", BED_TEXT[bed.status])}>
          {BED_STATUS_LABELS[bed.status]}
        </span>
      </div>
      <div className="mt-1 min-h-5 truncate text-xs text-slate-600">
        {bed.occupant ? (
          <Link
            href={`/residents/${bed.occupant.id}`}
            className="font-medium text-brand-700 hover:underline"
          >
            {bed.occupant.name}
          </Link>
        ) : bed.status === "available" ? (
          <AllocateBedButton bed={{ id: bed.id, label: bed.label }} />
        ) : (
          (bed.reason ?? "Not available")
        )}
      </div>
    </li>
  );
}

/**
 * Who sleeps where, floor by floor (E6-T6). Figures are derived from live
 * allocations (E6-T5); allocating from a vacant bed refreshes the page data
 * through the server action, without a full reload.
 */
export default async function OccupancyPage() {
  const { hostel } = await requireActiveHostel();
  const supabase = await createClient();
  const [snapshot, residents] = await Promise.all([
    getOccupancySnapshot(supabase, hostel.id),
    getUnallocatedResidents(supabase, hostel.id),
  ]);

  return (
    <div className="space-y-8">
      <PageHeader
        title="Occupancy"
        description="Live bed status for today. Occupancy is occupied beds out of all beds."
      />

      {snapshot.hostel.totalBeds === 0 ? (
        <EmptyState
          title="No beds yet"
          description="Add rooms to see which beds are free."
          action={
            <Link href="/rooms" className={buttonClass()}>
              Go to rooms
            </Link>
          }
        />
      ) : (
        <AllocateBoard residentOptions={residents.map((r) => ({ value: r.id, label: r.label }))}>
          <Summary totals={snapshot.hostel} />

          {snapshot.floors.map((floor) => (
            <section
              key={floor.floor}
              aria-labelledby={`floor-${floor.floor}`}
              className="mt-8 space-y-3"
            >
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <h2 id={`floor-${floor.floor}`} className="text-base font-semibold text-slate-900">
                  {floorLabel(floor.floor)}
                </h2>
                <p className="text-sm text-slate-600 tabular-nums">
                  {floor.occupiedBeds} of {floor.totalBeds} occupied ·{" "}
                  <span className="font-medium text-slate-900">{occupancyPercent(floor)}%</span> ·{" "}
                  {floor.vacantBeds} vacant
                  {floor.outOfServiceBeds > 0 && ` · ${floor.outOfServiceBeds} out of service`}
                </p>
              </div>
              <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                {floor.roomList.map((room) => (
                  <article
                    key={room.id}
                    aria-labelledby={`room-${room.id}`}
                    className="rounded-lg border border-slate-200 bg-white p-4 shadow-xs"
                  >
                    <h3 id={`room-${room.id}`} className="mb-3 flex items-baseline gap-2 text-sm">
                      <Link
                        href={`/rooms/${room.id}`}
                        className="font-semibold text-brand-700 hover:underline"
                      >
                        Room {room.number}
                      </Link>
                      <span className="text-slate-500">
                        {SHARING_TYPE_LABELS[room.sharingType]}
                      </span>
                    </h3>
                    <ul className="grid grid-cols-2 gap-2">
                      {room.beds.map((bed) => (
                        <Bed key={bed.id} bed={bed} />
                      ))}
                    </ul>
                  </article>
                ))}
              </div>
            </section>
          ))}
        </AllocateBoard>
      )}
    </div>
  );
}
