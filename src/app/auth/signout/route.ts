import { redirect } from "next/navigation";

import { createClient } from "@/lib/supabase/server";

/**
 * Ends this device's session and explains why. Reached when a signed-in
 * account no longer has an active profile, such as a removed staff member.
 * Requests from other sites are ignored.
 */
export async function GET(request: Request) {
  // Only this app may sign someone out this way: another site embedding the
  // URL (an image tag, a link) must not end the user's session.
  const site = request.headers.get("sec-fetch-site");
  if (site && site !== "same-origin" && site !== "none") redirect("/dashboard");

  const supabase = await createClient();
  await supabase.auth.signOut({ scope: "local" });
  redirect("/login?error=access_removed");
}
