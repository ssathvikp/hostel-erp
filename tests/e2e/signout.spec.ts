import { expect, test } from "@playwright/test";

import { createUserFactory, TEST_PASSWORD } from "../support/supabase";
import { inMain, signIn } from "./helpers";

/** /auth/signout ignores requests from other sites (review fix 21). */
const factory = createUserFactory();

test.afterAll(factory.cleanup);

test("another site cannot sign a user out", async ({ page }) => {
  const owner = await factory.createUser({ fullName: "Session Keeper" });
  await factory.createHostel(owner.id, { name: "Keep PG" });
  await signIn(page, owner.email, TEST_PASSWORD);

  const forged = await page.request.get("/auth/signout", {
    headers: { "sec-fetch-site": "cross-site" },
    maxRedirects: 0,
  });
  expect(forged.status()).toBe(307);
  expect(forged.headers().location).toBe("/dashboard");

  await page.goto("/dashboard");
  await expect(inMain(page).getByText("Keep PG at a glance.")).toBeVisible();

  // The app's own redirect still signs out.
  const own = await page.request.get("/auth/signout", {
    headers: { "sec-fetch-site": "same-origin" },
    maxRedirects: 0,
  });
  expect(own.headers().location).toBe("/login?error=access_removed");
  await page.goto("/dashboard");
  await expect(page).toHaveURL(/\/login/);
});
