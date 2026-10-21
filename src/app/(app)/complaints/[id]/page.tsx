import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import type { ReactNode } from "react";

import { PageHeader } from "@/components/shell/PageHeader";
import { Alert, Table, TBody, Td, Th, THead, Tr } from "@/components/ui";
import {
  AssignForm,
  CommentForm,
  CostForm,
  JobLinkButton,
  PayoutForm,
  StatusForm,
  VoidCostForm,
} from "@/features/complaints/components/ComplaintActions";
import {
  PriorityBadge,
  StatusBadge,
  TargetBadge,
} from "@/features/complaints/components/ComplaintBadges";
import { MediaUpload } from "@/features/complaints/components/MediaUpload";
import {
  complaintNumber,
  COST_KIND_LABELS,
  EVENT_LABELS,
  STATUS_LABELS,
  TRADE_LABELS,
  type ComplaintStatus,
} from "@/features/complaints/options";
import { getComplaint, getWorkers } from "@/features/complaints/queries";
import { targetStates } from "@/features/complaints/targets";
import { PAYMENT_MODE_LABELS } from "@/features/fees/options";
import { requireActiveHostel } from "@/lib/hostels/active";
import { formatPaise } from "@/lib/money";
import { createClient } from "@/lib/supabase/server";
import { uuid } from "@/lib/validation";
import type { PaymentMode } from "@/types";

export const metadata: Metadata = { title: "Complaint" };

const when = new Intl.DateTimeFormat("en-IN", {
  dateStyle: "medium",
  timeStyle: "short",
  timeZone: "Asia/Kolkata",
});
const day = new Intl.DateTimeFormat("en-IN", { dateStyle: "medium", timeZone: "UTC" });

function Card({ title, id, children }: { title: string; id: string; children: ReactNode }) {
  return (
    <section
      aria-labelledby={id}
      className="min-w-0 space-y-4 rounded-lg border border-slate-200 bg-white p-5 shadow-xs sm:p-6"
    >
      <h2 id={id} className="text-lg font-semibold text-slate-900">
        {title}
      </h2>
      {children}
    </section>
  );
}

const TARGET_TEXT = {
  met: "Met",
  ok: "On track",
  near: "Due soon",
  missed: "Missed",
} as const;

