"use client";

import { createContext, useContext, useState, type ReactNode } from "react";

import type { SelectOption } from "@/components/ui";

import { AllocateModal } from "./AllocateDialog";

const OpenAllocate = createContext<((bed: { id: string; label: string }) => void) | null>(null);

/**
 * One shared allocate dialog for a page with many vacant beds (the
 * occupancy view), instead of a dialog and a resident list per bed.
 */
export function AllocateBoard({
  residentOptions,
  children,
}: {
  residentOptions: readonly SelectOption[];
  children: ReactNode;
}) {
  const [bed, setBed] = useState<{ id: string; label: string } | null>(null);

  return (
    <OpenAllocate.Provider value={setBed}>
      {children}
      {bed && (
        <AllocateModal
          key={bed.id}
          open
          onClose={() => setBed(null)}
          title={`Allocate bed ${bed.label}`}
          fixed={{ name: "bed_id", value: bed.id }}
          choice={{
            name: "resident_id",
            label: "Resident",
            placeholder: "Choose a resident without a bed",
            options: residentOptions,
            emptyMessage: "Every active resident already has a bed. Register a resident first.",
          }}
        />
      )}
    </OpenAllocate.Provider>
  );
}

/** Opens the board's allocate dialog for one vacant bed. */
export function AllocateBedButton({ bed }: { bed: { id: string; label: string } }) {
  const open = useContext(OpenAllocate);
  if (!open) throw new Error("AllocateBedButton must be inside an AllocateBoard");
  return (
    <button
      type="button"
      onClick={() => open(bed)}
      aria-label={`Allocate bed ${bed.label}`}
      className="rounded text-xs font-medium text-brand-700 underline hover:text-brand-800 focus-visible:outline-2 focus-visible:outline-brand-600"
    >
      Allocate
    </button>
  );
}
