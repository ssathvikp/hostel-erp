/**
 * Structured server logging (E9-T5). One JSON line per event, with the
 * request's correlation id when there is one.
 *
 * Logs must never hold resident personal data, credentials or keys:
 * - context keys that name personal or secret fields are replaced outright;
 * - every string is scrubbed of phone numbers, emails, ID numbers, tokens
 *   and keys;
 * - database errors are logged by code and hint only, because their message
 *   and details can quote row values (names, phone numbers).
 */

export const REQUEST_ID_HEADER = "x-request-id";

type Level = "info" | "warn" | "error";
export type LogContext = Record<string, unknown>;

/** Keys whose values are never logged, whatever they contain. */
const SECRET_KEYS =
  /pass(word)?|token|secret|api[-_]?key|authorization|cookie|session|e-?mail|phone|mobile|full_?name|address|dob|birth|aadhaar|id_proof|guardian|reference|notes/i;

const SCRUBBERS: [RegExp, string][] = [
  // JSON Web Tokens (Supabase access and refresh tokens, anon/service keys).
  [/\beyJ[\w-]+\.[\w-]+\.[\w-]+/g, "[token]"],
  // Supabase publishable and secret keys.
  [/\bsb_(?:secret|publishable)_[\w-]+/g, "[key]"],
  // Bearer credentials of any shape.
  [/\bBearer\s+\S+/gi, "Bearer [token]"],
  [/[\w.+-]+@[\w-]+(?:\.[\w-]+)+/g, "[email]"],
  // 12-digit Aadhaar numbers, with or without spaces. Not inside ids such as
  // UUIDs, whose last group can be twelve digits.
  [/(?<![\w-])\d{4}\s?\d{4}\s?\d{4}(?![\w-])/g, "[id-number]"],
  // Indian mobile numbers, bare or with a +91, 91 or 0 prefix.
  [/(?<![\w-])(?:\+91[\s-]?|91[\s-]?|0)?[6-9]\d{9}(?!\d)/g, "[phone]"],
  // PAN.
  [/\b[A-Z]{5}\d{4}[A-Z]\b/g, "[id-number]"],
];

export function scrub(text: string): string {
  return SCRUBBERS.reduce(
    (result, [pattern, replacement]) => result.replace(pattern, replacement),
    text,
  );
}

/** Deep-copies `value` with secret keys replaced and every string scrubbed. */
export function redact(value: unknown, depth = 0): unknown {
  if (typeof value === "string") return scrub(value);
  if (value === null || typeof value !== "object") return value;
  if (depth > 5) return "[truncated]";
  if (value instanceof Error) return describeError(value);
  if (Array.isArray(value)) return value.slice(0, 50).map((item) => redact(item, depth + 1));
  return Object.fromEntries(
    Object.entries(value).map(([key, item]) => [
      key,
      SECRET_KEYS.test(key) ? "[redacted]" : redact(item, depth + 1),
    ]),
  );
}

/**
 * A loggable summary of any thrown value. Errors carrying a database code
 * (PostgREST or Postgres) keep only the code and hint.
 */
export function describeError(error: unknown): LogContext {
  if (error && typeof error === "object" && "code" in error && typeof error.code === "string") {
    const { code } = error;
    const hint = "hint" in error && typeof error.hint === "string" ? error.hint : undefined;
    return { kind: "database", code, ...(hint ? { hint: scrub(hint) } : {}) };
  }
  if (error instanceof Error) {
    const digest = "digest" in error && typeof error.digest === "string" ? error.digest : undefined;
    return {
      kind: error.name,
      message: scrub(error.message),
      ...(digest ? { digest } : {}),
      stack: error.stack ? scrub(error.stack).split("\n").slice(0, 8).join("\n") : undefined,
    };
  }
  return { kind: typeof error, message: scrub(String(error)) };
}

function write(level: Level, message: string, context: LogContext = {}) {
  const line = JSON.stringify({
    level,
    time: new Date().toISOString(),
    message: scrub(message),
    ...(redact(context) as LogContext),
  });
  if (level === "error") console.error(line);
  else if (level === "warn") console.warn(line);
  else console.info(line);
}

export const logger = {
  info: (message: string, context?: LogContext) => write("info", message, context),
  warn: (message: string, context?: LogContext) => write("warn", message, context),
  error: (message: string, context?: LogContext) => write("error", message, context),
};

/** Strips the query string, which can carry search text such as names or phone numbers. */
export function pathOnly(url: string): string {
  return url.split("?")[0];
}
