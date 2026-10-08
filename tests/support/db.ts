import postgres from "postgres";

/**
 * Direct superuser connection to the local Supabase database, for tests that
 * inspect the schema itself. Never use it to test access rules: it bypasses
 * RLS. Access-rule tests go through supabase-js clients signed in as users.
 */
export function connectToDatabase() {
  const url = process.env.SUPABASE_DB_URL;
  if (!url) {
    throw new Error(
      "SUPABASE_DB_URL is not set. Start Supabase with `npm run db:start`, then run `npm run env:local`.",
    );
  }
  return postgres(url, { max: 1, onnotice: () => {} });
}
