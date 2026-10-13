"use server";

import { revalidatePath } from "next/cache";

import { requireRole } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { uuid } from "@/lib/validation";

/** Hides an announcement for the signed-in user only (E10-T11). */
export async function dismissAnnouncement(formData: FormData): Promise<void> {
  await requireRole(["owner", "staff"]);
  const id = uuid("Announcement").safeParse(formData.get("id"));
  if (!id.success) return;
  const supabase = await createClient();
  // A repeat dismissal hits the primary key; either way it stays hidden.
  await supabase.from("announcement_dismissals").insert({ announcement_id: id.data });
  revalidatePath("/", "layout");
}
