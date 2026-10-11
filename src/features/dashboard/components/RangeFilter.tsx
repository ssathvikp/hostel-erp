"use client";

import { usePathname, useRouter } from "next/navigation";
import { useState, useTransition, type FormEvent } from "react";

import { Button, focusRing, Input, Spinner } from "@/components/ui";
import { cn } from "@/lib/cn";

import {
  RANGE_LABELS,
  RANGE_PRESETS,
  rangeQuery,
  type DashboardRange,
  type RangePreset,
} from "../range";

/**
 * This month, last month or a custom range (E8-T4). The choice is written to
 * the URL; the server validates it and explains anything it rejects.
 */
export function RangeFilter({ range, today }: { range: DashboardRange; today: string }) {
  const router = useRouter();
  const pathname = usePathname();
  const [pending, startTransition] = useTransition();
  const [custom, setCustom] = useState(range.preset === "custom");

  function go(query: string) {
    startTransition(() => router.push(`${pathname}${query}`));
  }

  function choose(preset: RangePreset) {
    if (preset === "custom") {
      setCustom(true);
      return;
    }
    setCustom(false);
    go(rangeQuery({ preset, from: "", to: "" }));
  }

  function apply(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const from = String(data.get("from") ?? "");
    const to = String(data.get("to") ?? "");
    go(`?${new URLSearchParams({ range: "custom", from, to })}`);
  }

  const selected: RangePreset = custom ? "custom" : range.preset;

  return (
    <div className="flex flex-wrap items-end gap-3" aria-busy={pending}>
      <div role="group" aria-label="Date range" className="inline-flex rounded-md shadow-xs">
        {RANGE_PRESETS.map((preset, i) => (
          <button
            key={preset}
            type="button"
            aria-pressed={selected === preset}
            onClick={() => choose(preset)}
            className={cn(
              "border border-slate-300 px-3 py-2 text-sm font-medium",
              focusRing,
              i === 0 && "rounded-l-md",
              i === RANGE_PRESETS.length - 1 && "rounded-r-md",
              i > 0 && "-ml-px",
              selected === preset
                ? "relative z-10 border-brand-600 bg-brand-50 text-brand-700"
                : "bg-white text-slate-700 hover:bg-slate-50",
            )}
          >
            {RANGE_LABELS[preset]}
          </button>
        ))}
      </div>

      {custom && (
        <form onSubmit={apply} className="flex flex-wrap items-end gap-2" aria-label="Custom range">
          <Input
            id="range-from"
            name="from"
            type="date"
            label="From"
            max={today}
            defaultValue={range.preset === "custom" ? range.from : ""}
            required
            className="w-40"
          />
          <Input
            id="range-to"
            name="to"
            type="date"
            label="To"
            defaultValue={range.preset === "custom" ? range.to : ""}
            required
            className="w-40"
          />
          <Button type="submit" variant="secondary">
            Apply
          </Button>
        </form>
      )}

      {pending && (
        <span role="status" className="mb-2.5 text-slate-400">
          <Spinner className="size-4" />
          <span className="sr-only">Updating</span>
        </span>
      )}
    </div>
  );
}
