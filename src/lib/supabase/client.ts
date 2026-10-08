import { createBrowserClient } from "@supabase/ssr";

import { publicEnv } from "@/lib/env";
import type { Database } from "@/types/database";

/**
 * Supabase client for client components. Uses the anon key only, so every
 * query is subject to RLS.
 */
export function createClient() {
  return createBrowserClient<Database>(publicEnv.supabaseUrl, publicEnv.supabaseAnonKey);
}
