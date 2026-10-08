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
  /**
   * Keys the HMAC of resident ID numbers (E5-T1). Changing it makes existing
   * hashes unmatchable, so duplicate detection stops seeing older residents:
   * never rotate it casually.
   */
  idProofHmacKey: requiredEnv("ID_PROOF_HMAC_KEY", process.env.ID_PROOF_HMAC_KEY),
} as const;
