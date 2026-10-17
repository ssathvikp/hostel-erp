import { expect, test } from "@playwright/test";

import { todayIst } from "@/lib/validation";

import { createUserFactory, TEST_PASSWORD } from "../support/supabase";
import { inMain, signIn } from "./helpers";

/** The platform admin console, plans, trials and suspension (EP-10). */
const factory = createUserFactory();

test.afterAll(factory.cleanup);

function addDays(days: number): string {
  const value = new Date(`${todayIst()}T00:00:00Z`);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}

test("an admin extends a trial, suspends a hostel and restores it", async ({ page, browser }) => {
  test.slow();
  const platformAdmin = await factory.createUser({
    fullName: "Ops Person",
    profile: { role: "platform_admin" },
  });
  const owner = await factory.createUser({ fullName: "Harish Rao" });
  const hostel = await factory.createHostel(owner.id, { name: `Orbit PG ${Date.now()}` });

  // An admin lands on the console, not in a hostel.
  await signIn(page, platformAdmin.email, TEST_PASSWORD);
  await expect(page).toHaveURL(/\/admin$/);
  await inMain(page).getByRole("link", { name: hostel.name }).click();
  await expect(page.getByRole("heading", { name: hostel.name })).toBeVisible();
  await expect(inMain(page).getByText(owner.email)).toBeVisible();

  // Shorten the trial so the owner is warned.
  await page.getByLabel(/^Trial ends on/).fill(addDays(5));
  await page.getByRole("button", { name: "Save plan" }).click();
  await expect(inMain(page).getByText("Plan saved.")).toBeVisible();

  const ownerContext = await browser.newContext();
  const ownerPage = await ownerContext.newPage();
  await signIn(ownerPage, owner.email, TEST_PASSWORD);
  await ownerPage.goto("/dashboard");
  await expect(ownerPage.getByText("Your free trial ends in 5 days")).toBeVisible();
  await ownerPage.emulateMedia({ media: "print" });
  await expect(ownerPage.getByText("Your free trial ends in 5 days")).toBeHidden();
  await ownerPage.emulateMedia({ media: "screen" });
  // Owners cannot open the console.
  const response = await ownerPage.goto("/admin");
  expect(response?.status()).toBe(404);

  // Suspending needs a reason, which the owner then sees.
  await page.getByRole("button", { name: "Suspend hostel" }).click();
  await expect(
    inMain(page).getByText("Say why the hostel is suspended. The owner will see it."),
  ).toBeVisible();
  await page.getByLabel(/^Reason/).fill("Subscription unpaid for two months");
  await page.getByRole("button", { name: "Suspend hostel" }).click();
  await expect(inMain(page).getByText("Hostel suspended.")).toBeVisible();

  await ownerPage.goto("/rooms");
  await expect(ownerPage).toHaveURL(/\/suspended$/);
  await expect(ownerPage.getByText(`${hostel.name} is suspended`)).toBeVisible();
  await expect(
    ownerPage.getByText("Subscription unpaid for two months", { exact: false }),
  ).toBeVisible();

  // Moving to a paid plan and restoring gives the owner their hostel back.
  await page.getByRole("combobox", { name: "Plan" }).selectOption("paid");
  await page.getByRole("button", { name: "Save plan" }).click();
  await expect(inMain(page).getByText("Plan saved.")).toBeVisible();
  await page.getByRole("button", { name: "Restore hostel" }).click();
  await expect(inMain(page).getByText("Hostel restored.")).toBeVisible();

  await ownerPage.goto("/dashboard");
  await expect(ownerPage).toHaveURL(/\/dashboard$/);
  await expect(ownerPage.getByText(/free trial/)).toHaveCount(0);
  await ownerContext.close();

  await page.goto("/admin");
  const row = inMain(page).getByRole("row", { name: new RegExp(hostel.name) });
  await expect(row.getByText("Paid")).toBeVisible();
  await expect(row.getByText("Active")).toBeVisible();
});
