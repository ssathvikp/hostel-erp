import "server-only";

import { headers } from "next/headers";

import { describeError, logger, REQUEST_ID_HEADER } from "./logger";
import { formFailure, type FormState } from "./validation";

/** What the user sees when something fails that they cannot fix. */
export const UNEXPECTED_MESSAGE = "Something went wrong on our side. Try again in a moment.";

/** The correlation id the middleware gave this request, if any. */
export async function requestId(): Promise<string | undefined> {
  try {
    return (await headers()).get(REQUEST_ID_HEADER) ?? undefined;
  } catch {
    // Outside a request (build time, scripts).
    return undefined;
  }
}

/**
 * Logs an error a server action could not explain to the user, who sees a
 * generic message with no internals. Without this the failure would be
 * invisible.
 */
export async function logUnexpected(action: string, error: unknown): Promise<void> {
  logger.error("Server action failed", {
    requestId: await requestId(),
    action,
    error: describeError(error),
  });
}

/**
 * Rules that hold for every write, whichever form made it (ClickUp EP-14):
 * the account is read-only, or a plan limit is reached. Their database
 * message is written for the user.
 */
const ACCOUNT_HINTS = new Set(["account_read_only", "plan_limit"]);

export const READ_ONLY_MESSAGE =
  "This account is read-only, so nothing can be changed. The owner can choose a plan in Settings → Billing.";

/** The message for an account-wide refusal, or null for any other error. */
export function accountRuleMessage(error: unknown): string | null {
  if (!error || typeof error !== "object") return null;
  const { code, hint, message } = error as { code?: string; hint?: string; message?: string };
  if (code !== "P0001" || !hint || !ACCOUNT_HINTS.has(hint)) return null;
  return hint === "account_read_only" ? READ_ONLY_MESSAGE : (message ?? null);
}

/**
 * Logs the failure and returns the generic message for the form. A read-only
 * account or a plan limit is not a failure: the user sees why instead.
 */
export async function unexpectedFailure(
  action: string,
  error: unknown,
  values?: Record<string, string>,
): Promise<FormState> {
  const rule = accountRuleMessage(error);
  if (rule) return formFailure(rule, values);
  await logUnexpected(action, error);
  return formFailure(UNEXPECTED_MESSAGE, values);
}
