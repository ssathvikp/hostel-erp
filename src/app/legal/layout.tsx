import Link from "next/link";
import type { ReactNode } from "react";

import { LegalFooter } from "@/components/shell/LegalFooter";

/**
 * Public legal pages (E14-T11): payment gateways activate live payments only
 * for sites that publish them, and the privacy policy is the DPDP Act notice.
 */
export default function LegalLayout({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-dvh bg-slate-50">
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-3xl items-center justify-between px-4 py-4">
          <Link href="/" className="flex items-center gap-2 rounded-md">
            <span className="grid size-8 place-items-center rounded-md bg-brand-600 text-sm font-bold text-white">
              H
            </span>
            <span className="font-semibold text-slate-900">Hostel ERP</span>
          </Link>
          <Link href="/login" className="text-sm font-medium text-brand-700 hover:underline">
            Sign in
          </Link>
        </div>
      </header>
      <main className="mx-auto max-w-3xl px-4 py-8">
        <article className="space-y-4 rounded-lg border border-slate-200 bg-white p-6 text-sm leading-6 text-slate-700 sm:p-8 [&_h1]:text-2xl [&_h1]:font-semibold [&_h1]:text-slate-900 [&_h2]:pt-2 [&_h2]:text-base [&_h2]:font-semibold [&_h2]:text-slate-900 [&_li]:ml-5 [&_li]:list-disc">
          {children}
        </article>
      </main>
      <LegalFooter />
    </div>
  );
}
