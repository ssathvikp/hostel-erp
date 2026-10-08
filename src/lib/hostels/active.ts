import "server-only";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { cache } from "react";

import { getSessionUser, requireUser } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import type { HostelStatus, Uuid } from "@/types";

import { ACTIVE_HOSTEL_COOKIE } from "./cookie";

export interface HostelSummary {
  id: Uuid;
  name: string;
  status: HostelStatus;
}

export interface HostelContext {
  /** The hostel every query in this request is scoped to, if any. */
  active: HostelSummary | null;
  /** Active hostels the user can switch between. */
  hostels: HostelSummary[];
  /** The owner's unfinished onboarding, if one exists. */
  draft: HostelSummary | null;
}

/**
 * Resolves the active hostel once per request. The cookie is only a
 * preference: it is honoured only if it names an active hostel the user is a
 * member of right now (RLS decides membership), so a tampered or stale value
 * silently falls back to the user's first hostel.
 */
export const getHostelContext = cache(async (): Promise<HostelContext> => {
  const user = await getSessionUser();
  if (!user) return { active: null, hostels: [], draft: null };

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("hostels")
    .select("id, name, status")
    .order("created_at", { ascending: true });
  if (error) throw error;

  const rows = (data ?? []) as HostelSummary[];
  const hostels = rows.filter((hostel) => hostel.status === "active");
  const draft = rows.find((hostel) => hostel.status === "draft") ?? null;

  const preferred = (await cookies()).get(ACTIVE_HOSTEL_COOKIE)?.value;
  const active = hostels.find((hostel) => hostel.id === preferred) ?? hostels[0] ?? null;

  return { active, hostels, draft };
});

/**
 * For every page that works inside a hostel: returns the user and the active
 * hostel, or sends the user to finish onboarding when they have none yet.
 */
export async function requireActiveHostel() {
  const user = await requireUser();
  const context = await getHostelContext();
  if (!context.active) redirect("/onboarding");
  return { user, hostel: context.active, context };
}
