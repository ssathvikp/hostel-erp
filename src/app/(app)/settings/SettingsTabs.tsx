"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import { focusRing } from "@/components/ui";
import { cn } from "@/lib/cn";

const TABS = [
  { href: "/settings/hostel", label: "Hostel" },
  { href: "/settings/fees", label: "Fees" },
  { href: "/settings/workers", label: "Workers" },
  { href: "/settings/complaints", label: "Complaints" },
  { href: "/settings/payments", label: "Online payments" },
] as const;

/** Billing is the owner's alone (E14-T8). */
const OWNER_TABS = [{ href: "/settings/billing", label: "Billing" }] as const;

export function SettingsTabs({ isOwner }: { isOwner: boolean }) {
  const pathname = usePathname();
  const tabs = isOwner ? [...TABS, ...OWNER_TABS] : TABS;
  return (
    <nav aria-label="Settings sections" className="mb-6 border-b border-slate-200">
      <ul className="-mb-px flex flex-wrap gap-x-6">
        {tabs.map((tab) => {
          const active = pathname.startsWith(tab.href);
          return (
            <li key={tab.href}>
              <Link
                href={tab.href}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "inline-block border-b-2 px-1 pb-3 text-sm font-medium",
                  focusRing,
                  active
                    ? "border-brand-600 text-brand-700"
                    : "border-transparent text-slate-600 hover:border-slate-300 hover:text-slate-900",
                )}
              >
                {tab.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
