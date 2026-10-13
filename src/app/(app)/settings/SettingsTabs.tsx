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
] as const;

export function SettingsTabs() {
  const pathname = usePathname();
  return (
    <nav aria-label="Settings sections" className="mb-6 border-b border-slate-200">
      <ul className="-mb-px flex gap-6">
        {TABS.map((tab) => {
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
