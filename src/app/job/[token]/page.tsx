import type { Metadata } from "next";

import { JobActions } from "@/features/complaints/components/JobActions";
import { MediaUpload } from "@/features/complaints/components/MediaUpload";
import { complaintNumber, PRIORITY_LABELS, type Priority } from "@/features/complaints/options";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Job", robots: { index: false, follow: false } };

interface Job {
  number: number;
  state: string;
  title: string;
  description: string | null;
  priority: Priority;
  category: string;
  hostel: string;
  address: string;
  hostel_phone: string;
  room: string | null;
  floor: number | null;
  bed: string | null;
  area: string | null;
  resident_name: string | null;
  resident_phone: string | null;
  worker: string;
  attachments: { id: string; mime_type: string; stage: string }[];
}

/**
 * A worker's view of one job, opened from the link the hostel sent them
 * (ClickUp EP-15 T8). No account is needed; the token is the key, and it
 * shows this job only.
 */
export default async function JobPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const supabase = await createClient();
  const { data } = await supabase.rpc("job_view", { p_token: token });
  const job = data as Job | null;

  if (!job) {
    return (
      <main className="mx-auto max-w-lg px-4 py-12">
        <h1 className="text-xl font-semibold text-slate-900">This job link no longer works</h1>
        <p className="mt-2 text-sm text-slate-600">
          The job may be finished or given to someone else. Ask the hostel for a new link.
        </p>
      </main>
    );
  }

  const where = job.room
    ? `Room ${job.room}${job.floor !== null ? `, floor ${job.floor}` : ""}${job.bed ? `, ${job.bed}` : ""}`
    : job.area;

  return (
    <main className="mx-auto max-w-lg space-y-6 px-4 py-8">
      <div>
        <p className="text-sm text-slate-600">
          {job.hostel} · {complaintNumber(job.number)}
        </p>
        <h1 className="mt-1 text-2xl font-semibold text-slate-900">{job.title}</h1>
        <p className="mt-1 text-sm text-slate-700">
          {job.category} · {PRIORITY_LABELS[job.priority]} priority
        </p>
      </div>
      <dl className="grid grid-cols-[6rem_1fr] gap-x-3 gap-y-2 rounded-lg border border-slate-200 bg-white p-4 text-sm">
        <dt className="text-slate-500">Hello</dt>
        <dd>{job.worker}</dd>
        <dt className="text-slate-500">Where</dt>
        <dd>{where}</dd>
        <dt className="text-slate-500">Address</dt>
        <dd>{job.address || "—"}</dd>
        <dt className="text-slate-500">Hostel</dt>
        <dd className="font-mono">{job.hostel_phone}</dd>
        {job.resident_name && (
          <>
            <dt className="text-slate-500">Resident</dt>
            <dd>
              {job.resident_name}
              {job.resident_phone && <span className="block font-mono">{job.resident_phone}</span>}
            </dd>
          </>
        )}
      </dl>
      {job.description && (
        <p className="text-sm whitespace-pre-line text-slate-800">{job.description}</p>
      )}
      {job.attachments.length > 0 && (
        <div className="flex flex-wrap gap-3">
          {job.attachments.map((file) =>
            file.mime_type.startsWith("image/") ? (
              <a
                key={file.id}
                href={`/job/${token}/media/${file.id}`}
                target="_blank"
                rel="noopener noreferrer"
              >
                {/* eslint-disable-next-line @next/next/no-img-element -- signed URLs from a private bucket */}
                <img
                  src={`/job/${token}/media/${file.id}`}
                  alt="Photo from the complaint"
                  className="size-24 rounded-md border border-slate-200 object-cover"
                />
              </a>
            ) : (
              <a
                key={file.id}
                href={`/job/${token}/media/${file.id}`}
                target="_blank"
                rel="noopener noreferrer"
                className="flex size-24 items-center justify-center rounded-md border border-slate-200 text-sm text-brand-700"
              >
                Play video
              </a>
            ),
          )}
        </div>
      )}
      <JobActions token={token} state={job.state} />
      {job.state !== "sent" && (
        <MediaUpload
          endpoint={`/job/${token}/media`}
          stage="completion"
          label="Add photos of the fix"
        />
      )}
    </main>
  );
}
