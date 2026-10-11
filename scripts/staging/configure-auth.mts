#!/usr/bin/env node
/**
 * Applies the staging project's Auth settings through the Supabase
 * Management API: site URL, redirect allow-list, password and session rules,
 * custom SMTP, and the email subjects and templates (E1-T3, E9-T4).
 *
 * Usage (values come from .env.staging or the environment, never from arguments):
 *   node scripts/staging/configure-auth.mts --dry-run   # print, send nothing
 *   node scripts/staging/configure-auth.mts             # apply
 *
 * See docs/staging.md for where each value comes from.
 */
import { existsSync } from "node:fs";

import { AUTH_ENV, buildAuthConfig, describeAuthConfig, missingEnv } from "./auth-config.mts";

if (existsSync(".env.staging")) process.loadEnvFile(".env.staging");

const dryRun = process.argv.includes("--dry-run");
const env = process.env as Record<string, string | undefined>;

const missing = missingEnv(env).filter(
  // A dry run never calls the API, so it does not need the token.
  (name) => !(dryRun && (name === "SUPABASE_ACCESS_TOKEN" || name === "SMTP_PASS")),
);
if (missing.length > 0) {
  console.error(`Missing: ${missing.join(", ")}. Every variable is listed in docs/staging.md.`);
  console.error(`Required: ${AUTH_ENV.join(", ")}.`);
  process.exit(1);
}

let config;
try {
  config = buildAuthConfig(env, process.cwd());
} catch (error) {
  console.error((error as Error).message);
  process.exit(1);
}

const ref = env.STAGING_PROJECT_REF!;
if (!/^[a-z0-9]{20}$/.test(ref)) {
  console.error("STAGING_PROJECT_REF must be the 20-character project ref from the dashboard URL.");
  process.exit(1);
}

console.log(`Auth settings for project ${ref}:`);
console.log(JSON.stringify(describeAuthConfig(config), null, 2));

if (dryRun) {
  console.log("\nDry run: nothing was sent.");
  process.exit(0);
}

const response = await fetch(`https://api.supabase.com/v1/projects/${ref}/config/auth`, {
  method: "PATCH",
  headers: {
    Authorization: `Bearer ${env.SUPABASE_ACCESS_TOKEN}`,
    "Content-Type": "application/json",
  },
  body: JSON.stringify(config),
});

if (!response.ok) {
  // The body names the rejected field; it never echoes the token or password.
  console.error(`Supabase rejected the settings (${response.status}): ${await response.text()}`);
  process.exit(1);
}
console.log("\nApplied.");
