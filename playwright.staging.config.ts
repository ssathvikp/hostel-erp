import { existsSync } from "node:fs";

import { defineConfig, devices } from "@playwright/test";

/**
 * The smoke journey (signup to payment) against a deployed site:
 * `npm run test:staging`. Reads .env.staging, which holds the staging
 * project's URL and keys (docs/staging.md); nothing is started locally.
 *
 * It creates one throwaway owner and hostel and deletes them afterwards.
 */
if (!existsSync(".env.staging")) {
  throw new Error("Create .env.staging first: see docs/staging.md.");
}
process.loadEnvFile(".env.staging");
process.env.SMOKE_TARGET = "staging";

const baseURL = process.env.STAGING_SITE_URL;
if (!baseURL?.startsWith("https://")) {
  throw new Error("STAGING_SITE_URL in .env.staging must be the https:// address of the site.");
}

export default defineConfig({
  testDir: "tests/e2e",
  testMatch: "smoke.spec.ts",
  retries: 0,
  reporter: "list",
  // A deployed site on a free tier can be slow to wake.
  expect: { timeout: 20_000 },
  use: { baseURL, trace: "retain-on-failure" },
  projects: [{ name: "desktop", use: { ...devices["Desktop Chrome"] } }],
});
