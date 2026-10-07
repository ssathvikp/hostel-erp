import type { Metadata } from "next";

import { PageHeader } from "@/components/shell/PageHeader";
import { HostelSettingsForm } from "@/features/hostels/components/HostelSettingsForm";
import { requireActiveHostel } from "@/lib/hostels/active";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Hostel settings" };

/** Hostel details, always re-read from the database (E3-T5). */
export default async function HostelSettingsPage() {
  const { user, hostel } = await requireActiveHostel();

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("hostels")
    .select("name, type, phone, alt_phone, email, address, city, state, pincode, gstin, floors")
    .eq("id", hostel.id)
    .single();
  if (error) throw error;

  return (
    <div className="max-w-3xl">
      <PageHeader title="Hostel settings" description={`Details for ${data.name}.`} />
      <div className="rounded-lg border border-slate-200 bg-white p-6 shadow-xs sm:p-8">
        <HostelSettingsForm hostel={data} canEdit={user.role === "owner"} />
      </div>
    </div>
  );
}
