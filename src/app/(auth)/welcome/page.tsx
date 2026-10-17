import type { Metadata } from "next";
import Link from "next/link";

import { Alert } from "@/components/ui";
import { AuthHeading } from "@/features/auth/components/AuthHeading";
import { AcceptInvitationForm } from "@/features/staff/components/AcceptInvitationForm";
import { getSessionUser } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Accept your invitation" };

/**
 * Reached from the staff invitation email via /auth/confirm, which signs the
 * invited person in. They choose a password here before using the app.
 */
export default async function WelcomePage() {
  const user = await getSessionUser();

  if (!user || user.role !== "staff" || !user.hostelId) {
    return (
      <>
        <AuthHeading title="Link expired" />
        <Alert tone="error">
          This invitation link has expired or was already used. Ask the hostel owner to send it
          again, or{" "}
          <Link href="/login" className="font-medium underline">
            sign in
          </Link>{" "}
          if you already chose a password.
        </Alert>
      </>
    );
  }

  const { data: hostel } = await (
    await createClient()
  )
    .from("hostels")
    .select("name")
    .eq("id", user.hostelId)
    .maybeSingle();

  return (
    <>
      <AuthHeading title={`Welcome, ${user.fullName}`}>
        You have been added as staff{hostel ? ` at ${hostel.name}` : ""}. Choose a password to
        finish setting up your account.
      </AuthHeading>
      <AcceptInvitationForm email={user.email} />
    </>
  );
}
