import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";

import { PageHeader } from "@/components/shell/PageHeader";
import { MfaForm } from "@/features/admin/components/MfaForm";
import { requireUser } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Confirm sign-in" };

/**
 * Admins confirm every sign-in with an authenticator app (ClickUp E10-T1).
 * Until they do, every admin page sends them here and every admin function
 * refuses them.
 */
export default async function AdminMfaPage() {
  const user = await requireUser();
  if (user.role !== "platform_admin") notFound();
  const supabase = await createClient();
  const { data: level } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
  if (level?.currentLevel === "aal2") redirect("/admin");
  const { data: factors } = await supabase.auth.mfa.listFactors();
  const verified = factors?.totp.find((factor) => factor.status === "verified") ?? null;

  return (
    <div className="mx-auto max-w-md space-y-6">
      <PageHeader
        title={verified ? "Confirm it's you" : "Set up your authenticator"}
        description={
          verified
            ? "Enter the code from your authenticator app to open the admin console."
            : "The admin console sees every hostel, so it needs a second step at sign-in."
        }
      />
      <div className="rounded-lg border border-slate-200 bg-white p-5 shadow-xs sm:p-6">
        <MfaForm factorId={verified?.id ?? null} />
      </div>
    </div>
  );
}
