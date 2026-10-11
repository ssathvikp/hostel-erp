import { notFound } from "next/navigation";

export const dynamic = "force-dynamic";

/**
 * Throws on purpose to prove the error boundary and server logging (E9-T5).
 * The message carries fake personal data and secrets so a log inspection
 * can confirm they are scrubbed. Off unless ENABLE_DIAGNOSTICS=1, so it
 * does not exist in production.
 */
export default function DiagnosticErrorPage() {
  if (process.env.ENABLE_DIAGNOSTICS !== "1") notFound();
  throw new Error(
    "Diagnostic failure for 9876543210, priya.menon@example.com, Aadhaar 1234 5678 9012, " +
      "token eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.c2lnbmF0dXJl, key sb_secret_abc123DEF",
  );
}
