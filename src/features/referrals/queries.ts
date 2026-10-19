import "server-only";

import type { createClient } from "@/lib/supabase/server";

type Supabase = Awaited<ReturnType<typeof createClient>>;

export interface ReferralSummary {
  code: string;
  /** Owners who signed up with the link. */
  signedUp: number;
  /** Of those, how many finished setting up a hostel. */
  setUp: number;
  /** And how many have a paying hostel. */
  paying: number;
}

/**
 * The owner's referral code (created the first time it is asked for) and
 * how their referrals are doing, as counts only (plan E14-T12).
 */
export async function getReferralSummary(supabase: Supabase): Promise<ReferralSummary> {
  const [code, stats] = await Promise.all([
    supabase.rpc("my_referral_code"),
    supabase.rpc("my_referrals"),
  ]);
  if (code.error) throw code.error;
  if (stats.error) throw stats.error;
  const row = (stats.data ?? {}) as { signed_up?: number; set_up?: number; paying?: number };
  return {
    code: code.data,
    signedUp: row.signed_up ?? 0,
    setUp: row.set_up ?? 0,
    paying: row.paying ?? 0,
  };
}
