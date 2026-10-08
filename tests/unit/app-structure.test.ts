import { readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";

import { describe, expect, it } from "vitest";

const APP_DIR = join(process.cwd(), "src", "app");

function findFiles(dir: string, name: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) return findFiles(path, name);
    return entry === name ? [relative(APP_DIR, path).replaceAll("\\", "/")] : [];
  });
}

describe("app structure", () => {
  it("has no route-level loading.tsx above pages that run server actions", () => {
    // A loading.tsx Suspense boundary around a page whose server actions
    // revalidate it makes those actions hang intermittently with the React
    // build bundled in Next.js 15.5 (facebook/react#35518). Pending feedback
    // comes from the navigation links instead; see AppShell.
    expect(findFiles(APP_DIR, "loading.tsx")).toEqual([]);
  });
});
