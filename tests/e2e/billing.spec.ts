import { expect, test } from "@playwright/test";

import { todayIst } from "@/lib/validation";

import { createUserFactory, TEST_PASSWORD } from "../support/supabase";
import { completeAdminMfa, inMain, signIn } from "./helpers";

/** Plans, trials, read-only mode and the admin's subscription controls (ClickUp EP-14). */
const factory = createUserFactory();
const { admin } = factory;

test.afterAll(factory.cleanup);

const yesterday = new Date(Date.parse(`${todayIst()}T00:00:00Z`) - 86_400_000)
  .toISOString()
  .slice(0, 10);

test("an owner sees their trial and usage, and a lapsed trial makes the account read-only", async ({
  page,
}) => {
  const owner = await factory.createUser();
  const hostel = await factory.createHostel(owner.id);

  await signIn(page, owner.email, TEST_PASSWORD);
  await page.goto("/settings/billing");
  await expect(page.getByRole("heading", { name: "Pro", level: 2 })).toBeVisible();
  await expect(page.getByText("Free trial", { exact: true })).toBeVisible();
  await expect(
    page.getByRole("table", { name: "Plans on offer" }).getByText("Starter"),
  ).toBeVisible();

  await admin.from("subscriptions").update({ trial_ends_at: yesterday }).eq("owner_id", owner.id);
  await page.goto("/rooms/new");
  await expect(page.getByText("Your free trial has ended")).toBeVisible();
  await page.getByLabel(/^Room number/).fill("101");
  await page.getByLabel(/^Floor/).fill("1");
  await page.getByLabel(/^Sharing type/).selectOption("single");
  await page.getByRole("button", { name: "Create room" }).click();
  await expect(
    page.getByText(/This account is read-only, so nothing can be changed/),
  ).toBeVisible();
  void hostel;
});

test("a platform admin lifts read-only mode by setting the owner's plan", async ({ page }) => {
  test.slow();
  const owner = await factory.createUser({ fullName: "Lapsed Owner" });
  await factory.createHostel(owner.id);
  await admin.from("subscriptions").update({ trial_ends_at: yesterday }).eq("owner_id", owner.id);
  const platformAdmin = await factory.createUser({ profile: { role: "platform_admin" } });

  await signIn(page, platformAdmin.email, TEST_PASSWORD);
  await completeAdminMfa(page);
  await page.goto(`/admin/owners/${owner.id}`);
  const section = inMain(page).getByRole("region", { name: "Subscription" });
  await expect(section.getByText("Read-only", { exact: true }).first()).toBeVisible();
  await section.getByLabel("Plan").selectOption("starter");
  await section.getByLabel("Status").selectOption("active");
  await section.getByLabel(/^Reason/).fill("Paid by UPI for October");
  await section.getByRole("button", { name: "Save subscription" }).click();
  await expect(section.getByText("Subscription saved.")).toBeVisible();
  await expect(section.getByText("Active", { exact: true }).first()).toBeVisible();

  await page.goto("/admin/plans");
  await expect(page.getByRole("heading", { name: "Starter", level: 2 })).toBeVisible();
  await expect(page.getByText(/seeded prices are placeholders/)).toBeVisible();
  await page.goto("/admin/metrics");
  await expect(page.getByText("Monthly recurring revenue")).toBeVisible();
});

test("sign-up needs the terms, which are public", async ({ page }) => {
  await page.goto("/signup");
  await page.locator("#full_name").fill("Terms Tester");
  await page.locator("#email").fill(`terms-${Date.now()}@example.com`);
  await page.locator("#password").fill("hostel2026");
  await page.getByRole("button", { name: "Create account" }).click();
  await expect(page.getByText("Agree to the terms to create an account")).toBeVisible();
  await page
    .getByRole("navigation", { name: "Legal" })
    .getByRole("link", { name: "Terms" })
    .click();
  await expect(page.getByRole("heading", { name: "Terms of service", level: 1 })).toBeVisible();
  await expect(page.getByText(/has not yet been reviewed by a lawyer/)).toBeVisible();
});
