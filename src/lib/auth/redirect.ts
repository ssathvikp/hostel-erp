/** Where a signed-in user lands when no (valid) destination was requested. */
export const DEFAULT_SIGNED_IN_PATH = "/dashboard";

/**
 * Returns `next` only if it is a same-site relative path, so a `?next=`
 * parameter can never be used to bounce a user to another origin.
 *
 * Rejected: absolute URLs, protocol-relative `//evil.com`, backslash tricks
 * (`/\evil.com`, which browsers normalise to `//`), and control characters.
 */
export function safeNextPath(next: unknown, fallback = DEFAULT_SIGNED_IN_PATH): string {
  if (typeof next !== "string" || next.length === 0 || next.length > 2048) return fallback;
  if (!next.startsWith("/")) return fallback;
  if (next.startsWith("//") || next.startsWith("/\\")) return fallback;
  if (/[\u0000-\u001f\u007f\\]/.test(next)) return fallback;

  // Final check: resolving against a dummy origin must not change the origin.
  try {
    const resolved = new URL(next, "http://localhost");
    if (resolved.origin !== "http://localhost") return fallback;
    return `${resolved.pathname}${resolved.search}${resolved.hash}`;
  } catch {
    return fallback;
  }
}
