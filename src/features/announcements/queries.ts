import "server-only";

import type { createClient } from "@/lib/supabase/server";

type Supabase = Awaited<ReturnType<typeof createClient>>;

export interface Announcement {
  id: string;
  message: string;
  severity: "info" | "warning";
}

/** Live announcements the user has not dismissed (ClickUp E10-T11). RLS keeps only live ones. */
export async function getAnnouncements(supabase: Supabase): Promise<Announcement[]> {
  const [{ data, error }, { data: dismissed, error: dismissedError }] = await Promise.all([
    supabase
      .from("announcements")
      .select("id, message, severity")
      .order("starts_at", { ascending: false })
      .limit(5),
    supabase.from("announcement_dismissals").select("announcement_id"),
  ]);
  if (error) throw error;
  if (dismissedError) throw dismissedError;
  const hidden = new Set((dismissed ?? []).map((row) => row.announcement_id));
  return (data ?? [])
    .filter((row) => !hidden.has(row.id))
    .map((row) => ({
      id: row.id,
      message: row.message,
      severity: row.severity === "warning" ? "warning" : "info",
    }));
}
