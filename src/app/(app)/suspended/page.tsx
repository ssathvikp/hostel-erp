import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";

import { PageHeader } from "@/components/shell/PageHeader";
import { Alert, buttonClass } from "@/components/ui";
import { requireUser } from "@/lib/auth/session";
import { getHostelContext } from "@/lib/hostels/active";

export const metadata: Metadata = { title: "Hostel unavailable" };

/**
 * Shown when the user has no hostel they can work in because it was
 * suspended (EP-10). Owners see why; staff are told to ask their owner.
 */
export default async function SuspendedPage() {
  const user = await requireUser();
  if (user.role === "platform_admin") redirect("/admin");
  const { active, suspended } = await getHostelContext();
  if (active) redirect("/dashboard");

  return (
    <div className="max-w-2xl space-y-6">
      <PageHeader title="This hostel is unavailable" />
      {user.role === "owner" && suspended.length > 0 ? (
        <>
          {suspended.map((hostel) => (
            <Alert key={hostel.id} tone="warning" title={`${hostel.name} is suspended`}>
              {hostel.suspensionReason ?? "No reason was given."} Your data is kept safe. Contact
              Hostel ERP support to restore access.
            </Alert>
          ))}
          <p className="text-sm text-slate-600">
            While a hostel is suspended, nobody can open its rooms, residents or fees.
          </p>
          <Link href="/onboarding" className={buttonClass({ variant: "secondary" })}>
            Set up another hostel
          </Link>
        </>
      ) : (
        <Alert tone="info">
          The hostel you work in is not available right now. Ask the hostel owner for details.
        </Alert>
      )}
    </div>
  );
}
