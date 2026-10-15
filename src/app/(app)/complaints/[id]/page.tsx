import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import type { ReactNode } from "react";

import { PageHeader } from "@/components/shell/PageHeader";
import { Alert, Badge } from "@/components/ui";
import {
  AssignForm,
  CommentForm,
  CostsDialog,
  JobLinkPanel,
  PayoutDialog,
  PriorityForm,
  StatusButtons,
  UploadForm,
} from "@/features/complaints/components/ComplaintActions";
import {
  ComplaintStatusBadge,
  PriorityBadge,
  TargetBadge,
} from "@/features/complaints/components/ComplaintTable";
import { ComplaintTimeline } from "@/features/complaints/components/ComplaintTimeline";
import {
  PAYOUT_MODE_LABELS,
  TRADE_LABELS,
  WORKER_KIND_LABELS,
} from "@/features/complaints/options";
import { getComplaint, getWorkers } from "@/features/complaints/queries";
import { requireActiveHostel } from "@/lib/hostels/active";
import { formatPaise } from "@/lib/money";
import { fetchAllPages } from "@/lib/pagination";
import { createClient } from "@/lib/supabase/server";
import { uuid } from "@/lib/validation";

export const metadata: Metadata = { title: "Complaint" };

const at = new Intl.DateTimeFormat("en-IN", {
  dateStyle: "medium",
  timeStyle: "short",
  timeZone: "Asia/Kolkata",
});
const day = new Intl.DateTimeFormat("en-IN", { dateStyle: "medium", timeZone: "UTC" });

function Card({ title, children }: { title: string; children: ReactNode }) {
  const id = `${title.toLowerCase().replace(/\W+/g, "-")}-heading`;
  return (
    <section
      aria-labelledby={id}
      className="space-y-3 rounded-lg border border-slate-200 bg-white p-4 sm:p-5"
    >
      <h2 id={id} className="text-sm font-semibold text-slate-900">
        {title}
      </h2>
      {children}
    </section>
  );
}

function Fact({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <dt className="text-xs text-slate-500">{label}</dt>
      <dd className="text-sm text-slate-900">{children}</dd>
    </div>
  );
}

