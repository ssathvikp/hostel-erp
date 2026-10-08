import "server-only";

import { redirect } from "next/navigation";
import { cache } from "react";

import { createClient } from "@/lib/supabase/server";
import type { ProfileRole } from "@/types";

import { assertRole, loadSessionUser, type SessionUser } from "./roles";

/** The current user, resolved at most once per request. */
export const getSessionUser = cache(async (): Promise<SessionUser | null> => {
  return loadSessionUser(await createClient());
});

/**
 * For pages and layouts: returns the user or redirects to sign-in. This is
 * the second line of defence behind the middleware, which must never be the
 * only check.
 */
export async function requireUser(): Promise<SessionUser> {
  const user = await getSessionUser();
  if (!user) redirect("/login");
  return user;
}

/**
 * For server actions and route handlers: returns the user or throws an
 * AuthorizationError before any database work happens. Call it first in
 * every action; a UI-only check is decoration.
 */
export async function requireRole(roles: readonly ProfileRole[]): Promise<SessionUser> {
  return assertRole(await getSessionUser(), roles);
}
