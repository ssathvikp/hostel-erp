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
  // An erased resident has nothing left to edit (E10-T10).
  if (!resident || resident.gender === null) notFound();

  return (
    <div className="max-w-3xl">
      <PageHeader title={`Edit ${resident.full_name}`} />
      <div className="rounded-lg border border-slate-200 bg-white p-6 shadow-xs sm:p-8">
        <ResidentForm
          resident={{
            ...resident,
            gender: resident.gender,
            dob: resident.dob!,
            id_proof_type: resident.id_proof_type!,
            id_proof_last4: resident.id_proof_last4!,
            phone: resident.phone!,
            permanent_address: resident.permanent_address!,
          }}
        />
      </div>
    </div>
  );
}
