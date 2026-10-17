"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useRef, useTransition } from "react";

import { Input, Select, Spinner, type SelectOption } from "@/components/ui";

import { RESIDENT_STATUS_OPTIONS } from "../options";

const STATUS_FILTER_OPTIONS: readonly SelectOption[] = [
  { value: "current", label: "Current (active or on notice)" },
  ...RESIDENT_STATUS_OPTIONS,
  { value: "all", label: "All residents" },
];

/**
 * Search and filters for the resident list (E5-T4). Everything lives in the
 * URL so a view can be reloaded or shared.
 */
export function ResidentFilters({ rooms }: { rooms: readonly SelectOption[] }) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [pending, startTransition] = useTransition();
  // Enter submits the search, and the blur that follows would ask for the
  // same URL again while that navigation is still pending: skip it.
  const lastRequested = useRef<string | null>(null);

  function update(name: string, value: string) {
    const next = new URLSearchParams(params);
    if (value) next.set(name, value);
    else next.delete(name);
    next.delete("page");
    next.delete("imported");
    const url = next.size ? `${pathname}?${next}` : pathname;
    if (pending && url === lastRequested.current) return;
    lastRequested.current = url;
    startTransition(() => router.replace(url));
  }

  return (
    <form
      role="search"
      aria-label="Search residents"
      onSubmit={(event) => {
        event.preventDefault();
        const query = new FormData(event.currentTarget).get("q");
        update("q", typeof query === "string" ? query.trim() : "");
      }}
      className="mb-4 grid gap-3 rounded-lg border border-slate-200 bg-white p-4 sm:grid-cols-3"
    >
      <Input
        key={params.get("q") ?? ""}
        id="q"
        label="Search"
        type="search"
        placeholder="Name, phone or room"
        defaultValue={params.get("q") ?? ""}
        onBlur={(event) => {
          if (event.currentTarget.value.trim() !== (params.get("q") ?? "")) {
            update("q", event.currentTarget.value.trim());
          }
        }}
      />
      <Select
        id="status"
        label="Status"
        options={STATUS_FILTER_OPTIONS}
        value={params.get("status") ?? "current"}
        onChange={(event) =>
          update("status", event.currentTarget.value === "current" ? "" : event.currentTarget.value)
        }
      />
      <div className="flex items-end gap-3">
        <div className="min-w-0 flex-1">
          <Select
            id="room"
            label="Room"
            placeholder="All rooms"
            options={rooms}
            value={params.get("room") ?? ""}
            onChange={(event) => update("room", event.currentTarget.value)}
          />
        </div>
        {pending && (
          <span role="status" className="mb-2.5 text-slate-500">
            <Spinner className="size-5" />
            <span className="sr-only">Updating residents</span>
          </span>
        )}
      </div>
    </form>
  );
}
