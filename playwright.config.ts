import { existsSync } from "node:fs";

import { defineConfig, devices } from "@playwright/test";

// Test helpers create fixtures with the local Supabase keys from .env.local.
if (existsSync(".env.local")) process.loadEnvFile(".env.local");

/**
 * Browser tests against a production build and the local Supabase stack.
 * Run with `npm run test:e2e` after `npm run db:start` and `npm run env:local`.
 */
export default defineConfig({
  testDir: "tests/e2e",
  fullyParallel: false,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [["github"], ["list"]] : "list",
  // Server actions round-trip through a production build and local Supabase;
  // 10s absorbs a slow machine running both device projects in parallel.
  expect: { timeout: 10_000 },
  use: {
    baseURL: "http://localhost:3000",
    trace: "retain-on-failure",
  },
  projects: [
    { name: "desktop", use: { ...devices["Desktop Chrome"] } },
    { name: "mobile", use: { ...devices["Pixel 7"] } },
  ],
  webServer: {
    // CI builds in an earlier step; locally, build first so tests see current code.
    command: process.env.CI ? "npm run start" : "npm run build && npm run start",
    url: "http://localhost:3000/login",
    reuseExistingServer: !process.env.CI,
    // Turns on /diagnostics/error, which throws on purpose (E9-T5).
    env: { ENABLE_DIAGNOSTICS: "1" },
    timeout: 180_000,
  },
});
