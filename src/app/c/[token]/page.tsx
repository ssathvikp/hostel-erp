import type { Metadata } from "next";

import { Badge } from "@/components/ui";
import {
  COMPLAINT_STATUS_LABELS as STATUS_LABELS,
  COMPLAINT_STATUS_TONES as STATUS_TONES,
} from "@/features/complaints/options";
import { RespondToFix } from "@/features/resident-complaints/components/ResidentForms";
import { getResidentStatus } from "@/features/resident-complaints/queries";

export const metadata: Metadata = {
  title: "Your complaints",
  robots: { index: false, follow: false },
  referrer: "no-referrer",
};

export const dynamic = "force-dynamic";

const at = new Intl.DateTimeFormat("en-IN", {
  dateStyle: "medium",
  timeStyle: "short",
  timeZone: "Asia/Kolkata",
});

const STEP_LABELS: Record<string, string> = {
  created: "Reported",
  assigned: "Someone is assigned",
  in_progress: "Work started",
  on_hold: "On hold",
  resolved: "Marked fixed",
  closed: "Closed",
  reopened: "Reopened",
  confirmed: "You confirmed the fix",
};

/**
 * A resident's own complaints from the link texted to them (E15-T4): where
 * each one has got to, and for one marked fixed, whether it really is.
 */
export default async function ResidentStatusPage({
  params,
  searchParams,
}: {
  params: Promise<{ token: string }>;
  searchParams: Promise<{ raised?: string }>;
}) {
  const { token } = await params;
  const { raised } = await searchParams;
  const status = await getResidentStatus(token);

  return (
    <main className="mx-auto min-h-dvh max-w-md bg-slate-50 px-4 py-6">
      {!status ? (
        <div className="rounded-lg border border-slate-200 bg-white p-5 text-center">
          <h1 className="text-lg font-semibold text-slate-900">This link no longer works</h1>
          <p className="mt-2 text-sm text-slate-600">
            Scan the code in your room to report a problem, or ask the hostel office.
          </p>
        </div>
      ) : (
        <div className="space-y-4">
          <div>
            <p className="text-sm text-slate-500">{status.hostel_name}</p>
            <h1 className="text-xl font-semibold text-slate-900">
              {status.resident_name}&apos;s complaints
            </h1>
          </div>
          {raised && /^\d+$/.test(raised) && (
            <p
              role="status"
              className="rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800"
            >
              Complaint #{raised} is reported. We have sent this link to your phone so you can
              follow it.
            </p>
          )}
          {status.complaints.length === 0 ? (
            <p className="text-sm text-slate-600">No complaints in the last 90 days.</p>
          ) : (
            <ul className="space-y-3">
              {status.complaints.map((complaint) => (
                <li
                  key={complaint.id}
                  className="space-y-3 rounded-lg border border-slate-200 bg-white p-4"
                >
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <h2 className="font-semibold text-slate-900">
                        #{complaint.number} · {complaint.category}
                      </h2>
                      {complaint.description && (
                        <p className="text-sm text-slate-600">{complaint.description}</p>
                      )}
                    </div>
                    <Badge tone={STATUS_TONES[complaint.status]}>
                      {STATUS_LABELS[complaint.status]}
                    </Badge>
                  </div>
                  <ol className="space-y-1 border-l border-slate-200 pl-3 text-sm">
                    {complaint.steps.map((step, index) => (
                      <li key={index} className="text-slate-700">
                        {STEP_LABELS[step.kind === "status" ? (step.to ?? "") : step.kind] ??
                          step.kind}
                        {step.kind === "assigned" && complaint.worker && ` (${complaint.worker})`}
                        <span className="block text-xs text-slate-500">
                          {at.format(new Date(step.at))}
                        </span>
                      </li>
                    ))}
                  </ol>
                  {complaint.status === "resolved" && (
                    <div className="space-y-2 rounded-md bg-slate-50 p-3">
                      <p className="text-sm font-medium text-slate-900">Is it fixed?</p>
                      <RespondToFix token={token} complaintId={complaint.id} />
                    </div>
                  )}
                  {complaint.rating && (
                    <p className="text-xs text-slate-500">
                      You rated the fix {complaint.rating}/5.
                    </p>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </main>
  );
}
