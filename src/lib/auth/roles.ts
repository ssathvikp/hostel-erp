import type { SupabaseClient } from "@supabase/supabase-js";

import { PROFILE_ROLES, type ProfileRole, type Uuid } from "@/types";
import type { Database } from "@/types/database";

/** The signed-in user as the app sees them: auth identity plus profile. */
export interface SessionUser {
  id: Uuid;
  email: string;
  fullName: string;
  role: ProfileRole;
  /** Staff only: the hostel they belong to. */
  hostelId: Uuid | null;
}

export type AuthorizationFailure = "unauthenticated" | "forbidden";

/**
 * Thrown by guards before any database write. Server actions catch it and
 * return a generic message; it never reaches the client as a stack trace.
 */
export class AuthorizationError extends Error {
  constructor(readonly reason: AuthorizationFailure) {
    super(
      reason === "unauthenticated"
        ? "You need to sign in to do that."
        : "You do not have permission to do that.",
    );
    this.name = "AuthorizationError";
  }
}

function isProfileRole(value: string): value is ProfileRole {
  return (PROFILE_ROLES as readonly string[]).includes(value);
}

/**
 * Resolves the user behind a Supabase client. `getUser()` revalidates the
 * token with Supabase Auth (unlike `getSession()`), so the result is safe to
 * authorize on. A user without a readable, valid profile is treated as
 * signed out rather than given a default role.
 */
export async function loadSessionUser(
  client: SupabaseClient<Database>,
): Promise<SessionUser | null> {
  const {
    data: { user },
  } = await client.auth.getUser();
  if (!user) return null;

  const { data: profile } = await client
    .from("profiles")
    .select("full_name, role, hostel_id")
    .eq("id", user.id)
    .maybeSingle();
  if (!profile || !isProfileRole(profile.role)) return null;

  return {
    id: user.id,
    email: user.email ?? "",
    fullName: profile.full_name,
    role: profile.role,
    hostelId: profile.hostel_id,
  };
}

/** Throws unless `user` is signed in with one of `roles`. */
export function assertRole(user: SessionUser | null, roles: readonly ProfileRole[]): SessionUser {
  if (!user) throw new AuthorizationError("unauthenticated");
  if (!roles.includes(user.role)) throw new AuthorizationError("forbidden");
  return user;
}

/** Platform-admin capability flag. No UI uses it in the MVP (EP-10). */
export function isPlatformAdmin(user: SessionUser | null): boolean {
  return user?.role === "platform_admin";
}
