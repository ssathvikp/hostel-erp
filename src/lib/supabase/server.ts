import "server-only";

import { createServerClient } from "@supabase/ssr";
import { cookies, headers } from "next/headers";

import { publicEnv } from "@/lib/env";
import { REQUEST_ID_HEADER } from "@/lib/logger";
import type { Database } from "@/types/database";

/**
 * Supabase client for server components, server actions and route handlers.
 * Reads the user's session from the request cookies, so queries run as that
 * user under RLS. Create one per request; never share it between requests.
 */
export async function createClient() {
  const cookieStore = await cookies();
  // The middleware's correlation id, passed on so database audit rows can
  // quote it (E10-T3).
  const requestId = (await headers()).get(REQUEST_ID_HEADER);

  return createServerClient<Database>(publicEnv.supabaseUrl, publicEnv.supabaseAnonKey, {
    global: { headers: requestId ? { [REQUEST_ID_HEADER]: requestId } : {} },
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          for (const { name, value, options } of cookiesToSet) {
            cookieStore.set(name, value, options);
          }
        } catch {
          // Server components cannot write cookies. Session refresh is
          // handled by the middleware added in EP-02, so this is safe to skip.
        }
      },
    },
  });
}
