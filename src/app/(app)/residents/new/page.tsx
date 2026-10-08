import type { Metadata } from "next";

import { PageHeader } from "@/components/shell/PageHeader";
import { ResidentForm } from "@/features/residents/components/ResidentForm";
import { requireActiveHostel } from "@/lib/hostels/active";

export const metadata: Metadata = { title: "Register resident" };

/** Resident registration (E5-T2). Owners and staff. */
export default async function NewResidentPage() {
  const { hostel } = await requireActiveHostel();

  return (
    <div className="max-w-3xl">
      <PageHeader title="Register resident" description={`New resident at ${hostel.name}.`} />
      <div className="rounded-lg border border-slate-200 bg-white p-6 shadow-xs sm:p-8">
        <ResidentForm />
      </div>
    </div>
  );
}
