import type { Metadata } from "next";
import Link from "next/link";

import { PageHeader } from "@/components/shell/PageHeader";
import { buttonClass, EmptyState } from "@/components/ui";
import { AuditTable } from "@/features/admin/components/AuditTable";
import {
  AUDIT_PAGE_SIZE,
  getAdmins,
  getAuditEntries,
  requirePlatformAdmin,
} from "@/features/admin/queries";
import { createClient } from "@/lib/supabase/server";
import { uuid } from "@/lib/validation";

export const metadata: Metadata = { title: "Audit log" };

type SearchParams = Record<string, string | string[] | undefined>;
const single = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value);
const isDate = (value: string | undefined) =>
  value && /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : null;
const isId = (value: string | undefined) =>
  value && uuid("Id").safeParse(value).success ? value : null;

/**
 * Every admin action, who did it and why (ClickUp E10-T3). Entries can never
 * be changed or removed, by anyone.
 */
export default async function AdminAuditPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  await requirePlatformAdmin();
  const params = await searchParams;
  const filters = {
    hostelId: isId(single(params.hostel)),
    actorId: isId(single(params.admin)),
    from: isDate(single(params.from)),
    to: isDate(single(params.to)),
  };
  const pageNumber = Number(single(params.page));
  const page = Number.isInteger(pageNumber) && pageNumber > 1 ? pageNumber : 1;
  const supabase = await createClient();
  const [{ entries, total }, admins] = await Promise.all([
    getAuditEntries(supabase, { ...filters, page }),
    getAdmins(supabase),
  ]);
  const lastPage = Math.max(1, Math.ceil(total / AUDIT_PAGE_SIZE));
  const href = (nextPage: number) => {
    const query = new URLSearchParams();
    if (filters.hostelId) query.set("hostel", filters.hostelId);
    if (filters.actorId) query.set("admin", filters.actorId);
    if (filters.from) query.set("from", filters.from);
    if (filters.to) query.set("to", filters.to);
    if (nextPage > 1) query.set("page", String(nextPage));
    return query.size ? `/admin/audit?${query}` : "/admin/audit";
  };
  const field = "h-10 rounded-md border border-slate-300 px-3 text-sm";

  return (
    <div className="space-y-6">
      <PageHeader
        title="Audit log"
        description="Every admin action, newest first. Nothing here can be edited or deleted."
      />

      <form className="flex flex-wrap items-end gap-3 text-sm">
        {filters.hostelId && <input type="hidden" name="hostel" value={filters.hostelId} />}
        <label className="flex flex-col gap-1">
          <span className="text-slate-600">Admin</span>
          <select name="admin" defaultValue={filters.actorId ?? ""} className={field}>
            <option value="">Anyone</option>
            {admins.map((person) => (
              <option key={person.id} value={person.id}>
                {person.fullName} ({person.email})
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-slate-600">From</span>
          <input type="date" name="from" defaultValue={filters.from ?? ""} className={field} />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-slate-600">To</span>
          <input type="date" name="to" defaultValue={filters.to ?? ""} className={field} />
        </label>
        <button type="submit" className={buttonClass({ variant: "secondary" })}>
          Filter
        </button>
        {(filters.hostelId || filters.actorId || filters.from || filters.to) && (
          <Link href="/admin/audit" className="text-brand-700 underline">
            Clear
          </Link>
        )}
      </form>

      {entries.length === 0 ? (
        <EmptyState
          title="Nothing recorded"
          description="Admin actions appear here as they happen."
        />
      ) : (
        <>
          <AuditTable entries={entries} />
          <nav
            aria-label="Pagination"
            className="flex items-center justify-between text-sm text-slate-600"
          >
            <span>
              {total} {total === 1 ? "entry" : "entries"}
            </span>
            <div className="flex items-center gap-3">
              {page > 1 && (
                <Link
                  href={href(page - 1)}
                  className={buttonClass({ variant: "secondary", size: "sm" })}
                >
                  Previous
                </Link>
              )}
              <span>
                Page {page} of {lastPage}
              </span>
              {page < lastPage && (
                <Link
                  href={href(page + 1)}
                  className={buttonClass({ variant: "secondary", size: "sm" })}
                >
                  Next
                </Link>
              )}
            </div>
          </nav>
        </>
      )}
    </div>
  );
}
