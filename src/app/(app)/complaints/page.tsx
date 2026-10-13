import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";

import { PageHeader } from "@/components/shell/PageHeader";
import { buttonClass, EmptyState } from "@/components/ui";
import { ComplaintFilters } from "@/features/complaints/components/ComplaintFilters";
import { ComplaintTable } from "@/features/complaints/components/ComplaintTable";
import { isComplaintStatus, isPriority } from "@/features/complaints/options";
import {
  COMPLAINT_PAGE_SIZE,
  getCategories,
  getComplaints,
  getWorkers,
  type ComplaintFilters as Filters,
} from "@/features/complaints/queries";
import { requireActiveHostel } from "@/lib/hostels/active";
import { fetchAllPages } from "@/lib/pagination";
import { createClient } from "@/lib/supabase/server";
import { uuid } from "@/lib/validation";

export const metadata: Metadata = { title: "Complaints" };

type SearchParams = Record<string, string | string[] | undefined>;

function single(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

function id(value: string | undefined): string | null {
  return value && uuid("Id").safeParse(value).success ? value : null;
}

function parseFilters(params: SearchParams): Filters {
  const status = single(params.status);
  const priority = single(params.priority);
  const age = Number(single(params.age));
  const page = Number(single(params.page));
  return {
    status: status === "all" || isComplaintStatus(status) ? status : "active",
    categoryId: id(single(params.category)),
    priority: isPriority(priority) ? priority : null,
    roomId: id(single(params.room)),
    workerId: id(single(params.worker)),
    olderThanDays: [1, 3, 7, 30].includes(age) ? age : null,
    overdue: single(params.overdue) === "1",
    page: Number.isInteger(page) && page > 1 ? page : 1,
  };
}

/** Every complaint in the hostel with filters and paging (E15-T2). */
export default async function ComplaintsPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const { user, hostel } = await requireActiveHostel();
  const params = await searchParams;
  const filters = parseFilters(params);
  const supabase = await createClient();

  const [result, categories, workers, rooms, { count: anyCount, error: countError }] =
    await Promise.all([
      getComplaints(supabase, hostel.id, filters),
      getCategories(supabase, hostel.id),
      getWorkers(supabase, hostel.id),
      fetchAllPages((first, last) =>
        supabase
          .from("room_inventory")
          .select("id, room_number")
          .eq("hostel_id", hostel.id)
          .eq("status", "active")
          .order("floor")
          .order("room_sort")
          .order("id")
          .range(first, last),
      ),
      supabase
        .from("complaints")
        .select("id", { count: "exact", head: true })
        .eq("hostel_id", hostel.id),
    ]);
  if (countError) throw countError;

  const pageHref = (page: number) => {
    const next = new URLSearchParams();
    for (const [key, value] of Object.entries(params)) {
      const text = single(value);
      if (text && key !== "page") next.set(key, text);
    }
    if (page > 1) next.set("page", String(page));
    return next.size ? `/complaints?${next}` : "/complaints";
  };
  if (!result) redirect(pageHref(1));

  const { rows, total } = result;
  const lastPage = Math.max(1, Math.ceil(total / COMPLAINT_PAGE_SIZE));
  const isOwner = user.role === "owner";

  return (
    <>
      <PageHeader
        title="Complaints"
        description={`Repairs and maintenance at ${hostel.name}.`}
        actions={
          <>
            {isOwner && (
              <Link
                href="/complaints/maintenance"
                className={buttonClass({ variant: "secondary" })}
              >
                Preventive maintenance
              </Link>
            )}
            <Link href="/complaints/new" className={buttonClass()}>
              Raise complaint
            </Link>
          </>
        }
      />

      {(anyCount ?? 0) === 0 ? (
        <EmptyState
          title="No complaints yet"
          description="Log every repair here, from a fused bulb to a leaking tank. Each complaint goes to the right worker and is tracked until it is fixed."
          action={
            <Link href="/complaints/new" className={buttonClass()}>
              Raise the first complaint
            </Link>
          }
        />
      ) : (
        <>
          <ComplaintFilters
            categories={categories.map((c) => ({ value: c.id, label: c.name }))}
            rooms={rooms.map((room) => ({
              value: room.id ?? "",
              label: `Room ${room.room_number}`,
            }))}
            workers={workers.map((w) => ({ value: w.id, label: w.name }))}
          />
          <p className="mb-3 text-sm text-slate-600" role="status">
            {total === 0
              ? "No complaints match."
              : `${total} ${total === 1 ? "complaint" : "complaints"} found`}
          </p>

          {rows.length === 0 ? (
            <EmptyState
              title="No complaints match"
              description="Try other filters, or show every status."
              action={
                <Link href="/complaints" className={buttonClass({ variant: "secondary" })}>
                  Clear filters
                </Link>
              }
            />
          ) : (
            <>
              <ComplaintTable rows={rows} caption="Complaints" />
              {lastPage > 1 && (
                <nav
                  aria-label="Pagination"
                  className="mt-4 flex items-center justify-end gap-2 text-sm text-slate-600"
                >
                  {filters.page > 1 && (
                    <Link
                      href={pageHref(filters.page - 1)}
                      className={buttonClass({ variant: "secondary", size: "sm" })}
                    >
                      Previous
                    </Link>
                  )}
                  <span>
                    Page {filters.page} of {lastPage}
                  </span>
                  {filters.page < lastPage && (
                    <Link
                      href={pageHref(filters.page + 1)}
                      className={buttonClass({ variant: "secondary", size: "sm" })}
                    >
                      Next
                    </Link>
                  )}
                </nav>
              )}
            </>
          )}
        </>
      )}
    </>
  );
}
