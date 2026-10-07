/**
 * Reads auth emails from the local mail catcher (Mailpit, port 54324), so
 * tests can follow confirmation and reset links exactly as a user would.
 */
const MAILPIT = process.env.MAILPIT_URL ?? "http://127.0.0.1:54324";

interface MessageSummary {
  ID: string;
  Subject: string;
}

async function search(to: string): Promise<MessageSummary[]> {
  const query = encodeURIComponent(`to:"${to}"`);
  const response = await fetch(`${MAILPIT}/api/v1/search?query=${query}`);
  if (!response.ok) throw new Error(`Mailpit search failed: ${response.status}`);
  const body = (await response.json()) as { messages: MessageSummary[] };
  return body.messages;
}

/** Waits for the newest email to `to` whose subject contains `subject`. */
export async function waitForEmail(
  to: string,
  subject: string,
  { timeoutMs = 10_000 } = {},
): Promise<{ subject: string; html: string }> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const match = (await search(to)).find((message) => message.Subject.includes(subject));
    if (match) {
      const response = await fetch(`${MAILPIT}/api/v1/message/${match.ID}`);
      const message = (await response.json()) as { Subject: string; HTML: string };
      return { subject: message.Subject, html: message.HTML };
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`No email to ${to} with subject containing "${subject}" within ${timeoutMs}ms`);
}

/** How many emails `to` has received in total. */
export async function countEmails(to: string): Promise<number> {
  return (await search(to)).length;
}

/** Extracts the /auth/confirm link and its parameters from an email body. */
export function confirmLink(html: string) {
  const match = html.match(/href="([^"]*\/auth\/confirm\?[^"]+)"/);
  if (!match?.[1]) throw new Error("No /auth/confirm link found in email");
  const url = new URL(match[1].replaceAll("&amp;", "&"));
  return {
    url,
    tokenHash: url.searchParams.get("token_hash") ?? "",
    type: url.searchParams.get("type") ?? "",
    next: url.searchParams.get("next") ?? "",
  };
}
