import "server-only";

/**
 * Sends the platform's own emails (billing, suspension) from email_outbox.
 * Auth emails (confirmation, password reset) go through Supabase Auth and
 * its SMTP settings instead (docs/staging.md).
 *
 * Provider: Resend's HTTP API, when RESEND_API_KEY and EMAIL_FROM are set.
 * Any provider with an HTTP API fits behind the same function.
 */
export interface EmailProvider {
  send(input: { to: string; subject: string; text: string }): Promise<{ id: string | null }>;
}

export function emailProvider(): EmailProvider | null {
  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.EMAIL_FROM;
  if (!apiKey || !from) return null;
  return {
    async send({ to, subject, text }) {
      const response = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: { authorization: `Bearer ${apiKey}`, "content-type": "application/json" },
        body: JSON.stringify({ from, to: [to], subject, text }),
        signal: AbortSignal.timeout(10_000),
        cache: "no-store",
      });
      const json = (await response.json().catch(() => null)) as {
        id?: string;
        message?: string;
      } | null;
      if (!response.ok) throw new Error(json?.message ?? `Email provider error ${response.status}`);
      return { id: json?.id ?? null };
    },
  };
}
