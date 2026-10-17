import { redirect } from "next/navigation";

import { createClient } from "@/lib/supabase/server";

/**
 * Ends this device's session and explains why. Reached when a signed-in
 * account no longer has an active profile, such as a removed staff member.
 * Signing out is the only thing it can do, so a forged link is harmless.
 */
export async function GET() {
  const supabase = await createClient();
  await supabase.auth.signOut({ scope: "local" });
  redirect("/login?error=access_removed");
}
