import type { Metadata } from "next";

import { PageHeader } from "@/components/shell/PageHeader";
import { buttonClass } from "@/components/ui";
import { CloseAccountForm } from "@/features/data-protection/components/DataForms";
import { HostelSettingsForm } from "@/features/hostels/components/HostelSettingsForm";
import { requireActiveHostel } from "@/lib/hostels/active";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Hostel settings" };

const at = new Intl.DateTimeFormat("en-IN", {
  dateStyle: "medium",
  timeStyle: "short",
  timeZone: "Asia/Kolkata",
});

/** Hostel details, always re-read from the database (E3-T5). */
export default async function HostelSettingsPage() {
  const { user, hostel } = await requireActiveHostel();

  const supabase = await createClient();
  const [
    { data, error },
    { data: visits, error: visitsError },
    { data: closure, error: closureError },
  ] = await Promise.all([
    supabase
      .from("hostels")
      .select("name, type, phone, alt_phone, email, address, city, state, pincode, gstin, floors")
      .eq("id", hostel.id)
      .single(),
    // Owners only: RLS returns support visits to the hostel's owner (E10-T5).
    supabase
      .from("admin_audit_log")
      .select("id, reason, created_at")
      .eq("hostel_id", hostel.id)
      .eq("action", "view_hostel")
      .order("created_at", { ascending: false })
      .limit(20),
    supabase
      .from("data_requests")
      .select("scheduled_for")
      .eq("kind", "account_closure")
      .eq("status", "scheduled")
      .maybeSingle(),
  ]);
  if (error) throw error;
  if (visitsError) throw visitsError;
  if (closureError) throw closureError;

  return (
    <div className="max-w-3xl">
      <PageHeader title="Hostel settings" description={`Details for ${data.name}.`} />
      <div className="rounded-lg border border-slate-200 bg-white p-6 shadow-xs sm:p-8">
        <HostelSettingsForm hostel={data} canEdit={user.role === "owner"} />
      </div>

      {user.role === "owner" && (
        <section aria-labelledby="support-access-heading" className="mt-8 space-y-3">
          <h2 id="support-access-heading" className="text-base font-semibold text-slate-900">
            Support access
          </h2>
          <p className="text-sm text-slate-600">
            Hostel ERP support can look at your hostel, read-only, when helping you. Every visit is
            listed here with its reason. Support can never change your data or open ID proofs.
          </p>
          {(visits ?? []).length === 0 ? (
            <p className="text-sm text-slate-600">Support has not viewed this hostel.</p>
          ) : (
            <ul className="divide-y divide-slate-100 rounded-lg border border-slate-200 bg-white text-sm">
              {(visits ?? []).map((visit) => (
                <li key={visit.id} className="px-4 py-2">
                  Hostel ERP support viewed your hostel on {at.format(new Date(visit.created_at))}
                  {visit.reason && <span className="text-slate-600">: {visit.reason}</span>}
                </li>
              ))}
            </ul>
          )}
        </section>
      )}

      {user.role === "owner" && (
        <section aria-labelledby="your-data-heading" className="mt-8 space-y-4">
          <h2 id="your-data-heading" className="text-base font-semibold text-slate-900">
            Your data
          </h2>
          <div className="space-y-2">
            <p className="text-sm text-slate-600">
              Download everything stored about {data.name}: rooms, residents, stays, invoices,
              payments and complaints, as one JSON file.
            </p>
            <a
              href="/settings/hostel/export"
              className={buttonClass({ variant: "secondary", size: "sm" })}
            >
              Download all data
            </a>
          </div>
          <div className="space-y-2 border-t border-slate-200 pt-4">
            <h3 className="text-sm font-semibold text-slate-900">Close your account</h3>
            <p className="text-sm text-slate-600">
              Your account closes 30 days after you ask, so you have time to download your data. You
              can change your mind until then.
            </p>
            <CloseAccountForm scheduledFor={closure?.scheduled_for ?? null} />
          </div>
        </section>
      )}
    </div>
  );
}
