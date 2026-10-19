import type { Metadata } from "next";
import Link from "next/link";

import { AuthHeading } from "@/features/auth/components/AuthHeading";
import { SignupForm } from "@/features/auth/components/SignupForm";

export const metadata: Metadata = { title: "Create an account" };

export default async function SignupPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  // An owner's referral link: /signup?ref=CODE (plan E14-T12).
  const ref = (await searchParams).ref;
  const referralCode = typeof ref === "string" && /^[A-Za-z0-9]{8}$/.test(ref) ? ref : undefined;
  return (
    <>
      <AuthHeading title="Create your account">
        Set up your hostel in minutes. You will add rooms and residents next.
      </AuthHeading>

      {referralCode && (
        <p className="mb-4 rounded-md bg-brand-50 px-3 py-2 text-sm text-brand-700">
          You were invited by another hostel owner.
        </p>
      )}

      <SignupForm referralCode={referralCode} />

      <p className="mt-6 text-center text-sm text-slate-600">
        Already have an account?{" "}
        <Link href="/login" className="font-medium text-brand-700 hover:underline">
          Sign in
        </Link>
      </p>
    </>
  );
}
