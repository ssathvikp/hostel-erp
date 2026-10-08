/**
 * Public environment variables, safe to import from client and server code.
 *
 * Each variable is read with a literal `process.env.NEXT_PUBLIC_*` access so
 * Next.js can inline it into the client bundle. Server-only secrets live in
 * `env.server.ts`.
 */

function required(name: string, value: string | undefined): string {
  if (!value) {
    throw new Error(
      `Missing required environment variable ${name}. ` +
        "Copy .env.example to .env.local and fill it in.",
    );
  }
  return value;
}

export const publicEnv = {
  supabaseUrl: required("NEXT_PUBLIC_SUPABASE_URL", process.env.NEXT_PUBLIC_SUPABASE_URL),
  supabaseAnonKey: required(
    "NEXT_PUBLIC_SUPABASE_ANON_KEY",
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
  ),
} as const;

export { required as requiredEnv };
