import type { Metadata } from "next";

import { Alert, Badge, EmptyState, Table, TBody, Td, Th, THead, Tr } from "@/components/ui";
import {
  AddToHostelButton,
  RemoveUnavailableButton,
  UnavailableDialog,
  WorkerActiveToggle,
  WorkerDialog,
} from "@/features/complaints/components/WorkerForms";
import { TRADE_LABELS, WORKER_KIND_LABELS } from "@/features/complaints/options";
import { getOtherWorkers, getWorkers } from "@/features/complaints/queries";
import { requireActiveHostel } from "@/lib/hostels/active";
import { formatPaise } from "@/lib/money";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Workers" };

const day = new Intl.DateTimeFormat("en-IN", { day: "numeric", month: "short", timeZone: "UTC" });

/**
 * The people who fix things (E15-T6): the hostel's own staff and the outside
 * vendors it calls. Complaints are routed to them by trade (E15-T7).
 */
export default async function WorkersPage() {
  const { user, hostel } = await requireActiveHostel();
  const supabase = await createClient();
  const isOwner = user.role === "owner";
  const [workers, others] = await Promise.all([
    getWorkers(supabase, hostel.id),
    isOwner ? getOtherWorkers(supabase, user.id, hostel.id) : Promise.resolve([]),
  ]);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold text-slate-900">Workers</h2>
          <p className="text-sm text-slate-600">
            Electricians, plumbers and others who fix things at {hostel.name}.
          </p>
        </div>
        {isOwner && <WorkerDialog />}
      </div>

      {!isOwner && <Alert tone="info">Only the owner can add or change workers.</Alert>}

      {workers.length === 0 ? (
        <EmptyState
          title="No workers yet"
          description="Add your caretaker and the vendors you already call. New complaints then reach the right person without anyone deciding who to phone."
        />
      ) : (
        <Table caption="Workers">
          <THead>
            <tr>
              <Th>Name</Th>
              <Th>Trades</Th>
              <Th>Phone</Th>
              <Th className="text-right">Open jobs</Th>
              <Th>Away</Th>
              {isOwner && (
                <Th>
                  <span className="sr-only">Actions</span>
                </Th>
              )}
            </tr>
          </THead>
          <TBody>
            {workers.map((worker) => (
              <Tr key={worker.id} className={worker.active ? undefined : "text-slate-400"}>
                <Td className="whitespace-normal">
                  <span className="font-medium">{worker.name}</span>
                  <span className="block text-xs text-slate-500">
                    {WORKER_KIND_LABELS[worker.kind]}
                    {worker.businessName && ` · ${worker.businessName}`}
                    {worker.callOutCharge != null &&
                      ` · ${formatPaise(worker.callOutCharge)} call-out`}
                  </span>
                  {!worker.active && <Badge>No new jobs</Badge>}
                </Td>
                <Td className="whitespace-normal">
                  {worker.trades.map((trade) => (
                    <span key={trade} className="mr-1 inline-block">
                      <Badge tone={worker.preferredTrades.includes(trade) ? "info" : "neutral"}>
                        {TRADE_LABELS[trade]}
                        {worker.preferredTrades.includes(trade) && " · first choice"}
                      </Badge>
                    </span>
                  ))}
                </Td>
                <Td>{worker.phone}</Td>
                <Td className="text-right tabular-nums">{worker.openJobs}</Td>
                <Td className="whitespace-normal">
                  {worker.unavailable.length === 0 ? (
                    <span className="text-slate-500">—</span>
                  ) : (
                    <ul className="space-y-1">
                      {worker.unavailable.map((range) => {
                        const label = `${day.format(new Date(range.from))} to ${day.format(new Date(range.to))}`;
                        return (
                          <li key={range.id} className="text-sm">
                            {label}
                            {range.reason && (
                              <span className="text-slate-500"> · {range.reason}</span>
                            )}
                            {isOwner && (
                              <RemoveUnavailableButton
                                id={range.id}
                                label={`time off ${label} for ${worker.name}`}
                              />
                            )}
                          </li>
                        );
                      })}
                    </ul>
                  )}
                </Td>
                {isOwner && (
                  <Td className="space-x-1 text-right">
                    <WorkerDialog worker={worker} />
                    <UnavailableDialog worker={worker} />
                    <WorkerActiveToggle worker={worker} />
                  </Td>
                )}
              </Tr>
            ))}
          </TBody>
        </Table>
      )}

      {others.length > 0 && (
        <section aria-labelledby="other-workers-heading" className="space-y-2">
          <h3 id="other-workers-heading" className="text-sm font-semibold text-slate-900">
            Your workers at other hostels
          </h3>
          <ul className="divide-y divide-slate-100 rounded-lg border border-slate-200 bg-white">
            {others.map((worker) => (
              <li key={worker.id} className="flex items-center justify-between gap-3 px-4 py-2">
                <span className="text-sm">
                  <span className="font-medium">{worker.name}</span>{" "}
                  <span className="text-slate-500">
                    {worker.trades.map((trade) => TRADE_LABELS[trade]).join(", ")}
                  </span>
                </span>
                <AddToHostelButton id={worker.id} name={worker.name} />
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
