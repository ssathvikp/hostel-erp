"use client";

import Link from "next/link";
import { useRef } from "react";

import { focusRing } from "@/components/ui";
import { cn } from "@/lib/cn";

import { switchHostel } from "../actions";

export interface SwitcherHostel {
  id: string;
  name: string;
}

/**
 * Shows the hostel the user is working in and, for multi-hostel owners, lets
 * them switch (E3-T7). Owners also get the entry point to add or finish a
 * hostel.
 */
export function HostelSwitcher({
  idPrefix,
  hostels,
  activeId,
  draftName,
  canAddHostel,
}: {
  /** The shell renders this twice (sidebar and drawer); ids must stay unique. */
  idPrefix: string;
  hostels: readonly SwitcherHostel[];
  activeId: string | null;
  draftName: string | null;
  canAddHostel: boolean;
}) {
  const formRef = useRef<HTMLFormElement>(null);
  const selectId = `${idPrefix}-hostel-switcher`;
  const active = hostels.find((hostel) => hostel.id === activeId);

  return (
    <div className="space-y-2 px-3">
      <p className="px-3 text-xs font-semibold tracking-wide text-slate-500 uppercase">Hostel</p>

      {hostels.length > 1 ? (
        <form ref={formRef} action={switchHostel}>
          <label htmlFor={selectId} className="sr-only">
            Switch hostel
          </label>
          <select
            id={selectId}
            name="hostel_id"
            defaultValue={activeId ?? undefined}
            onChange={() => formRef.current?.requestSubmit()}
            className={cn(
              "block w-full truncate rounded-md border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-900",
              focusRing,
            )}
          >
            {hostels.map((hostel) => (
              <option key={hostel.id} value={hostel.id}>
                {hostel.name}
              </option>
            ))}
          </select>
          <noscript>
            <button type="submit" className="mt-2 text-sm font-medium text-brand-700">
              Switch
            </button>
          </noscript>
        </form>
      ) : (
        <p className="truncate px-3 text-sm font-medium text-slate-900">
          {active?.name ?? "No hostel yet"}
        </p>
      )}

      {canAddHostel && (
        <Link
          href="/onboarding"
          className={cn(
            "block rounded-md px-3 py-1 text-sm font-medium text-brand-700 hover:underline",
            focusRing,
          )}
        >
          {draftName
            ? `Finish setting up ${draftName}`
            : hostels.length === 0
              ? "Set up your hostel"
              : "+ Add another hostel"}
        </Link>
      )}
    </div>
  );
}
