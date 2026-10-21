import Link from "next/link";

import { createClient } from "@/lib/supabase/server";

import { getComplaintQueue } from "../queries";

function Count({
  label,
  value,
  href,
  alert,
}: {
  label: string;
  value: number;
  href: string;
  alert?: boolean;
}) {
  return (
    <Link
      href={href}
      className="rounded-md border border-slate-200 p-3 hover:border-brand-300 hover:bg-brand-50"
    >
      <span className="block text-sm text-slate-600">{label}</span>
      <span
        className={`mt-1 block text-xl font-semibold tabular-nums ${alert && value > 0 ? "text-red-700" : "text-slate-900"}`}
      >
        {value}
      </span>
    </Link>
  );
}

/** The dashboard's complaints card: what is open, late, urgent or waiting for a worker (ClickUp EP-15 T10). */
export async function ComplaintQueue({ hostelId }: { hostelId: string }) {
  const queue = await getComplaintQueue(await createClient(), hostelId);
  return (
    <section
      aria-labelledby="complaint-queue-heading"
      className="rounded-lg border border-slate-200 bg-white p-5 shadow-xs sm:p-6"
    >
      <div className="mb-4 flex items-center justify-between gap-3">
        <h2 id="complaint-queue-heading" className="text-base font-semibold text-slate-900">
          Complaints
        </h2>
        <Link href="/complaints/new" className="text-sm font-medium text-brand-700 hover:underline">
          Raise complaint
        </Link>
      </div>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Count label="Open" value={queue.open} href="/complaints" />
        <Count label="Late" value={queue.late} href="/complaints?late=1" alert />
        <Count label="Urgent" value={queue.urgent} href="/complaints?priority=urgent" alert />
        <Count
          label="Need a worker"
          value={queue.needsWorker}
          href="/complaints?unassigned=1"
          alert
        />
      </div>
    </section>
  );
}
