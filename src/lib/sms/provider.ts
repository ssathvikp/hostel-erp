import "server-only";

import { logger } from "@/lib/logger";

import { fillTemplate, type SmsKind } from "./messages";

/**
 * Sends SMS to residents (E15-T3, T4) through the provider in SMS_PROVIDER:
 *
 * - `msg91`: MSG91's Flow API with DLT-registered templates. Needs
 *   MSG91_AUTH_KEY and one template id per message kind
 *   (MSG91_TEMPLATE_RESIDENT_CODE, MSG91_TEMPLATE_COMPLAINT_UPDATE).
 * - `log`: writes the message to the server log instead of sending it. For
 *   local development and tests only; never in production.
 *
 * Unset means resident reporting is switched off: the room page says so.
 */
export interface SmsProvider {
  name: "msg91" | "log";
  send(input: { to: string; kind: SmsKind; variables: string[] }): Promise<{ id: string | null }>;
}

class SmsError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SmsError";
  }
}

function msg91(): SmsProvider | null {
  const authKey = process.env.MSG91_AUTH_KEY;
  const templates: Record<SmsKind, string | undefined> = {
    resident_code: process.env.MSG91_TEMPLATE_RESIDENT_CODE,
    complaint_update: process.env.MSG91_TEMPLATE_COMPLAINT_UPDATE,
  };
  if (!authKey || !templates.resident_code || !templates.complaint_update) return null;
  return {
    name: "msg91",
    async send({ to, kind, variables }) {
      // Flow API: the template is registered with MSG91 and DLT; variables
      // are named var1, var2... in template order.
      const recipient: Record<string, string> = { mobiles: `91${to}` };
      variables.forEach((value, i) => {
        recipient[`var${i + 1}`] = value;
      });
      const response = await fetch("https://control.msg91.com/api/v5/flow", {
        method: "POST",
        headers: {
          authkey: authKey,
          "content-type": "application/json",
          accept: "application/json",
        },
        body: JSON.stringify({
          template_id: templates[kind],
          short_url: "0",
          recipients: [recipient],
        }),
        signal: AbortSignal.timeout(10_000),
        cache: "no-store",
      });
      const json = (await response.json().catch(() => null)) as {
        type?: string;
        message?: string;
        request_id?: string;
      } | null;
      if (!response.ok || json?.type === "error") {
        throw new SmsError(json?.message ?? `SMS provider error ${response.status}`);
      }
      return { id: json?.request_id ?? json?.message ?? null };
    },
  };
}

const logProvider: SmsProvider = {
  name: "log",
  async send({ to, kind, variables }) {
    // The logger scrubs phone numbers; the test suite reads codes from the
    // database instead (resident_codes keeps only a hash, so tests use the
    // value the request function returns).
    logger.info("SMS (log provider, not sent)", { to, kind, text: fillTemplate(kind, variables) });
    return { id: null };
  },
};

export function smsProvider(): SmsProvider | null {
  switch (process.env.SMS_PROVIDER) {
    case "msg91":
      return msg91();
    case "log":
      return logProvider;
    default:
      return null;
  }
}
