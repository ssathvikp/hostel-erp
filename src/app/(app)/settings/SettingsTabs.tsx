"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import { focusRing } from "@/components/ui";
import { cn } from "@/lib/cn";

const TABS = [
  { href: "/settings/hostel", label: "Hostel", ownerOnly: false },
  { href: "/settings/fees", label: "Fees", ownerOnly: false },
  { href: "/settings/staff", label: "Staff", ownerOnly: true },
  { href: "/settings/workers", label: "Workers", ownerOnly: false },
  { href: "/settings/complaints", label: "Complaints", ownerOnly: true },
  { href: "/settings/billing", label: "Billing", ownerOnly: true },
  { href: "/settings/referrals", label: "Refer", ownerOnly: true },
] as const;

export function SettingsTabs({ isOwner }: { isOwner: boolean }) {
  const pathname = usePathname();
  const tabs = TABS.filter((tab) => isOwner || !tab.ownerOnly);
  return (
    <nav aria-label="Settings sections" className="mb-6 overflow-x-auto border-b border-slate-200">
      <ul className="-mb-px flex gap-6 whitespace-nowrap">
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
