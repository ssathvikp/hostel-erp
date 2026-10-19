#!/usr/bin/env node
/**
 * Makes an existing account a platform admin (EP-10), for the people who
 * run Hostel ERP. Admins see every hostel in /admin, set plans and trials,
 * and suspend hostels; they never work inside a hostel.
 *
 * The account must already exist (sign up first) and must not own a hostel
 * or be staff somewhere: an admin belongs to no hostel.
 *
 * Admins confirm every sign-in with an authenticator app (ClickUp E10-T1).
 * See docs/admin.md for who may add or remove an admin.
 *
 * Usage:
 *   npm run admin:grant -- someone@example.com             make them an admin
 *   npm run admin:grant -- --revoke someone@example.com    make them an owner again
 *   npm run admin:grant -- --reset-mfa someone@example.com remove their authenticator
 *                                                           (lost phone); they set up
 *                                                           a new one at next sign-in
 *   node --env-file=.env.staging scripts/grant-admin.mts [--revoke|--reset-mfa] <email>
 */
import { createClient } from "@supabase/supabase-js";

const args = process.argv.slice(2);
const mode = args.includes("--revoke")
  ? "revoke"
  : args.includes("--reset-mfa")
    ? "reset-mfa"
    : "grant";
const email = args
  .find((arg) => !arg.startsWith("--"))
  ?.trim()
  .toLowerCase();
const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!email || !url || !serviceKey) {
  console.error(
    "Usage: npm run admin:grant -- [--revoke|--reset-mfa] <email>\nNeeds NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY (from .env.local, or --env-file).",
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
/** Ends every session so a change takes effect at once, not at token expiry. */
async function signOutEverywhere(userId: string) {
  const { error: signOutError } = await admin.rpc("account_sign_out", { p_user_id: userId });
  if (signOutError) {
    console.error(`Could not end ${email}'s sessions: ${signOutError.message}`);
    process.exit(1);
  }
}

if (mode === "revoke" || mode === "reset-mfa") {
  if (account.role !== "platform_admin") {
    console.error(`${email} is not a platform admin.`);
    process.exit(1);
  }
  const { data: factors, error: factorError } = await admin.auth.admin.mfa.listFactors({
    userId: account.user_id,
  });
  if (factorError) {
    console.error(`Could not read ${email}'s authenticators: ${factorError.message}`);
    process.exit(1);
  }
  for (const factor of factors?.factors ?? []) {
    const { error: deleteError } = await admin.auth.admin.mfa.deleteFactor({
      userId: account.user_id,
      id: factor.id,
    });
    if (deleteError) {
      console.error(`Could not remove an authenticator: ${deleteError.message}`);
      process.exit(1);
    }
  }
  if (mode === "revoke") {
    const { error: revokeError } = await admin
      .from("profiles")
      .update({ role: "owner" })
      .eq("id", account.user_id);
    if (revokeError) {
      console.error(`Could not revoke ${email}: ${revokeError.message}`);
      process.exit(1);
    }
  }
  await signOutEverywhere(account.user_id);
  console.log(
    mode === "revoke"
      ? `${email} is no longer a platform admin and has been signed out everywhere.`
      : `${email}'s authenticator was removed and they were signed out. They set up a new one at their next sign-in.`,
  );
  process.exit(0);
}

if (account.role === "platform_admin") {
  console.log(`${email} is already a platform admin.`);
  process.exit(0);
}
if (account.role === "staff") {
  console.error(`${email} is staff of a hostel. Use a separate address for the admin account.`);
  process.exit(1);
}

const { count, error: countError } = await admin
  .from("hostels")
  .select("id", { count: "exact", head: true })
  .eq("owner_id", account.user_id);
if (countError || count === null) {
  console.error(`Could not check ${email}'s hostels: ${countError?.message ?? "no count"}`);
  process.exit(1);
}
if (count > 0) {
  console.error(`${email} owns ${count} hostel(s). Use a separate address for the admin account.`);
  process.exit(1);
}

const { data: updated, error: updateError } = await admin
  .from("profiles")
  .update({ role: "platform_admin", hostel_id: null })
  .eq("id", account.user_id)
  .select("id");
if (updateError || !updated?.length) {
  console.error(`Could not update ${email}: ${updateError?.message ?? "no profile row"}`);
  process.exit(1);
}
console.log(
  `${email} is now a platform admin. At their next sign-in they set up an authenticator app, then land on /admin.`,
);
