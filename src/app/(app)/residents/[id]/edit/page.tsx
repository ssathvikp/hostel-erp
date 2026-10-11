import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { PageHeader } from "@/components/shell/PageHeader";
import { ResidentForm } from "@/features/residents/components/ResidentForm";
import { requireActiveHostel } from "@/lib/hostels/active";
import { createClient } from "@/lib/supabase/server";
import { uuid } from "@/lib/validation";

export const metadata: Metadata = { title: "Edit resident" };

/** Edit contact, address, guardian and notes (E5-T2). */
export default async function EditResidentPage({ params }: { params: Promise<{ id: string }> }) {
  const { hostel } = await requireActiveHostel();
  const { id } = await params;
  if (!uuid("Resident").safeParse(id).success) notFound();

  const supabase = await createClient();
  const { data: resident, error } = await supabase
    .from("residents")
    .select(
      "id, full_name, gender, dob, id_proof_type, id_proof_last4, phone, alt_phone, email, guardian_name, guardian_phone, permanent_address, notes",
    )
    .eq("id", id)
    .eq("hostel_id", hostel.id)
    .maybeSingle();
  if (error) throw error;
  if (!resident) notFound();

  return (
    <div className="max-w-3xl">
      <PageHeader title={`Edit ${resident.full_name}`} />
      <div className="rounded-lg border border-slate-200 bg-white p-6 shadow-xs sm:p-8">
        <ResidentForm resident={resident} />
      </div>
    </div>
  );
}
