import "server-only";

import { notFound, redirect } from "next/navigation";
import { cache } from "react";

import { createClient } from "@/lib/supabase/server";

import { AuthorizationError, type SessionUser } from "./roles";
import { getSessionUser } from "./session";

/** Whether this request's session passed MFA, read from the verified token. */
const sessionAal = cache(async (): Promise<"aal1" | "aal2" | null> => {
  const supabase = await createClient();
  const { data } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
  return (data?.currentLevel as "aal1" | "aal2" | null) ?? null;
});

/**
 * For every admin page (E10-T2). Anyone who is not a platform admin gets a
 * 404, so the area is never advertised. An admin whose session has not
 * passed MFA is sent to verify it, except on the MFA page itself.
 *
 * The role comes from the profile, read on every request, so removing it
 * takes effect at once. The database checks the same things again in every
 * admin function: this guard only decides what to render.
 */
export async function requirePlatformAdmin({
  allowWithoutMfa = false,
}: { allowWithoutMfa?: boolean } = {}): Promise<SessionUser> {
  const user = await getSessionUser();
  if (!user) redirect("/login");
  if (user.role !== "platform_admin") notFound();
  if (!allowWithoutMfa && (await sessionAal()) !== "aal2") redirect("/admin/mfa");
  return user;
}

/** For admin server actions: throws instead of redirecting. */
export async function assertPlatformAdmin(): Promise<SessionUser> {
  const user = await getSessionUser();
  if (!user) throw new AuthorizationError("unauthenticated");
  if (user.role !== "platform_admin" || (await sessionAal()) !== "aal2") {
    throw new AuthorizationError("forbidden");
  }
  return user;
}
