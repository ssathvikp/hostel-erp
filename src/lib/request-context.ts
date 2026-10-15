import "server-only";

import { headers } from "next/headers";

import { accountRuleMessage } from "./billing/messages";
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
 * Logs the failure and returns the generic message for the form. Account
 * rules (read-only mode, plan limits) are explained instead: they are
 * expected, and the user can act on them.
 */
export async function unexpectedFailure(
  action: string,
  error: unknown,
  values?: Record<string, string>,
): Promise<FormState> {
  const accountMessage = accountRuleMessage(error);
  if (accountMessage) return formFailure(accountMessage, values);
  await logUnexpected(action, error);
  return formFailure(UNEXPECTED_MESSAGE, values);
}
