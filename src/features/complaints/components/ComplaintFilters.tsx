"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useTransition } from "react";

import { Checkbox, Select, Spinner, type SelectOption } from "@/components/ui";

import { COMPLAINT_STATUS_OPTIONS, PRIORITY_OPTIONS } from "../options";

const STATUS_FILTER_OPTIONS: readonly SelectOption[] = [
  { value: "active", label: "Not yet fixed" },
  ...COMPLAINT_STATUS_OPTIONS,
  { value: "all", label: "All complaints" },
];

const AGE_OPTIONS: readonly SelectOption[] = [
  { value: "1", label: "Older than 1 day" },
  { value: "3", label: "Older than 3 days" },
  { value: "7", label: "Older than a week" },
  { value: "30", label: "Older than a month" },
];

/**
 * Filters for the complaint list (E15-T2). Everything lives in the URL so a
 * view can be reloaded or shared.
 */
export function ComplaintFilters({
  categories,
  rooms,
  workers,
}: {
  categories: readonly SelectOption[];
  rooms: readonly SelectOption[];
  workers: readonly SelectOption[];
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

  return (
    <form
      role="search"
      aria-label="Filter complaints"
      onSubmit={(event) => event.preventDefault()}
      className="mb-4 grid gap-3 rounded-lg border border-slate-200 bg-white p-4 sm:grid-cols-3"
    >
      <Select
        id="status"
        label="Status"
        options={STATUS_FILTER_OPTIONS}
        value={params.get("status") ?? "active"}
        onChange={(event) =>
          update("status", event.currentTarget.value === "active" ? "" : event.currentTarget.value)
        }
      />
      <Select
        id="category"
        label="Category"
        placeholder="All categories"
        options={categories}
        value={params.get("category") ?? ""}
        onChange={(event) => update("category", event.currentTarget.value)}
      />
      <Select
        id="priority"
        label="Priority"
        placeholder="Any priority"
        options={PRIORITY_OPTIONS}
        value={params.get("priority") ?? ""}
        onChange={(event) => update("priority", event.currentTarget.value)}
      />
      <Select
        id="room"
        label="Room"
        placeholder="All rooms"
        options={rooms}
        value={params.get("room") ?? ""}
        onChange={(event) => update("room", event.currentTarget.value)}
      />
      <Select
        id="worker"
        label="Worker"
        placeholder="Anyone"
        options={workers}
        value={params.get("worker") ?? ""}
        onChange={(event) => update("worker", event.currentTarget.value)}
      />
      <Select
        id="age"
        label="Age"
        placeholder="Any age"
        options={AGE_OPTIONS}
        value={params.get("age") ?? ""}
        onChange={(event) => update("age", event.currentTarget.value)}
      />
      <div className="flex items-center gap-3 sm:col-span-3">
        <Checkbox
          id="overdue"
          label="Only past their target"
          checked={params.get("overdue") === "1"}
          onChange={(event) => update("overdue", event.currentTarget.checked ? "1" : "")}
        />
        {pending && (
          <span role="status" className="text-slate-500">
            <Spinner className="size-5" />
            <span className="sr-only">Updating complaints</span>
          </span>
        )}
      </div>
    </form>
  );
}
