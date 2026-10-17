"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useTransition } from "react";

import { Select, Spinner, type SelectOption } from "@/components/ui";
import { formatMonth } from "@/lib/money";

import { DUE_STATUS_OPTIONS } from "../options";

const SORT_OPTIONS: readonly SelectOption[] = [
  { value: "outstanding", label: "Most outstanding first" },
  { value: "due", label: "Earliest due date first" },
  { value: "month", label: "Newest month first" },
  { value: "room", label: "Room number" },
];

/**
 * Filters for the fee list (E7-T6). Everything lives in the URL so a view
 * can be reloaded, bookmarked or shared.
 */
export function FeeFilters({
  rooms,
  months,
}: {
  rooms: readonly SelectOption[];
  months: readonly SelectOption[];
}) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [pending, startTransition] = useTransition();

  function update(name: string, value: string) {
    const next = new URLSearchParams(params);
    if (value) next.set(name, value);
    else next.delete(name);
    next.delete("page");
    startTransition(() => router.replace(next.size ? `${pathname}?${next}` : pathname));
  }

  // A month in the URL with no invoices (an old link, or every invoice
  // voided) still filters the list, so the dropdown must show it too.
  const selectedMonth = params.get("month") ?? "";
  const monthOptions =
    selectedMonth && !months.some((month) => month.value === selectedMonth)
      ? [{ value: selectedMonth, label: formatMonth(selectedMonth) }, ...months]
      : months;

  return (
    <div
      role="search"
      aria-label="Filter fees"
      aria-busy={pending}
      className="mb-4 grid gap-3 rounded-lg border border-slate-200 bg-white p-4 sm:grid-cols-2 lg:grid-cols-4"
    >
      <Select
        id="fee-status"
        label="Status"
        placeholder="All statuses"
        options={DUE_STATUS_OPTIONS}
        value={params.get("status") ?? ""}
        onChange={(event) => update("status", event.target.value)}
      />
      <Select
        id="fee-month"
        label="Month"
        placeholder="All months"
        options={monthOptions}
        value={selectedMonth}
        onChange={(event) => update("month", event.target.value)}
      />
      <Select
        id="fee-room"
        label="Room"
        placeholder="All rooms"
        options={rooms}
        value={params.get("room") ?? ""}
        onChange={(event) => update("room", event.target.value)}
      />
      <div className="flex items-end gap-2">
        <Select
          id="fee-sort"
          label="Sort"
          options={SORT_OPTIONS}
          value={params.get("sort") ?? "outstanding"}
          onChange={(event) =>
            update("sort", event.target.value === "outstanding" ? "" : event.target.value)
          }
          className="flex-1"
        />
        {pending && (
          <span role="status" className="mb-2.5 text-slate-400">
            <Spinner className="size-4" />
            <span className="sr-only">Updating</span>
          </span>
        )}
      </div>
    </div>
  );
}
