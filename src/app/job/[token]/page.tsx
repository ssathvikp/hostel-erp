import type { Metadata } from "next";
import type { ReactNode } from "react";

import { Badge } from "@/components/ui";
import { JobControls, JobPhotoUpload } from "@/features/complaints/components/JobControls";
import { getJob } from "@/features/complaints/job";
import { PRIORITY_LABELS, PRIORITY_TONES } from "@/features/complaints/options";

export const metadata: Metadata = {
  title: "Job",
  // The URL is the worker's key: keep it out of search engines and referrers.
  robots: { index: false, follow: false },
  referrer: "no-referrer",
};

export const dynamic = "force-dynamic";

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="py-2">
      <dt className="text-xs text-slate-500">{label}</dt>
      <dd className="text-sm text-slate-900">{children}</dd>
    </div>
  );
}

/**
 * The page an outside worker opens from their job link (E15-T8): one job,
 * no account. A dead link says so and nothing else.
 */
export default async function JobPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const job = await getJob(token);

  return (
    <main className="mx-auto min-h-dvh max-w-lg bg-slate-50 px-4 py-6">
      {!job ? (
        <div className="rounded-lg border border-slate-200 bg-white p-6 text-center">
          <h1 className="text-lg font-semibold text-slate-900">This link no longer works</h1>
          <p className="mt-2 text-sm text-slate-600">
            The job may have been finished or given to someone else. Ask the hostel for a new link.
          </p>
        </div>
      ) : (
        <div className="space-y-4">
          <div>
            <p className="text-sm text-slate-500">{job.hostelName}</p>
            <h1 className="text-xl font-semibold text-slate-900">
              Job #{job.number}: {job.title}
            </h1>
            <div className="mt-2 flex flex-wrap gap-2">
              <Badge tone={PRIORITY_TONES[job.priority]}>{PRIORITY_LABELS[job.priority]}</Badge>
              <Badge>{job.category}</Badge>
            </div>
          </div>

          <dl className="divide-y divide-slate-100 rounded-lg border border-slate-200 bg-white px-4">
            <Row label="Hello">{job.workerName}</Row>
            <Row label="Where">{job.where}</Row>
            <Row label="Address">
              {job.hostelAddress}
              <a
                href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(job.hostelAddress)}`}
                target="_blank"
                rel="noreferrer"
                className="block font-medium text-brand-700 hover:underline"
              >
                Open in Maps
              </a>
            </Row>
            {job.hostelPhone && (
              <Row label="Hostel phone">
                <a href={`tel:+91${job.hostelPhone}`} className="text-brand-700 hover:underline">
                  {job.hostelPhone}
                </a>
              </Row>
            )}
            {job.residentPhone && (
              <Row label="Resident">
                {job.residentName} ·{" "}
                <a href={`tel:+91${job.residentPhone}`} className="text-brand-700 hover:underline">
                  {job.residentPhone}
                </a>
              </Row>
            )}
            {job.description && (
              <Row label="Details">
                <span className="whitespace-pre-line">{job.description}</span>
              </Row>
            )}
          </dl>

          {job.attachments.length > 0 && (
            <ul className="grid grid-cols-3 gap-2">
              {job.attachments.map(
                (file) =>
                  file.url && (
                    <li key={file.id}>
                      {file.kind === "photo" ? (
                        <a href={file.url} target="_blank" rel="noreferrer">
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img
                            src={file.url}
                            alt={file.source === "worker" ? "Completion photo" : "Problem photo"}
                            className="aspect-square w-full rounded-md border border-slate-200 object-cover"
                          />
                        </a>
                      ) : (
                        <video
                          src={file.url}
                          controls
                          preload="metadata"
                          className="aspect-square w-full rounded-md bg-black"
                        />
                      )}
                    </li>
                  ),
              )}
            </ul>
          )}

          <section className="space-y-4 rounded-lg border border-slate-200 bg-white p-4">
            <JobControls
              token={token}
              status={job.status}
              accepted={job.accepted}
              vendorCharge={job.vendorCharge}
            />
            {job.accepted && job.status !== "closed" && <JobPhotoUpload token={token} />}
          </section>
        </div>
      )}
    </main>
  );
}
