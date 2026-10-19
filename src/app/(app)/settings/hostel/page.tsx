import type { Metadata } from "next";

import { PageHeader } from "@/components/shell/PageHeader";
import { buttonClass } from "@/components/ui";
import { HostelSettingsForm } from "@/features/hostels/components/HostelSettingsForm";
import { requireActiveHostel } from "@/lib/hostels/active";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Hostel settings" };

const moment = new Intl.DateTimeFormat("en-IN", {
  dateStyle: "medium",
  timeStyle: "short",
  timeZone: "Asia/Kolkata",
});

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
  const isOwner = user.role === "owner";
  // When Hostel ERP support looked inside the hostel, and why (ClickUp E10-T5).
  const { data: access, error: accessError } = isOwner
    ? await supabase
        .from("support_access")
        .select("id, admin_name, reason, opened_at")
        .eq("hostel_id", hostel.id)
        .order("opened_at", { ascending: false })
        .limit(10)
    : { data: [], error: null };
  if (accessError) throw accessError;

  return (
    <div className="max-w-3xl space-y-6">
      <PageHeader title="Hostel settings" description={`Details for ${data.name}.`} />
      <div className="rounded-lg border border-slate-200 bg-white p-6 shadow-xs sm:p-8">
        <HostelSettingsForm hostel={data} canEdit={isOwner} />
      </div>

      {isOwner && (
        <section
          aria-labelledby="export-heading"
          className="rounded-lg border border-slate-200 bg-white p-5 shadow-xs sm:p-6"
        >
          <h2 id="export-heading" className="text-base font-semibold text-slate-900">
            Download all your data
          </h2>
          <p className="mt-1 mb-4 text-sm text-slate-600">
            One file with every room, bed, resident, stay, invoice, payment and deposit entry in{" "}
            {data.name}. Keep it as a backup, or take it with you if you leave Hostel ERP.
          </p>
          <a href="/settings/hostel/export" className={buttonClass({ variant: "secondary" })}>
            Download data
          </a>
        </section>
      )}

      {isOwner && (
        <section aria-labelledby="support-access-heading">
          <h2 id="support-access-heading" className="mb-2 text-base font-semibold text-slate-900">
            Support access
          </h2>
          {access.length === 0 ? (
            <p className="text-sm text-slate-600">
              Hostel ERP support has not looked inside this hostel. If they ever do, to help you, it
              is listed here with the reason.
            </p>
          ) : (
            <ul className="divide-y divide-slate-100 rounded-lg border border-slate-200 bg-white text-sm shadow-xs">
              {access.map((row) => (
                <li key={row.id} className="px-4 py-3">
                  <span className="font-medium text-slate-900">
                    {moment.format(new Date(row.opened_at))}
                  </span>{" "}
                  · {row.admin_name} viewed your hostel (read-only): {row.reason}
                </li>
              ))}
            </ul>
          )}
        </section>
      )}
    </div>
  );
}
