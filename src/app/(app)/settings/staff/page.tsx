import type { Metadata } from "next";

import { PageHeader } from "@/components/shell/PageHeader";
import { Alert, EmptyState } from "@/components/ui";
import { InviteStaffForm } from "@/features/staff/components/InviteStaffForm";
import { StaffList } from "@/features/staff/components/StaffList";
import { getStaff } from "@/features/staff/queries";
import { requireActiveHostel } from "@/lib/hostels/active";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Staff" };

/** Owners invite and remove the people who work in the hostel (EP-12). */
export default async function StaffSettingsPage() {
  const { user, hostel } = await requireActiveHostel();

  if (user.role !== "owner") {
    return (
      <div className="max-w-4xl space-y-6">
        <PageHeader title="Staff" />
        <Alert tone="info">Only the hostel owner can manage staff.</Alert>
      </div>
    );
  }

  const staff = await getStaff(await createClient(), hostel.id);

  return (
    <div className="max-w-4xl space-y-6">
      <PageHeader
        title="Staff"
        description="Staff can register residents, allocate beds and record payments. They cannot change rates, generate or void invoices, or edit hostel settings."
      />

      <section
        aria-labelledby="invite-staff"
        className="rounded-lg border border-slate-200 bg-white p-5 shadow-xs sm:p-6"
      >
        <h2 id="invite-staff" className="mb-4 text-base font-semibold text-slate-900">
          Invite a staff member
        </h2>
        <InviteStaffForm />
      </section>

      <section aria-labelledby="staff-list">
        <h2 id="staff-list" className="mb-3 text-base font-semibold text-slate-900">
          People with access to {hostel.name}
        </h2>
        {staff.length === 0 ? (
          <EmptyState
            title="No staff yet"
            description="Invite a warden or manager so they can work in the app with their own login."
          />
        ) : (
          <StaffList staff={staff} />
        )}
      </section>
    </div>
  );
}
