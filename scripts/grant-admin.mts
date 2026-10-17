#!/usr/bin/env node
/**
 * Makes an existing account a platform admin (EP-10), for the people who
 * run Hostel ERP. Admins see every hostel in /admin, set plans and trials,
 * and suspend hostels; they never work inside a hostel.
 *
 * The account must already exist (sign up first) and must not own a hostel
 * or be staff somewhere: an admin belongs to no hostel.
 *
 * Usage:
 *   npm run admin:grant -- someone@example.com            (local stack)
 *   node --env-file=.env.staging scripts/grant-admin.mts someone@example.com
 */
import { createClient } from "@supabase/supabase-js";

const email = process.argv[2]?.trim().toLowerCase();
const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!email || !url || !serviceKey) {
  console.error(
    "Usage: npm run admin:grant -- <email>\nNeeds NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY (from .env.local, or --env-file).",
  );
  process.exit(1);
}

const admin = createClient(url, serviceKey, {
  auth: { autoRefreshToken: false, persistSession: false },
});

const { data: accounts, error } = await admin.rpc("account_by_email", { p_email: email });
if (error) {
  console.error(`Could not look up ${email}: ${error.message}`);
  process.exit(1);
}
const account = accounts?.[0];
if (!account) {
  console.error(`No account for ${email}. Sign up with that address first.`);
  process.exit(1);
}
if (account.role === "platform_admin") {
  console.log(`${email} is already a platform admin.`);
  process.exit(0);
}
if (account.role === "staff") {
  console.error(`${email} is staff of a hostel. Use a separate address for the admin account.`);
  process.exit(1);
}

const { count } = await admin
  .from("hostels")
  .select("id", { count: "exact", head: true })
  .eq("owner_id", account.user_id);
if (count) {
  console.error(`${email} owns ${count} hostel(s). Use a separate address for the admin account.`);
  process.exit(1);
}

const { error: updateError } = await admin
  .from("profiles")
  .update({ role: "platform_admin", hostel_id: null })
  .eq("id", account.user_id);
if (updateError) {
  console.error(`Could not update ${email}: ${updateError.message}`);
  process.exit(1);
}
console.log(`${email} is now a platform admin. They sign in as usual and land on /admin.`);