/**
 * One complaint (E15-T2): what and where, its worker and job link, targets,
 * photos, costs and the full history, with the actions each role may take.
 */
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
  const [complaint, workers, residents, { data: residentView }] = await Promise.all([
    getComplaint(supabase, hostel.id, id),
    getWorkers(supabase, hostel.id),
    fetchAllPages((first, last) =>
      supabase
        .from("resident_directory")
        .select("id, full_name")
        .eq("hostel_id", hostel.id)
        .in("status", ["active", "notice"])
        .order("full_name")
        .order("id")
        .range(first, last),
    ),
    // What the resident said about the fix (E15-T4).
    supabase
      .from("complaints")
      .select("source, resident_confirmed_at, resident_rating, resident_feedback")
      .eq("id", id)
      .eq("hostel_id", hostel.id)
      .maybeSingle(),
  ]);
  if (!complaint) notFound();

  const isOwner = user.role === "owner";
  const finished = complaint.status === "resolved" || complaint.status === "closed";
  const worker = workers.find((w) => w.id === complaint.workerId) ?? null;
  const workerOptions = workers
    .filter((w) => w.active || w.id === complaint.workerId)
    .map((w) => ({
      value: w.id,
      label: `${w.name} (${w.trades.map((t) => TRADE_LABELS[t]).join(", ")}) · ${w.openJobs} open`,
    }));
  const total = complaint.costs.labour + complaint.costs.material + complaint.costs.vendorCharge;
  const paid = complaint.payouts.reduce((sum, payout) => sum + payout.amount, 0);

  return (
    <div className="space-y-6">
      <div>
        <Link href="/complaints" className="text-sm font-medium text-brand-700 hover:underline">
          ← All complaints
        </Link>
        <div className="mt-2">
          <PageHeader
            title={`#${complaint.number} ${complaint.title}`}
            description={
              <>
                {complaint.categoryName} · {complaint.where}
                {complaint.kind === "scheduled" && " · Preventive maintenance"}
              </>
            }
          />
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <ComplaintStatusBadge status={complaint.status} />
          <PriorityBadge priority={complaint.priority} />
          <TargetBadge state={complaint.targetState} />
          {complaint.needsWorker && !complaint.workerId && (
            <Badge tone="danger">Needs a worker</Badge>
          )}
        </div>
        {raised && (
          <Alert tone="success" className="mt-4">
            Complaint raised.{" "}
            {complaint.workerName
              ? `It went to ${complaint.workerName}.`
              : "Nobody was available for it, so assign a worker below."}
          </Alert>
        )}
        {complaint.status === "on_hold" && complaint.holdReason && (
          <Alert tone="info" className="mt-4" title="On hold">
            {complaint.holdReason}
          </Alert>
        )}
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          <Card title="Details">
            {complaint.description && (
              <p className="text-sm whitespace-pre-line text-slate-700">{complaint.description}</p>
            )}
            <dl className="grid gap-3 sm:grid-cols-3">
              <Fact label="Raised">
                {at.format(new Date(complaint.createdAt))}
                {complaint.raisedByName && (
                  <span className="block text-xs text-slate-500">by {complaint.raisedByName}</span>
                )}
                {residentView?.source === "resident" && (
                  <span className="block text-xs text-slate-500">from the room&apos;s QR code</span>
                )}
              </Fact>
              {residentView?.resident_confirmed_at && (
                <Fact label="Resident confirmed the fix">
                  {at.format(new Date(residentView.resident_confirmed_at))}
                  {residentView.resident_rating && (
                    <span className="block text-xs text-slate-700">
                      Rated {residentView.resident_rating} out of 5
                    </span>
                  )}
                  {residentView.resident_feedback && (
                    <span className="block text-xs text-slate-500">
                      “{residentView.resident_feedback}”
                    </span>
                  )}
                </Fact>
              )}
              <Fact label="Respond by">
                {complaint.respondedAt ? (
                  <>Responded {at.format(new Date(complaint.respondedAt))}</>
                ) : (
                  at.format(new Date(complaint.respondDue))
                )}
              </Fact>
              <Fact label="Fix by">
                {complaint.resolvedAt ? (
                  <>Fixed {at.format(new Date(complaint.resolvedAt))}</>
                ) : (
                  at.format(new Date(complaint.resolveDue))
                )}
              </Fact>
              {complaint.roomId && (
                <Fact label="Room">
                  <Link
                    href={`/rooms/${complaint.roomId}`}
                    className="font-medium text-brand-700 hover:underline"
                  >
                    Room {complaint.roomNumber}
                  </Link>
                  {complaint.bedLabel && `, bed ${complaint.bedLabel}`}
                </Fact>
              )}
              {complaint.residentId && (
                <Fact label="Reported by">
                  <Link
                    href={`/residents/${complaint.residentId}`}
                    className="font-medium text-brand-700 hover:underline"
                  >
                    {complaint.residentName}
                  </Link>
                </Fact>
              )}
            </dl>
            <StatusButtons id={complaint.id} status={complaint.status} />
          </Card>

          <Card title="Photos and videos">
            {complaint.attachments.length === 0 ? (
              <p className="text-sm text-slate-600">None yet.</p>
            ) : (
              <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                {complaint.attachments.map((file) => (
                  <li key={file.id} className="space-y-1">
                    {file.url &&
                      (file.kind === "photo" ? (
                        <a href={file.url} target="_blank" rel="noreferrer">
                          {/* Signed URLs expire in minutes, so next/image caching does not apply. */}
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img
                            src={file.url}
                            alt={`Photo from ${file.uploadedBy}`}
                            className="aspect-square w-full rounded-md border border-slate-200 object-cover"
                          />
                        </a>
                      ) : (
                        <video
                          src={file.url}
                          controls
                          preload="metadata"
                          className="aspect-square w-full rounded-md border border-slate-200 bg-black"
                        />
                      ))}
                    <p className="text-xs text-slate-500">
                      {file.source === "worker" ? "Completion photo · " : ""}
                      {file.uploadedBy}
                    </p>
                  </li>
                ))}
              </ul>
            )}
            {!finished && <UploadForm id={complaint.id} />}
          </Card>

          <Card title="History">
            <ComplaintTimeline events={complaint.events} />
            <CommentForm id={complaint.id} />
          </Card>
        </div>

        <div className="space-y-6">
          <Card title="Worker">
            {worker ? (
              <dl className="space-y-2">
                <Fact label={WORKER_KIND_LABELS[worker.kind]}>
                  {worker.name}
                  {worker.businessName && (
                    <span className="block text-xs text-slate-500">{worker.businessName}</span>
                  )}
                </Fact>
                <Fact label="Phone">
                  <a href={`tel:+91${worker.phone}`} className="text-brand-700 hover:underline">
                    {worker.phone}
                  </a>
                </Fact>
              </dl>
            ) : (
              <p className="text-sm text-slate-600">
                {complaint.workerName ?? "Nobody is assigned yet."}
              </p>
            )}
            <AssignForm
              id={complaint.id}
              workerId={complaint.workerId}
              workers={workerOptions}
              finished={finished}
            />
            {workers.length === 0 && isOwner && (
              <p className="text-sm text-slate-600">
                <Link href="/settings/workers" className="text-brand-700 hover:underline">
                  Add your electrician, plumber and other workers
                </Link>{" "}
                so complaints reach them on their own.
              </p>
            )}
          </Card>

          {isOwner && worker?.kind === "vendor" && !finished && (
            <Card title="Job link">
              {complaint.jobLink && (
                <p className="text-xs text-slate-500">
                  Shared {at.format(new Date(complaint.jobLink.createdAt))}
                  {complaint.jobLink.acceptedAt
                    ? ` · accepted ${at.format(new Date(complaint.jobLink.acceptedAt))}`
                    : complaint.jobLink.lastSeenAt
                      ? ` · opened ${at.format(new Date(complaint.jobLink.lastSeenAt))}`
                      : " · not opened yet"}
                </p>
              )}
              <JobLinkPanel
                id={complaint.id}
                workerName={worker.name}
                workerPhone={worker.phone}
                hasLink={Boolean(complaint.jobLink)}
              />
            </Card>
          )}

          <Card title="Priority">
            <PriorityForm
              id={complaint.id}
              priority={complaint.priority}
              shareResidentPhone={complaint.shareResidentPhone}
              hasResident={Boolean(complaint.residentId)}
            />
          </Card>

          <Card title="Costs">
            <dl className="grid grid-cols-2 gap-2 text-sm">
              <Fact label="Labour">{formatPaise(complaint.costs.labour)}</Fact>
              <Fact label="Materials">{formatPaise(complaint.costs.material)}</Fact>
              <Fact label="Worker's charge">{formatPaise(complaint.costs.vendorCharge)}</Fact>
              <Fact label="Total">
                <span className="font-semibold">{formatPaise(total)}</span>
              </Fact>
            </dl>
            <p className="text-sm text-slate-600">
              {complaint.costs.payer === "resident"
                ? complaint.costs.chargeStatus === "invoiced"
                  ? "Charged to the resident and billed."
                  : "Charged to the resident on their next invoice."
                : "Paid by the hostel."}
            </p>
            {complaint.payouts.length > 0 && (
              <ul className="space-y-1 border-t border-slate-100 pt-2 text-sm">
                {complaint.payouts.map((payout) => (
                  <li key={payout.id} className="flex justify-between gap-2">
                    <span>
                      {day.format(new Date(payout.paidAt))} · {PAYOUT_MODE_LABELS[payout.mode]}
                    </span>
                    <span className="tabular-nums">{formatPaise(payout.amount)}</span>
                  </li>
                ))}
                <li className="flex justify-between gap-2 font-medium">
                  <span>Paid to worker</span>
                  <span className="tabular-nums">{formatPaise(paid)}</span>
                </li>
              </ul>
            )}
            {isOwner && (
              <div className="flex flex-wrap gap-2">
                <CostsDialog
                  id={complaint.id}
                  costs={complaint.costs}
                  residents={residents.map((r) => ({ value: r.id!, label: r.full_name! }))}
                  defaultResidentId={complaint.costs.chargeResidentId ?? complaint.residentId}
                />
                {worker && <PayoutDialog id={complaint.id} workerName={worker.name} />}
              </div>
            )}
          </Card>
        </div>
      </div>
    </div>
  );
}