/** One complaint: details, history, assignment, job link, files and costs (ClickUp EP-15). */
export default async function ComplaintPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ raised?: string }>;
}) {
  const { user, hostel } = await requireActiveHostel();
  const { id } = await params;
  const { raised } = await searchParams;
  if (!uuid("Complaint").safeParse(id).success) notFound();
  const supabase = await createClient();
  const [complaint, workers] = await Promise.all([
    getComplaint(supabase, hostel.id, id),
    getWorkers(supabase, hostel.id),
  ]);
  if (!complaint) notFound();

  const isOwner = user.role === "owner";
  const open = !["resolved", "closed"].includes(complaint.status);
  const workerOptions = workers
    .filter((worker) => worker.active)
    .map((worker) => ({
      id: worker.id,
      label: `${worker.fullName} (${worker.trades.map((trade) => TRADE_LABELS[trade]).join(", ")}${
        worker.trades.includes(complaint.trade) ? "" : ", other trade"
      })`,
    }));
  const targets = targetStates(complaint);
  const liveCosts = complaint.costs.filter((cost) => !cost.voidedAt);
  const costTotal = liveCosts.reduce((sum, cost) => sum + cost.amount, 0);
  const photos = complaint.attachments.filter((file) => file.mimeType.startsWith("image/"));
  const videos = complaint.attachments.filter((file) => file.mimeType.startsWith("video/"));

  return (
    <div className="max-w-5xl space-y-6">
      <Link href="/complaints" className="text-sm font-medium text-brand-700 hover:underline">
        ← All complaints
      </Link>
      <PageHeader
        title={complaint.title}
        description={
          <span className="flex flex-wrap items-center gap-2">
            <span className="font-mono">{complaintNumber(complaint.number)}</span>
            <span>{complaint.categoryName}</span>
            <span>{complaint.where}</span>
            <StatusBadge status={complaint.status} />
            <PriorityBadge priority={complaint.priority} />
            <TargetBadge complaint={complaint} />
          </span>
        }
      />
      {raised && (
        <Alert tone="success">
          {complaint.workerName
            ? `Complaint raised and assigned to ${complaint.workerName}.`
            : "Complaint raised. No available worker has the right trade yet; assign someone below."}
        </Alert>
      )}

      <div className="grid min-w-0 gap-6 lg:grid-cols-[1fr_20rem]">
        <div className="min-w-0 space-y-6">
          <Card title="Details" id="details-heading">
            <dl className="grid grid-cols-[8rem_1fr] gap-x-4 gap-y-2 text-sm">
              <dt className="text-slate-500">Where</dt>
              <dd>{complaint.where}</dd>
              <dt className="text-slate-500">Resident</dt>
              <dd>
                {complaint.residentId ? (
                  <Link
                    href={`/residents/${complaint.residentId}`}
                    className="text-brand-700 hover:underline"
                  >
                    {complaint.residentName}
                  </Link>
                ) : (
                  "—"
                )}
              </dd>
              <dt className="text-slate-500">Raised</dt>
              <dd>
                {when.format(new Date(complaint.createdAt))}
                {complaint.kind === "scheduled" && " (scheduled maintenance)"}
              </dd>
              <dt className="text-slate-500">Response</dt>
              <dd>
                {TARGET_TEXT[targets.response]}
                {complaint.respondBy && ` · target ${when.format(new Date(complaint.respondBy))}`}
              </dd>
              <dt className="text-slate-500">Fix</dt>
              <dd>
                {TARGET_TEXT[targets.resolution]}
                {complaint.resolveBy && ` · target ${when.format(new Date(complaint.resolveBy))}`}
                {complaint.holdSeconds > 0 &&
                  ` (paused ${Math.round(complaint.holdSeconds / 3600)} h on hold)`}
              </dd>
            </dl>
            {complaint.description && (
              <p className="text-sm whitespace-pre-line text-slate-800">{complaint.description}</p>
            )}
          </Card>

          <Card title="Photos and video" id="media-heading">
            {complaint.attachments.length === 0 ? (
              <p className="text-sm text-slate-600">No files yet.</p>
            ) : (
              <div className="flex flex-wrap gap-3">
                {photos.map((file) => (
                  <a
                    key={file.id}
                    href={`/complaints/${complaint.id}/media/${file.id}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="block"
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element -- signed URLs from a private bucket */}
                    <img
                      src={`/complaints/${complaint.id}/media/${file.id}`}
                      alt={
                        file.stage === "completion" ? "Photo of the fix" : "Photo of the problem"
                      }
                      className="size-28 rounded-md border border-slate-200 object-cover"
                    />
                  </a>
                ))}
                {videos.map((file) => (
                  <a
                    key={file.id}
                    href={`/complaints/${complaint.id}/media/${file.id}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex size-28 items-center justify-center rounded-md border border-slate-200 bg-slate-50 text-sm text-brand-700"
                  >
                    Play video
                  </a>
                ))}
              </div>
            )}
            {open && <MediaUpload endpoint={`/complaints/${complaint.id}/media`} />}
          </Card>

          <Card title="History" id="history-heading">
            <ol className="space-y-3 text-sm">
              {complaint.events.map((event) => (
                <li key={event.id} className="border-l-2 border-slate-200 pl-3">
                  <p className="text-slate-900">
                    <span className="font-medium">{EVENT_LABELS[event.kind] ?? event.kind}</span>
                    {event.kind === "status" && event.toStatus && (
                      <>
                        {": "}
                        {STATUS_LABELS[event.fromStatus as ComplaintStatus] ??
                          event.fromStatus} → {STATUS_LABELS[event.toStatus as ComplaintStatus]}
                      </>
                    )}
                    {(event.kind === "assigned" ||
                      event.kind === "unassigned" ||
                      event.kind === "declined") &&
                      event.workerId && (
                        <>
                          :{" "}
                          {workers.find((worker) => worker.id === event.workerId)?.fullName ??
                            "a worker"}
                        </>
                      )}
                  </p>
                  {event.body && <p className="whitespace-pre-line text-slate-700">{event.body}</p>}
                  <p className="text-xs text-slate-500">
                    {when.format(new Date(event.createdAt))} ·{" "}
                    {event.actorKind === "system"
                      ? "Automatic"
                      : event.actorKind === "worker"
                        ? `${event.actorName ?? "Worker"}, by job link`
                        : (event.actorName ?? "Team member")}
                  </p>
                </li>
              ))}
            </ol>
            <CommentForm complaintId={complaint.id} />
          </Card>

          <Card title="Costs" id="costs-heading">
            {complaint.costs.length > 0 && (
              <Table caption="Costs">
                <THead>
                  <tr>
                    <Th>Cost</Th>
                    <Th>Who pays</Th>
                    <Th className="text-right">Amount</Th>
                    {isOwner && (
                      <Th>
                        <span className="sr-only">Actions</span>
                      </Th>
                    )}
                  </tr>
                </THead>
                <TBody>
                  {complaint.costs.map((cost) => (
                    <Tr key={cost.id}>
                      <Td>
                        {COST_KIND_LABELS[cost.kind]}
                        {cost.description && (
                          <span className="block text-xs text-slate-500">{cost.description}</span>
                        )}
                        {cost.voidedAt && (
                          <span className="block text-xs text-red-700">
                            Void: {cost.voidReason}
                          </span>
                        )}
                      </Td>
                      <Td>{cost.payer === "resident" ? "Resident (next invoice)" : "Hostel"}</Td>
                      <Td
                        className={`text-right tabular-nums ${cost.voidedAt ? "line-through" : ""}`}
                      >
                        {formatPaise(cost.amount)}
                      </Td>
                      {isOwner && (
                        <Td>
                          {!cost.voidedAt && (
                            <VoidCostForm costId={cost.id} complaintId={complaint.id} />
                          )}
                        </Td>
                      )}
                    </Tr>
                  ))}
                </TBody>
              </Table>
            )}
            {costTotal > 0 && (
              <p className="text-sm text-slate-700">Total {formatPaise(costTotal)}.</p>
            )}
            <CostForm complaintId={complaint.id} hasResident={Boolean(complaint.residentId)} />
            {isOwner && (
              <div className="space-y-3 border-t border-slate-200 pt-4">
                <h3 className="text-sm font-semibold text-slate-900">Payouts to workers</h3>
                {complaint.payouts.length === 0 ? (
                  <p className="text-sm text-slate-600">Nothing paid out yet.</p>
                ) : (
                  <ul className="space-y-1 text-sm">
                    {complaint.payouts.map((payout) => (
                      <li key={payout.id}>
                        {formatPaise(payout.amount)} to {payout.workerName} on{" "}
                        {day.format(new Date(payout.paidAt))} by{" "}
                        {PAYMENT_MODE_LABELS[payout.mode as PaymentMode] ?? payout.mode}
                        {payout.reference && ` (${payout.reference})`}
                      </li>
                    ))}
                  </ul>
                )}
                {workerOptions.length > 0 && (
                  <PayoutForm
                    complaintId={complaint.id}
                    workers={workerOptions}
                    workerId={complaint.workerId}
                  />
                )}
              </div>
            )}
          </Card>
        </div>

        <aside className="min-w-0 space-y-6">
          <Card title="Status" id="status-heading">
            <StatusForm complaintId={complaint.id} status={complaint.status} />
          </Card>
          {open && (
            <Card title="Worker" id="worker-heading">
              {complaint.workerName ? (
                <p className="text-sm text-slate-800">
                  {complaint.workerName}
                  {complaint.workerPhone && (
                    <span className="block font-mono text-slate-600">{complaint.workerPhone}</span>
                  )}
                </p>
              ) : (
                <p className="text-sm text-amber-800">
                  {complaint.needsWorker
                    ? `Nobody available with the ${TRADE_LABELS[complaint.trade].toLowerCase()} trade.`
                    : "Not assigned yet."}
                </p>
              )}
              {workerOptions.length === 0 ? (
                <p className="text-sm text-slate-600">
                  {isOwner ? (
                    <>
                      Add workers in{" "}
                      <Link href="/settings/workers" className="text-brand-700 hover:underline">
                        Settings → Workers
                      </Link>
                      .
                    </>
                  ) : (
                    "The owner has not added any workers yet."
                  )}
                </p>
              ) : (
                <AssignForm
                  complaintId={complaint.id}
                  workers={workerOptions}
                  workerId={complaint.workerId}
                />
              )}
              {complaint.workerId && complaint.workerName && (
                <JobLinkButton complaintId={complaint.id} workerName={complaint.workerName} />
              )}
            </Card>
          )}
        </aside>
      </div>
    </div>
  );
}
