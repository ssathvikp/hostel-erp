"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useRef, useTransition } from "react";

import { Input, Select, Spinner } from "@/components/ui";

import { floorLabel, SHARING_TYPE_OPTIONS } from "../options";

const AVAILABILITY_OPTIONS = [
  { value: "vacant", label: "Has a free bed" },
  { value: "full", label: "No free beds" },
];

const STATUS_OPTIONS = [
  { value: "active", label: "Active rooms" },
  { value: "archived", label: "Archived rooms" },
];

/**
 * Filters for the room list (E4-T6). Every filter lives in the URL, so a
 * filtered view survives a reload and can be shared as a link.
 */
export function RoomFilters({ floors }: { floors: readonly number[] }) {
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
    // A different filter means a different result set: start at page 1.
    next.delete("page");
    for (const flash of ["created", "archived", "deleted", "imported"]) next.delete(flash);
    const url = next.size ? `${pathname}?${next}` : pathname;
    if (pending && url === lastRequested.current) return;
    lastRequested.current = url;
    startTransition(() => router.replace(url));
  }

  const floorOptions = floors.map((floor) => ({ value: String(floor), label: floorLabel(floor) }));

  return (
    <form
      role="search"
      aria-label="Filter rooms"
      onSubmit={(event) => {
        event.preventDefault();
        const query = new FormData(event.currentTarget).get("q");
        update("q", typeof query === "string" ? query.trim() : "");
      }}
      className="mb-4 grid gap-3 rounded-lg border border-slate-200 bg-white p-4 sm:grid-cols-2 lg:grid-cols-5"
    >
      <Input
        // Remount when the URL changes elsewhere (e.g. back button) so the box matches it.
        key={params.get("q") ?? ""}
        id="q"
        label="Room number"
        type="search"
        placeholder="Search"
        defaultValue={params.get("q") ?? ""}
        onBlur={(event) => {
          if (event.currentTarget.value.trim() !== (params.get("q") ?? "")) {
            update("q", event.currentTarget.value.trim());
          }
        }}
      />
      <Select
        id="floor"
        label="Floor"
        placeholder="All floors"
        options={floorOptions}
        value={params.get("floor") ?? ""}
        onChange={(event) => update("floor", event.currentTarget.value)}
      />
      <Select
        id="sharing"
        label="Sharing type"
        placeholder="All types"
        options={SHARING_TYPE_OPTIONS}
        value={params.get("sharing") ?? ""}
        onChange={(event) => update("sharing", event.currentTarget.value)}
      />
      <Select
        id="availability"
        label="Availability"
        placeholder="Any"
        options={AVAILABILITY_OPTIONS}
        value={params.get("availability") ?? ""}
        onChange={(event) => update("availability", event.currentTarget.value)}
      />
      <div className="flex items-end gap-3">
        <div className="min-w-0 flex-1">
          <Select
            id="status"
            label="Show"
            options={STATUS_OPTIONS}
            value={params.get("status") ?? "active"}
            onChange={(event) =>
              update("status", event.currentTarget.value === "active" ? "" : "archived")
            }
          />
        </div>
        {pending && (
          <span role="status" className="mb-2.5 text-slate-500">
            <Spinner className="size-5" />
            <span className="sr-only">Updating rooms</span>
          </span>
        )}
      </div>
    </form>
  );
}
