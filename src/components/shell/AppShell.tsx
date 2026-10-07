"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState, type ReactNode } from "react";

import { focusRing } from "@/components/ui";
import { signOut } from "@/features/auth/actions";
import { HostelSwitcher, type SwitcherHostel } from "@/features/hostels/components/HostelSwitcher";
import { cn } from "@/lib/cn";

import { NAV_ITEMS } from "./nav";

function NavLinks({ onNavigate }: { onNavigate?: () => void }) {
  const pathname = usePathname();

  return (
    <ul className="space-y-1">
      {NAV_ITEMS.map((item) => {
        const active = pathname === item.href || pathname.startsWith(`${item.href}/`);
        const base = "flex items-center justify-between rounded-md px-3 py-2 text-sm font-medium";

        if (!item.available) {
          return (
            <li key={item.href}>
              <span aria-disabled="true" className={cn(base, "cursor-not-allowed text-slate-400")}>
                {item.label}
                <span className="text-[10px] font-semibold tracking-wide uppercase">Soon</span>
              </span>
            </li>
          );
        }

        return (
          <li key={item.href}>
            <Link
              href={item.href}
              onClick={onNavigate}
              aria-current={active ? "page" : undefined}
              className={cn(
                base,
                focusRing,
                active
                  ? "bg-brand-50 text-brand-700"
                  : "text-slate-700 hover:bg-slate-100 hover:text-slate-900",
              )}
            >
              {item.label}
            </Link>
          </li>
        );
      })}
    </ul>
  );
}

function Brand() {
  return (
    <Link href="/dashboard" className={cn("flex items-center gap-2 rounded-md", focusRing)}>
      <span className="grid size-8 place-items-center rounded-md bg-brand-600 text-sm font-bold text-white">
        H
      </span>
      <span className="text-base font-semibold text-slate-900">Hostel ERP</span>
    </Link>
  );
}

export interface ShellUser {
  fullName: string;
  email: string;
}

export interface ShellHostels {
  hostels: readonly SwitcherHostel[];
  activeId: string | null;
  draftName: string | null;
  canAddHostel: boolean;
}

/** Signed-in identity and the sign-out control, at the foot of the nav. */
function UserMenu({ user }: { user: ShellUser }) {
  return (
    <div className="border-t border-slate-200 px-3 py-4">
      <div className="px-3">
        <p className="truncate text-sm font-medium text-slate-900">{user.fullName}</p>
        <p className="truncate text-xs text-slate-500">{user.email}</p>
      </div>
      <form action={signOut} className="mt-3">
        <button
          type="submit"
          className={cn(
            "w-full rounded-md px-3 py-2 text-left text-sm font-medium text-slate-700 hover:bg-slate-100",
            focusRing,
          )}
        >
          Sign out
        </button>
      </form>
    </div>
  );
}

/**
 * Authenticated application chrome: a fixed sidebar on large screens and a
 * top bar with a slide-in drawer below the `lg` breakpoint.
 */
export function AppShell({
  user,
  hostels,
  children,
}: {
  user: ShellUser;
  hostels: ShellHostels;
  children: ReactNode;
}) {
  const [drawerOpen, setDrawerOpen] = useState(false);
  const pathname = usePathname();

  // Close the drawer whenever the route changes.
  useEffect(() => setDrawerOpen(false), [pathname]);

  // Allow Escape to dismiss the drawer.
  useEffect(() => {
    if (!drawerOpen) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setDrawerOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [drawerOpen]);

  return (
    <div className="min-h-dvh bg-slate-50">
      <a
        href="#main"
        className="sr-only z-50 rounded-md bg-white px-3 py-2 text-sm font-medium focus:not-sr-only focus:fixed focus:top-2 focus:left-2"
      >
        Skip to content
      </a>

      {/* Desktop sidebar */}
      <aside className="fixed inset-y-0 left-0 hidden w-64 flex-col border-r border-slate-200 bg-white lg:flex">
        <div className="flex h-16 items-center px-5">
          <Brand />
        </div>
        <div className="border-b border-slate-200 pb-4">
          <HostelSwitcher idPrefix="sidebar" {...hostels} />
        </div>
        <nav aria-label="Primary" className="flex-1 overflow-y-auto px-3 py-4">
          <NavLinks />
        </nav>
        <UserMenu user={user} />
      </aside>

      {/* Mobile top bar */}
      <header className="sticky top-0 z-30 flex h-14 items-center justify-between border-b border-slate-200 bg-white px-4 lg:hidden">
        <Brand />
        <button
          type="button"
          onClick={() => setDrawerOpen(true)}
          aria-label="Open navigation"
          aria-expanded={drawerOpen}
          aria-controls="mobile-nav"
          className={cn("rounded-md p-2 text-slate-700 hover:bg-slate-100", focusRing)}
        >
          <svg
            aria-hidden="true"
            viewBox="0 0 24 24"
            className="size-6"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
          >
            <path strokeLinecap="round" d="M3.75 6.75h16.5M3.75 12h16.5M3.75 17.25h16.5" />
          </svg>
        </button>
      </header>

      {/* Mobile drawer */}
      {drawerOpen && (
        <div
          className="fixed inset-0 z-40 lg:hidden"
          role="dialog"
          aria-modal="true"
          aria-label="Navigation"
        >
          <div className="absolute inset-0 bg-slate-900/50" onClick={() => setDrawerOpen(false)} />
          <div
            id="mobile-nav"
            className="absolute inset-y-0 left-0 flex w-72 max-w-[85%] flex-col bg-white shadow-xl"
          >
            <div className="flex h-14 items-center justify-between px-4">
              <Brand />
              <button
                type="button"
                autoFocus
                onClick={() => setDrawerOpen(false)}
                aria-label="Close navigation"
                className={cn("rounded-md p-2 text-slate-500 hover:bg-slate-100", focusRing)}
              >
                <svg
                  aria-hidden="true"
                  viewBox="0 0 24 24"
                  className="size-5"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.5"
                >
                  <path strokeLinecap="round" d="M6 18 18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
            <div className="border-b border-slate-200 pb-4">
              <HostelSwitcher idPrefix="drawer" {...hostels} />
            </div>
            <nav aria-label="Primary" className="flex-1 overflow-y-auto px-3 py-4">
              <NavLinks onNavigate={() => setDrawerOpen(false)} />
            </nav>
            <UserMenu user={user} />
          </div>
        </div>
      )}

      <main id="main" className="lg:pl-64">
        <div className="mx-auto max-w-6xl px-4 py-6 sm:px-6 lg:px-8 lg:py-8">{children}</div>
      </main>
    </div>
  );
}
