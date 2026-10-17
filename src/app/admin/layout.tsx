import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import type { ReactNode } from "react";

import { Button } from "@/components/ui";
import { signOut } from "@/features/auth/actions";
import { requireUser } from "@/lib/auth/session";

export const metadata: Metadata = {
  title: { template: "%s · Admin · Hostel ERP", default: "Admin" },
};

/**
 * The platform admin console (EP-10). Separate from the hostel app: admins
 * belong to no hostel and never work inside one. Anyone else gets a 404.
 */
export default async function AdminLayout({ children }: { children: ReactNode }) {
  const user = await requireUser();
  if (user.role !== "platform_admin") notFound();

  return (
    <div className="min-h-dvh bg-slate-50">
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-4 py-3 sm:px-6">
          <Link href="/admin" className="flex items-center gap-2 rounded-md">
            <span className="grid size-8 place-items-center rounded-md bg-slate-900 text-sm font-bold text-white">
              H
            </span>
            <span className="font-semibold text-slate-900">Hostel ERP admin</span>
          </Link>
          <div className="flex items-center gap-3 text-sm text-slate-600">
            <span className="hidden sm:inline">{user.email}</span>
            <form action={signOut}>
              <Button type="submit" size="sm" variant="secondary">
                Sign out
              </Button>
            </form>
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-6xl px-4 py-6 sm:px-6">{children}</main>
    </div>
  );
}
