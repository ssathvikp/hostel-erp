import type { Metadata } from "next";
import Link from "next/link";

import { Alert } from "@/components/ui";
import { AuthHeading } from "@/features/auth/components/AuthHeading";
import { ForgotPasswordForm } from "@/features/auth/components/ForgotPasswordForm";

export const metadata: Metadata = { title: "Reset your password" };

export default async function ForgotPasswordPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const { error } = await searchParams;

  return (
    <>
      <AuthHeading title="Reset your password">
        Enter the email you signed up with and we will send you a reset link.
      </AuthHeading>

      {error === "link_invalid" && (
        <Alert tone="error" className="mb-4">
          That reset link has expired or was already used. Request a new one below.
        </Alert>
      )}

      <ForgotPasswordForm />

      <p className="mt-6 text-center text-sm text-slate-600">
        Remembered it?{" "}
        <Link href="/login" className="font-medium text-brand-700 hover:underline">
          Back to sign in
        </Link>
      </p>
    </>
  );
}
