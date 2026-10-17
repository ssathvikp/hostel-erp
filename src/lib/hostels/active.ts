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
  /** trial, paid or free (EP-10). */
  plan: string;
  trialEndsAt: string | null;
  suspensionReason: string | null;
}

export interface HostelContext {
  /** The hostel every query in this request is scoped to, if any. */
  active: HostelSummary | null;
  /** Active hostels the user can switch between. */
  hostels: HostelSummary[];
  /** The owner's unfinished onboarding, if one exists. */
  draft: HostelSummary | null;
  /** The owner's hostels a platform admin has suspended (EP-10). */
  suspended: HostelSummary[];
}

/**
 * Resolves the active hostel once per request. The cookie is only a
 * preference: it is honoured only if it names an active hostel the user is a
 * member of right now (RLS decides membership), so a tampered or stale value
 * silently falls back to the user's first hostel.
 */
export const getHostelContext = cache(async (): Promise<HostelContext> => {
  const user = await getSessionUser();
  if (!user) return { active: null, hostels: [], draft: null, suspended: [] };

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("hostels")
    .select("id, name, status, plan, trial_ends_at, suspension_reason")
    .order("created_at", { ascending: true });
  if (error) throw error;

  const rows: HostelSummary[] = (data ?? []).map((row) => ({
    id: row.id,
    name: row.name,
    status: row.status as HostelStatus,
    plan: row.plan,
    trialEndsAt: row.trial_ends_at,
    suspensionReason: row.suspension_reason,
  }));
  const hostels = rows.filter((hostel) => hostel.status === "active");
  const draft = rows.find((hostel) => hostel.status === "draft") ?? null;

  const preferred = (await cookies()).get(ACTIVE_HOSTEL_COOKIE)?.value;
  const active = hostels.find((hostel) => hostel.id === preferred) ?? hostels[0] ?? null;

  const suspended = rows.filter((hostel) => hostel.status === "suspended");

  return { active, hostels, draft, suspended };
});

/**
 * For every page that works inside a hostel: returns the user and the active
 * hostel. Without one, platform admins go to their console, owners whose
 * only hostels are suspended (and staff, whose one hostel is unavailable)
 * are told why, and everyone else finishes onboarding.
 */
export async function requireActiveHostel() {
  const user = await requireUser();
  if (user.role === "platform_admin") redirect("/admin");
  const context = await getHostelContext();
  if (!context.active) {
    if (user.role === "staff" || (context.suspended.length > 0 && !context.draft)) {
      redirect("/suspended");
    }
    redirect("/onboarding");
  }
  return { user, hostel: context.active, context };
}
