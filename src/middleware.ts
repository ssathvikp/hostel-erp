import type { NextRequest } from "next/server";

import { DEFAULT_SIGNED_IN_PATH } from "@/lib/auth/redirect";
import { redirectWithCookies, updateSession } from "@/lib/supabase/middleware";

/** Every route in the (app) group. Keep in sync when an epic adds a section. */
const PROTECTED_PREFIXES = [
  "/dashboard",
  "/onboarding",
  "/rooms",
  "/residents",
  "/occupancy",
  "/fees",
  "/complaints",
  "/reports",
  "/settings",
  "/admin",
];

/** Pages a signed-in user has no reason to see. */
const SIGNED_OUT_ONLY = ["/login", "/signup", "/forgot-password"];

function matches(pathname: string, prefixes: readonly string[]) {
  return prefixes.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`));
}

export async function middleware(request: NextRequest) {
  const { response, user } = await updateSession(request);
  const { pathname, search } = request.nextUrl;

  if (!user && matches(pathname, PROTECTED_PREFIXES)) {
    const login = new URL("/login", request.url);
    login.searchParams.set("next", `${pathname}${search}`);
    return redirectWithCookies(response, login);
  }

  if (user && matches(pathname, SIGNED_OUT_ONLY)) {
    return redirectWithCookies(response, new URL(DEFAULT_SIGNED_IN_PATH, request.url));
  }

  return response;
}

export const config = {
  // Everything except static assets, so sessions refresh on every navigation.
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)",
  ],
};
