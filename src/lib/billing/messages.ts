/**
 * Plain-language messages for the account rules every write can hit
 * (EP-14): read-only mode (E14-T9) and plan limits (E14-T4). Every server
 * action reaches them through `unexpectedFailure`, so no feature needs to
 * know about billing to explain it.
 */

export const READ_ONLY_MESSAGE =
  "Your account is read-only until its subscription is paid. Everything is still here to view, print and export. The owner can restore access under Settings → Billing.";

const LIMIT_SUFFIX = "Remove some first, or the owner can upgrade under Settings → Billing.";

/** The message for an account-rule error, or undefined for anything else. */
export function accountRuleMessage(error: unknown): string | undefined {
  if (!error || typeof error !== "object") return undefined;
  const { code, hint, message } = error as { code?: unknown; hint?: unknown; message?: unknown };
  if (code !== "P0001" || typeof hint !== "string") return undefined;
  if (hint === "account_read_only") return READ_ONLY_MESSAGE;
  if (/^plan_limit_(beds|hostels|staff)$/.test(hint) && typeof message === "string") {
    return `${message}. ${LIMIT_SUFFIX}`;
  }
  return undefined;
}
