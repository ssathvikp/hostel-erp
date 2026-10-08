import type { Metadata } from "next";
import Link from "next/link";

import { Alert } from "@/components/ui";
import { AuthHeading } from "@/features/auth/components/AuthHeading";
import { ResetPasswordForm } from "@/features/auth/components/ResetPasswordForm";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Choose a new password" };

/**
 * Reached from the reset email via /auth/confirm, which starts a recovery
 * session. Without that session there is nothing to reset.
 */
export default async function ResetPasswordPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return (
      <>
        <AuthHeading title="Link expired" />
        <Alert tone="error">
          Your reset link has expired or was already used.{" "}
          <Link href="/forgot-password" className="font-medium underline">
            Request a new one
          </Link>
          .
        </Alert>
      </>
    );
  }

  return (
    <>
      <AuthHeading title="Choose a new password">
        Other devices signed in to your account will be signed out.
      </AuthHeading>
      <ResetPasswordForm />
    </>
  );
}
