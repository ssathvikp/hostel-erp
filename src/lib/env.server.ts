import "server-only";

import { requiredEnv } from "./env";

/**
 * Server-only secrets. The `server-only` import makes the build fail if this
 * module is ever pulled into a client component.
 */
export const serverEnv = {
  supabaseServiceRoleKey: requiredEnv(
    "SUPABASE_SERVICE_ROLE_KEY",
    process.env.SUPABASE_SERVICE_ROLE_KEY,
  ),
} as const;
