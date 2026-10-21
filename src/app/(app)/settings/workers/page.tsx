import type { Metadata } from "next";

import { Badge, EmptyState } from "@/components/ui";
import { InlineAction } from "@/features/complaints/components/ComplaintActions";
import { TimeOffForm, WorkerForm } from "@/features/complaints/components/WorkerForms";
import { removeWorkerTimeOff, setWorkerActive } from "@/features/complaints/actions";
import { TRADE_LABELS } from "@/features/complaints/options";
import { getWorkers } from "@/features/complaints/queries";
import { requireActiveHostel } from "@/lib/hostels/active";
import { formatPaise } from "@/lib/money";
import { createClient } from "@/lib/supabase/server";
import { todayIst } from "@/lib/validation";

export const metadata: Metadata = { title: "Workers" };

const day = new Intl.DateTimeFormat("en-IN", { dateStyle: "medium", timeZone: "UTC" });

/**
 * Who fixes things (ClickUp EP-15 T6): on-site staff and outside vendors,
 * their trades and their time off. Complaints are routed to them by trade.
 */
export default async function WorkersPage() {
  const { user, hostel } = await requireActiveHostel();
  const isOwner = user.role === "owner";
  const supabase = await createClient();
  const workers = await getWorkers(supabase, hostel.id);
  const today = todayIst();

  return (
    <div className="max-w-4xl space-y-6">
      <div>
        <h2 className="text-lg font-semibold text-slate-900">Workers</h2>
        <p className="mt-1 text-sm text-slate-600">
          Electricians, plumbers and others who fix things. Vendors are shared across all your
          hostels; on-site staff belong to this one.
        </p>
      </div>

      {workers.length === 0 ? (
        <EmptyState
          title="No workers yet"
          description={
            isOwner
              ? "Add the people you call for repairs."
              : "The owner has not added any workers."
          }
        />
      ) : (
        <ul className="space-y-3">
          {workers.map((worker) => {
            const away = worker.timeOff.find(
              (entry) => entry.fromDate <= today && entry.toDate >= today,
            );
            return (
              <li
                key={worker.id}
                className="min-w-0 space-y-3 rounded-lg border border-slate-200 bg-white p-4 shadow-xs"
              >
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="font-medium text-slate-900">
                      {worker.fullName}
                      {worker.businessName && (
                        <span className="font-normal text-slate-600"> · {worker.businessName}</span>
                      )}
                    </p>
                    <p className="text-sm text-slate-600">
                      {worker.kind === "vendor" ? "Vendor" : "On-site"} ·{" "}
                      {worker.trades.map((trade) => TRADE_LABELS[trade]).join(", ")} ·{" "}
                      <span className="font-mono">{worker.phone}</span>
                      {worker.callOutCharge != null &&
                        ` · call-out ${formatPaise(worker.callOutCharge)}`}
                    </p>
                    <div className="mt-1 flex flex-wrap gap-1">
                      {worker.preferred && <Badge tone="info">Preferred</Badge>}
                      {!worker.active && <Badge>Not taking jobs</Badge>}
                      {away && (
                        <Badge tone="warning">Away until {day.format(new Date(away.toDate))}</Badge>
                      )}
                      <Badge>
                        {worker.openJobs} open {worker.openJobs === 1 ? "job" : "jobs"}
                      </Badge>
                    </div>
                  </div>
                  {isOwner && (
                    <InlineAction
                      action={setWorkerActive}
                      fields={{ worker_id: worker.id, active: String(!worker.active) }}
                      label={worker.active ? "Stop jobs" : "Take jobs again"}
                      ariaLabel={`${worker.active ? "Stop jobs for" : "Give jobs again to"} ${worker.fullName}`}
                    />
                  )}
                </div>
                {worker.timeOff.filter((entry) => entry.toDate >= today).length > 0 && (
                  <ul className="space-y-1 text-sm text-slate-700">
                    {worker.timeOff
                      .filter((entry) => entry.toDate >= today)
                      .map((entry) => (
                        <li key={entry.id} className="flex flex-wrap items-center gap-2">
                          Away {day.format(new Date(entry.fromDate))} to{" "}
                          {day.format(new Date(entry.toDate))}
                          {entry.reason && ` (${entry.reason})`}
                          {isOwner && (
                            <InlineAction
                              action={removeWorkerTimeOff}
                              fields={{ time_off_id: entry.id }}
                              label="Remove"
                              ariaLabel={`Remove time off for ${worker.fullName}`}
                            />
                          )}
                        </li>
                      ))}
                  </ul>
                )}
                {isOwner && (
                  <details className="text-sm">
                    <summary className="cursor-pointer font-medium text-brand-700">
                      Edit or add time off
                    </summary>
                    <div className="mt-3 space-y-6">
                      <WorkerForm worker={worker} />
                      <TimeOffForm workerId={worker.id} />
                    </div>
                  </details>
                )}
              </li>
            );
          })}
        </ul>
      )}

      {isOwner && (
        <section
          aria-labelledby="add-worker-heading"
          className="rounded-lg border border-slate-200 bg-white p-5 shadow-xs sm:p-6"
        >
          <h3 id="add-worker-heading" className="mb-4 text-base font-semibold text-slate-900">
            Add a worker
          </h3>
          <WorkerForm />
        </section>
      )}
    </div>
  );
}
