"use client";

import { createContext, useContext, type ReactNode } from "react";

/**
 * The hostel the current screen was rendered for. Every form that changes
 * hostel data posts it back (`HostelField`), so a save from a tab left open
 * on hostel A is refused after the owner switched to hostel B in another
 * tab, instead of landing in B (`formHostel` in src/lib/hostels/form.ts).
 */
const ActiveHostelContext = createContext<string | null>(null);

export function ActiveHostelProvider({ id, children }: { id: string | null; children: ReactNode }) {
  return <ActiveHostelContext.Provider value={id}>{children}</ActiveHostelContext.Provider>;
}

export function useActiveHostelId(): string | null {
  return useContext(ActiveHostelContext);
}

/** Hidden field naming the hostel this form belongs to. */
export function HostelField() {
  const id = useActiveHostelId();
  return <input type="hidden" name="hostel_id" value={id ?? ""} />;
}
