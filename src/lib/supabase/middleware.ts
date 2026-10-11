import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

import { publicEnv } from "@/lib/env";
import { REQUEST_ID_HEADER } from "@/lib/logger";
import type { Database } from "@/types/database";

/**
 * Refreshes the Supabase session on every request and reports who is signed
 * in. Refreshed cookies are written to both the request (so server
 * components in this request see them) and the response (so the browser
 * keeps them).
 *
 * Every request also gets a correlation id, passed to the server (so logs
 * can quote it) and back to the browser.
 */
export async function updateSession(request: NextRequest) {
  // Always minted here: a client-supplied id could forge or pollute log lines.
  const requestId = crypto.randomUUID();

  // Rebuilt after cookies change, so the forwarded headers carry them.
  const next = () => {
    const forwarded = new Headers(request.headers);
    forwarded.set(REQUEST_ID_HEADER, requestId);
    const result = NextResponse.next({ request: { headers: forwarded } });
    result.headers.set(REQUEST_ID_HEADER, requestId);
    return result;
  };

  let response = next();

  const supabase = createServerClient<Database>(publicEnv.supabaseUrl, publicEnv.supabaseAnonKey, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet) {
        for (const { name, value } of cookiesToSet) request.cookies.set(name, value);
        response = next();
        for (const { name, value, options } of cookiesToSet) {
          response.cookies.set(name, value, options);
        }
      },
    },
  });

  // Do not put code between createServerClient and getUser: getUser is what
  // refreshes an expiring session.
  const {
    data: { user },
  } = await supabase.auth.getUser();

  return { response, user };
}

/** A redirect that keeps any session cookies refreshed during this request. */
export function redirectWithCookies(from: NextResponse, url: URL): NextResponse {
  const redirect = NextResponse.redirect(url);
  for (const cookie of from.cookies.getAll()) redirect.cookies.set(cookie);
  const requestId = from.headers.get(REQUEST_ID_HEADER);
  if (requestId) redirect.headers.set(REQUEST_ID_HEADER, requestId);
  return redirect;
}
