"use server";

import { revalidatePath } from "next/cache";

import { requireUser } from "@/lib/auth/session";
import { logUnexpected } from "@/lib/request-context";
import { createClient } from "@/lib/supabase/server";
import { uuid } from "@/lib/validation";

/** Hides an announcement for the signed-in user, on every device. */
export async function dismissAnnouncement(id: string): Promise<{ ok: boolean }> {
  const user = await requireUser();
  if (!uuid("Announcement").safeParse(id).success) return { ok: false };
  const supabase = await createClient();
  const { error } = await supabase
    .from("announcement_dismissals")
    .insert({ user_id: user.id, announcement_id: id });
  // Already dismissed (another tab): nothing to do.
  if (error && error.code !== "23505") {
    await logUnexpected("dismissAnnouncement", error);
    return { ok: false };
  }
  revalidatePath("/", "layout");
  return { ok: true };
}
