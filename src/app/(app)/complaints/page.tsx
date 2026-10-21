import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";

import { PageHeader } from "@/components/shell/PageHeader";
import { Button, buttonClass, EmptyState, Table, TBody, Td, Th, THead, Tr } from "@/components/ui";
import {
  PriorityBadge,
  StatusBadge,
  TargetBadge,
} from "@/features/complaints/components/ComplaintBadges";
import {
  complaintNumber,
  isComplaintStatus,
  PRIORITIES,
  PRIORITY_LABELS,
  STATUS_LABELS,
  COMPLAINT_STATUSES,
  type Priority,
} from "@/features/complaints/options";
import {
  COMPLAINT_PAGE_SIZE,
  getCategories,
  getComplaints,
  getWorkers,
  type ComplaintFilters,
} from "@/features/complaints/queries";
import { requireActiveHostel } from "@/lib/hostels/active";
import { createClient } from "@/lib/supabase/server";
import { uuid } from "@/lib/validation";

export const metadata: Metadata = { title: "Complaints" };

type SearchParams = Record<string, string | string[] | undefined>;

const when = new Intl.DateTimeFormat("en-IN", {
  dateStyle: "medium",
  timeStyle: "short",
  timeZone: "Asia/Kolkata",
});

function single(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

function parseFilters(params: SearchParams): ComplaintFilters {
  const status = single(params.status);
  const id = (value: string | undefined) =>
    uuid("Id").safeParse(value).success ? value : undefined;
  const priority = single(params.priority);
  const page = Number(single(params.page));
  return {
    status: status === "all" || isComplaintStatus(status) ? status : "open",
    categoryId: id(single(params.category)),
    priority: (PRIORITIES as readonly string[]).includes(priority ?? "")
      ? (priority as Priority)
      : undefined,
    roomId: id(single(params.room)),
    workerId: id(single(params.worker)),
    late: single(params.late) === "1",
    unassigned: single(params.unassigned) === "1",
    page: Number.isInteger(page) && page > 1 ? page : 1,
  };
}

function FilterSelect({
  name,
  label,
  value,
  options,
  all,
}: {
  name: string;
  label: string;
  value: string | undefined;
  options: { value: string; label: string }[];
  all?: string;
}) {
  return (
    <label className="text-sm font-medium text-slate-700">
      {label}
      <select
        name={name}
        defaultValue={value ?? ""}
        className="mt-1 block w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm"
      >
        {all !== undefined && <option value="">{all}</option>}
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </label>
  );
}

/**
 * Complaints and maintenance jobs (ClickUp EP-15 T2): filtered, paged in the
 * database, newest first. Scheduled maintenance that is due is turned into
 * complaints as the page opens (T12).
 */
export default async function ComplaintsPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const { hostel } = await requireActiveHostel();
  const params = await searchParams;
  const filters = parseFilters(params);
  const supabase = await createClient();

  // Due preventive maintenance becomes complaints before the list is read.
  await supabase.rpc("create_due_maintenance", { p_hostel_id: hostel.id });

  const [list, categories, workers, { data: rooms, error: roomsError }] = await Promise.all([
    getComplaints(supabase, hostel.id, filters),
    getCategories(supabase, hostel.id),
    getWorkers(supabase, hostel.id),
    supabase
      .from("room_inventory")
      .select("id, room_number")
      .eq("hostel_id", hostel.id)
      .order("floor")
      .order("room_sort"),
  ]);
  if (roomsError) throw roomsError;

  const href = (changes: Record<string, string | null>) => {
    const next = new URLSearchParams();
    for (const [key, value] of Object.entries(params)) {
      const text = single(value);
      if (text) next.set(key, text);
    }
    for (const [key, value] of Object.entries(changes)) {
      if (value) next.set(key, value);
      else next.delete(key);
    }
    return next.size ? `/complaints?${next}` : "/complaints";
  };
  if (!list) redirect(href({ page: null }));
  const { rows, total } = list;
  const lastPage = Math.max(1, Math.ceil(total / COMPLAINT_PAGE_SIZE));

  return (
    <>
      <PageHeader
        title="Complaints"
        description="Repairs and maintenance, from raised to fixed."
        actions={
          <div className="flex flex-wrap gap-2">
            <Link href="/complaints/reports" className={buttonClass({ variant: "secondary" })}>
              Reports
            </Link>
            <Link href="/complaints/new" className={buttonClass({})}>
              Raise complaint
            </Link>
          </div>
        }
      />

      <form
        method="get"
        role="search"
        aria-label="Filter complaints"
        className="mb-4 grid gap-3 rounded-lg border border-slate-200 bg-white p-4 sm:grid-cols-3 lg:grid-cols-6 lg:items-end"
      >
        <FilterSelect
          name="status"
          label="Status"
          value={filters.status === "open" ? undefined : filters.status}
          all="All open"
          options={[
            ...COMPLAINT_STATUSES.map((status) => ({
              value: status,
              label: STATUS_LABELS[status],
            })),
            { value: "all", label: "Everything" },
          ]}
        />
        <FilterSelect
          name="category"
          label="Category"
          value={filters.categoryId}
          all="All"
          options={categories.map((category) => ({ value: category.id, label: category.name }))}
        />
        <FilterSelect
          name="priority"
          label="Priority"
          value={filters.priority}
          all="All"
          options={PRIORITIES.map((priority) => ({
            value: priority,
            label: PRIORITY_LABELS[priority],
          }))}
        />
        <FilterSelect
          name="room"
          label="Room"
          value={filters.roomId}
          all="All"
          options={(rooms ?? []).map((room) => ({ value: room.id!, label: room.room_number! }))}
        />
        <FilterSelect
          name="worker"
          label="Worker"
          value={filters.workerId}
          all="Anyone"
          options={workers.map((worker) => ({ value: worker.id, label: worker.fullName }))}
        />
        <div className="flex flex-col gap-2 text-sm text-slate-700">
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              name="late"
              value="1"
              defaultChecked={filters.late}
              className="accent-brand-600"
            />
            Late only
          </label>
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              name="unassigned"
              value="1"
              defaultChecked={filters.unassigned}
              className="accent-brand-600"
            />
            No worker yet
          </label>
          <Button type="submit" size="sm" variant="secondary">
            Show
          </Button>
        </div>
      </form>

      {rows.length === 0 ? (
        <EmptyState
          title={filters.status === "open" ? "No open complaints" : "No complaints match"}
          description="Raise one when something needs fixing. It goes to the right worker automatically."
        />
      ) : (
        <>
          <Table caption="Complaints">
            <THead>
              <tr>
                <Th>Complaint</Th>
                <Th>Where</Th>
                <Th>Status</Th>
                <Th>Worker</Th>
                <Th>Raised</Th>
              </tr>
            </THead>
            <TBody>
              {rows.map((row) => (
                <Tr key={row.id}>
                  <Td>
                    <Link
                      href={`/complaints/${row.id}`}
                      className="font-medium text-brand-700 hover:underline"
                    >
                      {row.title}
                    </Link>
                    <span className="mt-0.5 flex flex-wrap items-center gap-2 text-xs text-slate-500">
                      <span className="font-mono">{complaintNumber(row.number)}</span>
                      <span>{row.categoryName}</span>
                      {row.kind === "scheduled" && <span>Scheduled</span>}
                      <PriorityBadge priority={row.priority} />
                    </span>
                  </Td>
                  <Td>
                    {row.where}
                    {row.residentName && (
                      <span className="block text-xs text-slate-500">{row.residentName}</span>
                    )}
                  </Td>
                  <Td>
                    <div className="flex flex-wrap gap-1">
                      <StatusBadge status={row.status} />
                      <TargetBadge complaint={row} />
                    </div>
                  </Td>
                  <Td>
                    {row.workerName ??
                      (row.needsWorker ? (
                        <span className="text-amber-800">Needs a worker</span>
                      ) : (
                        <span className="text-slate-500">—</span>
                      ))}
                  </Td>
                  <Td className="whitespace-nowrap">{when.format(new Date(row.createdAt))}</Td>
                </Tr>
              ))}
            </TBody>
          </Table>
          <nav
            aria-label="Pagination"
            className="mt-4 flex items-center justify-between text-sm text-slate-600"
          >
            <span>
              {total} {total === 1 ? "complaint" : "complaints"}
            </span>
            <div className="flex items-center gap-3">
              {filters.page > 1 && (
                <Link
                  href={href({ page: filters.page > 2 ? String(filters.page - 1) : null })}
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
                  href={href({ page: String(filters.page + 1) })}
                  className={buttonClass({ variant: "secondary", size: "sm" })}
                >
                  Next
                </Link>
              )}
            </div>
          </nav>
        </>
      )}
    </>
  );
}
