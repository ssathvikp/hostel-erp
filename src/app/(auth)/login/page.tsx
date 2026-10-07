import type { Metadata } from "next";
import Link from "next/link";

import { Alert } from "@/components/ui";
import { AuthHeading } from "@/features/auth/components/AuthHeading";
import { LoginForm } from "@/features/auth/components/LoginForm";
import { safeNextPath } from "@/lib/auth/redirect";

export const metadata: Metadata = { title: "Sign in" };

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string; error?: string }>;
}) {
  const { next, error } = await searchParams;

  return (
    <>
      <AuthHeading title="Sign in">Welcome back. Sign in to manage your hostel.</AuthHeading>

      {error === "link_invalid" && (
        <Alert tone="error" className="mb-4">
          That link has expired or was already used. Sign in below, or sign up again to get a new
          confirmation email.
        </Alert>
      )}

      <LoginForm next={next ? safeNextPath(next) : undefined} />

      <p className="mt-6 text-center text-sm text-slate-600">
        New to Hostel ERP?{" "}
        <Link href="/signup" className="font-medium text-brand-700 hover:underline">
          Create an account
        </Link>
      </p>
    </>
  );
}
