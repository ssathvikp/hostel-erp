import { expect, test } from "@playwright/test";

import { createUserFactory, TEST_PASSWORD } from "../support/supabase";
import { inMain, openNavigation, signIn } from "./helpers";

/** The error boundary and request correlation (E9-T5). */
const factory = createUserFactory();

test.afterAll(factory.cleanup);

test("an unhandled server error shows a friendly page with a reference, never internals", async ({
  page,
}) => {
  const owner = await factory.createUser();
  await factory.createHostel(owner.id);
  await signIn(page, owner.email, TEST_PASSWORD);

  const response = await page.goto("/diagnostics/error");
  expect(response?.headers()["x-request-id"]).toMatch(/^[0-9a-f-]{36}$/);

  const alert = inMain(page).getByRole("alert");
  await expect(alert.getByRole("heading", { name: "Something went wrong" })).toBeVisible();
  await expect(alert.getByText(/^Reference: \w+/)).toBeVisible();
  // The thrown message (with fake personal data) never reaches the browser.
  await expect(page.getByText(/9876543210|priya\.menon|sb_secret/)).toHaveCount(0);

  // The shell still works around the failed page.
  await openNavigation(page);
  await page.getByRole("link", { name: "Dashboard" }).first().click();
  await expect(page).toHaveURL(/\/dashboard$/);
});

test("every response carries its own correlation id", async ({ request }) => {
  const first = await request.get("/login");
  const second = await request.get("/login", { headers: { "x-request-id": "forged" } });
  const a = first.headers()["x-request-id"];
  const b = second.headers()["x-request-id"];
  expect(a).toMatch(/^[0-9a-f-]{36}$/);
  expect(b).toMatch(/^[0-9a-f-]{36}$/);
  expect(b).not.toBe(a);
});

test("a page number past the end of a list goes back to the first page, not an error", async ({
  page,
}) => {
  const owner = await factory.createUser();
  await factory.createHostel(owner.id);
  await signIn(page, owner.email, TEST_PASSWORD);

  for (const [stale, first] of [
    ["/fees?status=paid&page=5", /\/fees\?status=paid$/],
    ["/residents?status=all&page=3", /\/residents\?status=all$/],
    ["/rooms?floor=1&page=4", /\/rooms\?floor=1$/],
  ] as const) {
    await page.goto(stale);
    await expect(page).toHaveURL(first);
    await expect(inMain(page).getByRole("heading", { level: 1 })).toBeVisible();
    await expect(inMain(page).getByText("Something went wrong")).toHaveCount(0);
  }
});

test("every response carries the security headers", async ({ request }) => {
  const headers = (await request.get("/login")).headers();
  expect(headers["content-security-policy"]).toContain("frame-ancestors 'none'");
  expect(headers["x-frame-options"]).toBe("DENY");
  expect(headers["x-content-type-options"]).toBe("nosniff");
  expect(headers["referrer-policy"]).toBe("strict-origin-when-cross-origin");
  expect(headers["x-powered-by"]).toBeUndefined();
});
