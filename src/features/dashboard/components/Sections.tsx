import Link from "next/link";

import { getHostelOccupancy, occupancyPercent } from "@/features/occupancy/queries";
import { formatPaise } from "@/lib/money";
import { createClient } from "@/lib/supabase/server";

import {
  getCreditHeld,
  getDashboardMoney,
  getDepositsHeld,
  getOccupancyTrend,
  getOverdueResidents,
  getRecentActivity,
  getVacancyCost,
} from "../queries";
import type { VacancyCost } from "../queries";
import type { DashboardRange } from "../range";
import { ActivityPanel, OverduePanel, Panel } from "./Panels";
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
export async function KpiSection({
  hostelId,
  range,
  canAddRooms,
}: {
  hostelId: string;
  range: DashboardRange;
  /** Only owners add rooms; staff are not sent to a page they can't use. */
  canAddRooms: boolean;
}) {
  const supabase = await createClient();
  const [occupancy, money, deposits, vacancy, credit] = await Promise.all([
    getHostelOccupancy(supabase, hostelId),
    getDashboardMoney(supabase, hostelId, range),
    getDepositsHeld(supabase, hostelId),
    getVacancyCost(supabase, hostelId),
    getCreditHeld(supabase, hostelId),
  ]);
  const period = `${formatDay(range.from)} – ${formatDay(range.to)}`;

  return (
    <div className="space-y-6">
      <MoneyLost
        vacancy={vacancy}
        overdue={money.overdue}
        overdueResidents={money.overdueResidents}
      />

      <section aria-labelledby="occupancy-kpis">
        <h2 id="occupancy-kpis" className="mb-2 text-sm font-medium text-slate-600">
          Beds today
        </h2>
        {occupancy.totalBeds === 0 ? (
          <p className="rounded-lg border border-dashed border-slate-300 bg-white p-4 text-sm text-slate-600">
            No beds yet.{" "}
            {canAddRooms ? (
              <>
                <Link href="/rooms/new" className="font-medium text-brand-700 underline">
                  Add your first room
                </Link>{" "}
                and occupancy will show here.
              </>
            ) : (
              "Occupancy will show here once the owner adds rooms."
            )}
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
        {deposits.held > 0 && (
          <p className="mt-3 text-sm text-slate-600">
            Security deposits held:{" "}
            <span className="font-medium text-slate-900">{formatPaise(deposits.held)}</span> from{" "}
            {deposits.residents} {deposits.residents === 1 ? "resident" : "residents"}. This money
            is owed back unless deducted when they leave.
          </p>
        )}
        {credit.held > 0 && (
          <p className="mt-1 text-sm text-slate-600">
            Advance credit held:{" "}
            <span className="font-medium text-slate-900">{formatPaise(credit.held)}</span> from{" "}
            {credit.residents} {credit.residents === 1 ? "resident" : "residents"}. It is used on
            their next invoices.
          </p>
        )}
      </section>
    </div>
  );
}

/**
 * What the hostel is losing right now, in rupees (plan E15-T4): rent the
 * empty beds would bring in each month, and rent that is overdue.
 */
function MoneyLost({
  vacancy,
  overdue,
  overdueResidents,
}: {
  vacancy: VacancyCost;
  overdue: number;
  overdueResidents: number;
}) {
  if (vacancy.monthlyValue === 0 && overdue === 0) return null;
  return (
    <section
      aria-labelledby="money-lost"
      className="rounded-lg border border-amber-200 bg-amber-50 p-4 sm:p-5"
    >
      <h2 id="money-lost" className="text-sm font-semibold text-amber-900">
        Money you are missing
      </h2>
      <dl className="mt-3 grid gap-4 sm:grid-cols-2">
        {vacancy.monthlyValue > 0 && (
          <div>
            <dt className="text-sm text-amber-800">Empty beds, every month</dt>
            <dd className="mt-1 text-2xl font-semibold text-amber-950">
              {formatPaise(vacancy.monthlyValue)}
            </dd>
            <dd className="mt-0.5 text-xs text-amber-800">
              {vacancy.vacantBeds} vacant {vacancy.vacantBeds === 1 ? "bed" : "beds"} at
              today&apos;s rates.{" "}
              {vacancy.unpricedBeds > 0 &&
                `${vacancy.unpricedBeds} more have no rate set, so are not counted. `}
              <Link href="/occupancy" className="font-medium underline">
                See vacant beds
              </Link>
            </dd>
          </div>
        )}
        {overdue > 0 && (
          <div>
            <dt className="text-sm text-amber-800">Overdue rent</dt>
            <dd className="mt-1 text-2xl font-semibold text-amber-950">{formatPaise(overdue)}</dd>
            <dd className="mt-0.5 text-xs text-amber-800">
              Owed by {overdueResidents} {overdueResidents === 1 ? "resident" : "residents"}.{" "}
              <Link href="/fees/reminders" className="font-medium underline">
                Send reminders
              </Link>
            </dd>
          </div>
        )}
      </dl>
    </section>
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
  const [activity, overdue] = await Promise.all([
    getRecentActivity(supabase, hostelId),
    getOverdueResidents(supabase, hostelId),
  ]);
  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <ActivityPanel items={activity} now={new Date()} />
      <OverduePanel residents={overdue.residents} total={overdue.total} today={today} />
    </div>
  );
}
