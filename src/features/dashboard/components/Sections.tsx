import Link from "next/link";

import { getComplaintCounts } from "@/features/complaints/queries";
import { getHostelOccupancy, occupancyPercent } from "@/features/occupancy/queries";
import { formatPaise } from "@/lib/money";
import { createClient } from "@/lib/supabase/server";

import {
  getDashboardMoney,
  getOccupancyTrend,
  getOverdueResidents,
  getRecentActivity,
} from "../queries";
import type { DashboardRange } from "../range";
import { ActivityPanel, ComplaintsPanel, OverduePanel, Panel } from "./Panels";
import { TrendChart } from "./TrendChart";

const day = new Intl.DateTimeFormat("en-IN", { day: "numeric", month: "short", timeZone: "UTC" });
const formatDay = (value: string) => day.format(new Date(`${value}T00:00:00Z`));

function Tile({
  label,
  value,
  note,
  href,
}: {
  label: string;
  value: string;
  note?: string;
  href?: string;
}) {
  const body = (
    <>
      <dt className="text-sm text-slate-500">{label}</dt>
      <dd className="mt-1 text-2xl font-semibold text-slate-900">{value}</dd>
      {note && <dd className="mt-0.5 text-xs text-slate-500">{note}</dd>}
    </>
  );
  const box = "block h-full rounded-lg border border-slate-200 bg-white p-4 shadow-xs";
  return (
    <div>
      {href ? (
        <Link href={href} className={`${box} hover:border-brand-300`}>
          <dl>{body}</dl>
        </Link>
      ) : (
        <dl className={box}>{body}</dl>
      )}
    </div>
  );
}

const TILE_ROW = "grid grid-cols-2 gap-3 lg:grid-cols-4";

/**
 * KPI cards (E8-T1). Occupancy is today's, from the same view as the
 * occupancy screen; collected and billed follow the range; outstanding and
 * overdue are what is owed today, matching the fee list.
 */
export async function KpiSection({ hostelId, range }: { hostelId: string; range: DashboardRange }) {
  const supabase = await createClient();
  const [occupancy, money] = await Promise.all([
    getHostelOccupancy(supabase, hostelId),
    getDashboardMoney(supabase, hostelId, range),
  ]);
  const period = `${formatDay(range.from)} – ${formatDay(range.to)}`;

  return (
    <div className="space-y-6">
      <section aria-labelledby="occupancy-kpis">
        <h2 id="occupancy-kpis" className="mb-2 text-sm font-medium text-slate-600">
          Beds today
        </h2>
        {occupancy.totalBeds === 0 ? (
          <p className="rounded-lg border border-dashed border-slate-300 bg-white p-4 text-sm text-slate-600">
            No beds yet.{" "}
            <Link href="/rooms/new" className="font-medium text-brand-700 underline">
              Add your first room
            </Link>{" "}
            and occupancy will show here.
          </p>
        ) : (
          <div className={TILE_ROW}>
            <Tile label="Total beds" value={String(occupancy.totalBeds)} href="/occupancy" />
            <Tile label="Occupied" value={String(occupancy.occupiedBeds)} href="/occupancy" />
            <Tile
              label="Vacant"
              value={String(occupancy.vacantBeds)}
              note={
                occupancy.outOfServiceBeds > 0
                  ? `${occupancy.outOfServiceBeds} more out of service`
                  : undefined
              }
              href="/occupancy"
            />
            <Tile label="Occupancy" value={`${occupancyPercent(occupancy)}%`} href="/occupancy" />
          </div>
        )}
      </section>

      <section aria-labelledby="money-kpis">
        <h2 id="money-kpis" className="mb-2 text-sm font-medium text-slate-600">
          Money
        </h2>
        <div className={TILE_ROW}>
          <Tile
            label="Collected"
            value={formatPaise(money.collected)}
            note={`${money.payments} ${money.payments === 1 ? "payment" : "payments"}, ${period}`}
          />
          <Tile
            label="Billed"
            value={formatPaise(money.billed)}
            note={`${money.invoices} ${money.invoices === 1 ? "invoice" : "invoices"} for months in range`}
          />
          <Tile
            label="Outstanding"
            value={formatPaise(money.outstanding)}
            note="owed today, all months"
            href="/fees"
          />
          <Tile
            label="Overdue"
            value={formatPaise(money.overdue)}
            note={`${money.overdueResidents} ${money.overdueResidents === 1 ? "resident" : "residents"}`}
            href="/fees?status=overdue"
          />
        </div>
        {money.depositsHeld > 0 && (
          <p className="mt-2 text-sm text-slate-600">
            <span className="font-medium text-slate-900 tabular-nums">
              {formatPaise(money.depositsHeld)}
            </span>{" "}
            in security deposits is held for residents. It is not counted as collected.
          </p>
        )}
      </section>
    </div>
  );
}

export async function TrendSection({
  hostelId,
  range,
}: {
  hostelId: string;
  range: DashboardRange;
}) {
  const supabase = await createClient();
  const points = await getOccupancyTrend(supabase, hostelId, range);
  return (
    <Panel title={`Occupancy by ${range.granularity}`} id="trend-heading">
      <TrendChart points={points} granularity={range.granularity} />
    </Panel>
  );
}

export async function WorkQueueSection({ hostelId, today }: { hostelId: string; today: string }) {
  const supabase = await createClient();
  const [activity, overdue, complaints] = await Promise.all([
    getRecentActivity(supabase, hostelId),
    getOverdueResidents(supabase, hostelId),
    getComplaintCounts(supabase, hostelId),
  ]);
  return (
    <div className="space-y-6">
      <ComplaintsPanel counts={complaints} />
      <div className="grid gap-6 lg:grid-cols-2">
        <ActivityPanel items={activity} now={new Date()} />
        <OverduePanel residents={overdue.residents} total={overdue.total} today={today} />
      </div>
    </div>
  );
}
