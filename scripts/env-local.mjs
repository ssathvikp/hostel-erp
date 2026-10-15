#!/usr/bin/env node
/**
 * Writes the Supabase entries in .env.local from the running local stack
 * (`npm run db:start`), so local keys are never copied by hand.
 *
 * Only the managed keys are replaced; any other line already in .env.local
 * (for example CLICKUP_API_TOKEN) is kept as is.
 *
 * Usage: npm run env:local
 */
import { execSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";

const ENV_FILE = ".env.local";

let status;
try {
  // A fixed command string: nothing user-supplied is interpolated into it.
  const raw = execSync("npx supabase status -o json", {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"],
  });
  status = JSON.parse(raw.slice(raw.indexOf("{")));
} catch {
  console.error("Local Supabase is not running. Start it with `npm run db:start` first.");
  process.exit(1);
}

const managed = {
  NEXT_PUBLIC_SUPABASE_URL: status.API_URL,
  NEXT_PUBLIC_SUPABASE_ANON_KEY: status.PUBLISHABLE_KEY,
  SUPABASE_SERVICE_ROLE_KEY: status.SECRET_KEY,
  // Direct Postgres connection, used only by the database test suites.
  SUPABASE_DB_URL: status.DB_URL,
};

for (const [name, value] of Object.entries(managed)) {
  if (!value) {
    console.error(`supabase status did not report a value for ${name}.`);
    process.exit(1);
  }
}

// A local secret for hashing resident ID numbers. Generated once and then
// kept: regenerating it would make existing hashes unmatchable.
const ID_PROOF_KEY = "ID_PROOF_HMAC_KEY";
const existing = existsSync(ENV_FILE) ? readFileSync(ENV_FILE, "utf8") : "";
const generated = [
  ...(/^ID_PROOF_HMAC_KEY=\S+/m.test(existing)
    ? []
    : [`${ID_PROOF_KEY}=${randomBytes(32).toString("hex")}`]),
  // Encrypts owners' own gateway keys (E13-T10); kept once generated, or
  // connected gateways could no longer be read.
  ...(/^PAYMENT_KEYS_ENCRYPTION_KEY=\S+/m.test(existing)
    ? []
    : [`PAYMENT_KEYS_ENCRYPTION_KEY=${randomBytes(32).toString("hex")}`]),
  // Resident complaints work locally without an SMS account: messages go to
  // the server log (E15-T3).
  ...(/^SMS_PROVIDER=\S*/m.test(existing) ? [] : ["SMS_PROVIDER=log"]),
  // Links, QR codes and emails point here.
  ...(/^NEXT_PUBLIC_SITE_URL=\S+/m.test(existing)
    ? []
    : ["NEXT_PUBLIC_SITE_URL=http://localhost:3000"]),
];

const HEADER = "# Local Supabase, written by `npm run env:local`. Safe to regenerate.";

const kept = existsSync(ENV_FILE)
  ? readFileSync(ENV_FILE, "utf8")
      .split(/\r?\n/)
      .filter((line) => line !== HEADER)
      .filter((line) => !Object.keys(managed).some((name) => line.startsWith(`${name}=`)))
      .join("\n")
      .trim()
  : "";

const body = [
  HEADER,
  ...Object.entries(managed).map(([name, value]) => `${name}=${value}`),
  ...generated,
  kept,
]
  .filter(Boolean)
  .join("\n");

writeFileSync(ENV_FILE, `${body}\n`);
console.log(`Wrote ${Object.keys(managed).length} Supabase variables to ${ENV_FILE}.`);
