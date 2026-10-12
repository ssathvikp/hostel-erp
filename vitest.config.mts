import { fileURLToPath } from "node:url";

import { loadEnv } from "vite";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) },
  },
  test: {
    environment: "node",
    projects: [
      {
        extends: true,
        test: {
          name: "unit",
          include: ["tests/unit/**/*.test.ts"],
        },
      },
      {
        // Runs against the local Supabase stack (`npm run db:start`).
        extends: true,
        resolve: {
          alias: {
            "server-only": fileURLToPath(
              new URL("./tests/support/server-only.ts", import.meta.url),
            ),
          },
        },
        test: {
          name: "db",
          include: ["tests/rls/**/*.test.ts", "tests/integration/**/*.test.ts"],
          // .env.local (written by `npm run env:local`) supplies the URLs and keys.
          env: loadEnv("test", process.cwd(), ""),
          // Tests share one database; run files one at a time.
          fileParallelism: false,
          testTimeout: 30_000,
          hookTimeout: 60_000,
        },
      },
    ],
  },
});
