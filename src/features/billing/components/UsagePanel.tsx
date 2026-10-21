import { cn } from "@/lib/cn";

import type { AccountStatus } from "../queries";

const LABELS = { beds: "Beds", hostels: "Hostels", staff: "Staff accounts" } as const;

/** Usage against the plan's limits, warning at 80% (ClickUp EP-14 T4). */
export function UsagePanel({ account }: { account: AccountStatus }) {
  return (
    <ul className="grid gap-4 sm:grid-cols-3">
      {(Object.keys(LABELS) as (keyof typeof LABELS)[]).map((key) => {
        const used = account.usage[key];
        const limit = account.limits[key];
        const share = limit ? Math.min(1, used / limit) : 0;
        const tone = !limit ? "ok" : used > limit ? "over" : share >= 0.8 ? "near" : "ok";
        return (
          <li key={key} className="rounded-lg border border-slate-200 p-4">
            <p className="text-sm text-slate-600">{LABELS[key]}</p>
            <p className="mt-1 text-lg font-semibold text-slate-900 tabular-nums">
              {used}
              <span className="text-sm font-normal text-slate-600">
                {" "}
                {limit ? `of ${limit}` : "· no limit"}
              </span>
            </p>
            {limit !== null && (
              <div
                role="meter"
                aria-label={`${LABELS[key]} used`}
                aria-valuemin={0}
                aria-valuemax={limit}
                aria-valuenow={used}
                className="mt-2 h-2 overflow-hidden rounded-full bg-slate-100"
              >
                <div
                  className={cn(
                    "h-full rounded-full",
                    tone === "over"
                      ? "bg-red-600"
                      : tone === "near"
                        ? "bg-amber-500"
                        : "bg-brand-600",
                  )}
                  style={{ width: `${Math.round(share * 100)}%` }}
                />
              </div>
            )}
            {tone === "near" && <p className="mt-2 text-xs text-amber-800">Close to the limit.</p>}
            {tone === "over" && (
              <p className="mt-2 text-xs text-red-700">
                Over the limit. Nothing is removed, but no more can be added.
              </p>
            )}
          </li>
        );
      })}
    </ul>
  );
}
