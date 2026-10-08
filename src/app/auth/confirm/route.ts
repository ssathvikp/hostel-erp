import type { EmailOtpType } from "@supabase/supabase-js";
import { redirect } from "next/navigation";
import type { NextRequest } from "next/server";

import { safeNextPath } from "@/lib/auth/redirect";
import { createClient } from "@/lib/supabase/server";

/** Only the link types our email templates send. */
const HANDLED_TYPES: readonly EmailOtpType[] = ["email", "signup", "recovery"];

function isHandledType(value: string | null): value is EmailOtpType {
  return value !== null && (HANDLED_TYPES as readonly string[]).includes(value);
}

/**
 * Landing point for links in confirmation and password-reset emails. Verifies
 * the one-time token, which starts a session, then continues to `next`.
 * Expired, reused or tampered links go to a page that explains what to do.
 */
export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  const tokenHash = params.get("token_hash");
  const type = params.get("type");

  if (tokenHash && isHandledType(type)) {
    const supabase = await createClient();
    const { error } = await supabase.auth.verifyOtp({ type, token_hash: tokenHash });
    if (!error) redirect(safeNextPath(params.get("next")));
  }

  redirect(
    type === "recovery" ? "/forgot-password?error=link_invalid" : "/login?error=link_invalid",
  );
}
