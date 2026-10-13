/**
 * Grants or removes the platform admin role (E10-T1). This and a SQL
 * migration are the only ways to make someone an admin: no app screen or
 * API path can. It runs with the service role key, so only an operator who
 * holds that key can run it. See docs/admin.md.
 *
 * Usage:
 *   node scripts/admin/grant-admin.mts grant  <email>
 *   node scripts/admin/grant-admin.mts revoke <email>
 *
 * Reads NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY from the
 * environment, or from .env.local when present.
 */
import { existsSync } from "node:fs";

import { createClient } from "@supabase/supabase-js";

if (existsSync(".env.local")) process.loadEnvFile(".env.local");

const [command, rawEmail] = process.argv.slice(2);
const email = rawEmail?.trim().toLowerCase();
if (!["grant", "revoke"].includes(command ?? "") || !email) {
  console.error("Usage: node scripts/admin/grant-admin.mts grant|revoke <email>");
  process.exit(1);
}

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !serviceKey) {
  console.error("NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set.");
  process.exit(1);
}

const admin = createClient(url, serviceKey, {
  auth: { autoRefreshToken: false, persistSession: false },
});

async function findUser(address: string) {
  for (let page = 1; ; page++) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 1000 });
    if (error) throw error;
    const user = data.users.find((u) => u.email?.toLowerCase() === address);
    if (user || data.users.length < 1000) return user ?? null;
  }
}

const user = await findUser(email);
if (!user) {
  console.error(`No account for ${email}. The person signs up first, then you grant the role.`);
  process.exit(1);
}

const { data: profile, error: profileError } = await admin
  .from("profiles")
  .select("role, hostel_id")
  .eq("id", user.id)
  .single();
if (profileError) throw profileError;

if (command === "grant") {
  if (profile.role === "platform_admin") {
    console.log(`${email} is already a platform admin.`);
    process.exit(0);
  }
  // An admin account is only an admin account: never also a customer.
  const { count, error } = await admin
    .from("hostels")
    .select("id", { count: "exact", head: true })
    .eq("owner_id", user.id);
  if (error) throw error;
  if (profile.role !== "owner" || (count ?? 0) > 0) {
    console.error(
      `${email} is a ${profile.role} with ${count ?? 0} hostel(s). Use a separate account for admin work.`,
    );
    process.exit(1);
  }
}

const { error } = await admin
  .from("profiles")
  .update({ role: command === "grant" ? "platform_admin" : "owner" })
  .eq("id", user.id);
if (error) throw error;

console.log(
  command === "grant"
    ? `${email} is now a platform admin. They sign in and set up their authenticator app at /admin/mfa.`
    : `${email} is no longer a platform admin. Their next request is refused, whatever session they hold.`,
);
