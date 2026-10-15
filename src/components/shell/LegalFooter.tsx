import Link from "next/link";

import { LEGAL_PAGES } from "@/lib/legal";

/** Links to the legal pages, on every public page (E14-T11). */
export function LegalFooter({ className }: { className?: string }) {
  return (
    <footer className={className ?? "py-6 print:hidden"}>
      <nav aria-label="Legal" className="mx-auto max-w-3xl px-4">
        <ul className="flex flex-wrap justify-center gap-x-4 gap-y-1 text-xs text-slate-500">
          {LEGAL_PAGES.map((page) => (
            <li key={page.href}>
              <Link href={page.href} className="hover:text-slate-800 hover:underline">
                {page.label}
              </Link>
            </li>
          ))}
        </ul>
      </nav>
    </footer>
  );
}
