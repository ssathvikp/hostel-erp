import Link from "next/link";
import type { ReactNode } from "react";

/** Centred card layout shared by sign-in, sign-up and password pages. */
export default function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-dvh flex-col items-center justify-center bg-slate-50 px-4 py-12">
      <Link href="/login" className="mb-8 flex items-center gap-2 rounded-md">
        <span className="grid size-9 place-items-center rounded-md bg-brand-600 text-base font-bold text-white">
          H
        </span>
        <span className="text-lg font-semibold text-slate-900">Hostel ERP</span>
      </Link>
      <main className="w-full max-w-sm rounded-lg border border-slate-200 bg-white p-6 shadow-sm sm:p-8">
        {children}
      </main>
    </div>
  );
}
