"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";

import { focusRing } from "@/components/ui";
import { signOut } from "@/features/auth/actions";
import { cn } from "@/lib/cn";

const NAV = [
  { href: "/admin", label: "Overview" },
  { href: "/admin/customers", label: "Owners" },
  { href: "/admin/hostels", label: "Hostels" },
  { href: "/admin/billing", label: "Billing" },
  { href: "/admin/audit", label: "Audit log" },
  { href: "/admin/announcements", label: "Announcements" },
  { href: "/admin/requests", label: "Data requests" },
] as const;

/**
 * The platform admin area's own chrome (E10-T2): no hostel switcher, no
 * tenant navigation, and a colour that makes it obvious where you are.
 */
export function AdminShell({ email, children }: { email: string; children: ReactNode }) {
  const pathname = usePathname();
  return (
    <div className="min-h-dvh bg-slate-50">
      <a
        href="#main"
        className="sr-only z-50 rounded-md bg-white px-3 py-2 text-sm font-medium focus:not-sr-only focus:fixed focus:top-2 focus:left-2"
      >
        Skip to content
      </a>
      <header className="bg-slate-900 text-white">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-x-6 gap-y-2 px-4 py-3 sm:px-6">
          <Link
            href="/admin"
            className={cn("flex items-center gap-2 rounded-md font-semibold", focusRing)}
          >
            <span className="grid size-7 place-items-center rounded-md bg-amber-400 text-sm font-bold text-slate-900">
              A
            </span>
            Hostel ERP admin
          </Link>
          <nav aria-label="Admin" className="flex-1">
            <ul className="flex flex-wrap gap-1">
              {NAV.map((item) => {
                const active =
                  item.href === "/admin"
                    ? pathname === "/admin"
                    : pathname === item.href || pathname.startsWith(`${item.href}/`);
                return (
                  <li key={item.href}>
                    <Link
                      href={item.href}
                      aria-current={active ? "page" : undefined}
                      className={cn(
                        "block rounded-md px-3 py-1.5 text-sm font-medium",
                        focusRing,
                        active ? "bg-white/15 text-white" : "text-slate-300 hover:text-white",
                      )}
                    >
                      {item.label}
                    </Link>
                  </li>
                );
              })}
            </ul>
          </nav>
          <div className="flex items-center gap-3 text-sm">
            <span className="text-slate-300">{email}</span>
            <form action={signOut}>
              <button
                type="submit"
                className={cn("rounded-md px-2 py-1 font-medium hover:bg-white/10", focusRing)}
              >
                Sign out
              </button>
            </form>
          </div>
        </div>
      </header>
      <main id="main" className="mx-auto max-w-6xl px-4 py-6 sm:px-6 lg:py-8">
        {children}
      </main>
    </div>
  );
}
