import type { Metadata } from "next";
import Link from "next/link";

import { AuthHeading } from "@/features/auth/components/AuthHeading";
import { SignupForm } from "@/features/auth/components/SignupForm";

export const metadata: Metadata = { title: "Create an account" };

export default function SignupPage() {
  return (
    <>
      <AuthHeading title="Create your account">
        Set up your hostel in minutes. You will add rooms and residents next.
      </AuthHeading>

      <SignupForm />

      <p className="mt-6 text-center text-sm text-slate-600">
        Already have an account?{" "}
        <Link href="/login" className="font-medium text-brand-700 hover:underline">
          Sign in
        </Link>
      </p>
    </>
  );
}
