import { expect, test } from "@playwright/test";

import { todayIst } from "@/lib/validation";

import { residentRow } from "../support/residents";
import { createUserFactory, TEST_PASSWORD } from "../support/supabase";
import { completeAdminMfa, inMain, signIn } from "./helpers";

/** The platform admin console (EP-10): second factor, plans, suspension, support, audit. */
const factory = createUserFactory();
const { admin } = factory;

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

  // An admin confirms their sign-in with an authenticator before anything else.
  await signIn(page, platformAdmin.email, TEST_PASSWORD);
  await completeAdminMfa(page);
  await inMain(page).getByRole("link", { name: hostel.name }).first().click();
  await expect(page.getByRole("heading", { name: hostel.name })).toBeVisible();
  await expect(inMain(page).getByText(owner.email)).toBeVisible();

  // Shorten the trial so the owner is warned. A plan change needs a reason.
  const plan = inMain(page).getByRole("region", { name: "Plan" });
  await plan.getByLabel(/^Trial ends on/).fill(addDays(5));
  await plan.getByRole("button", { name: "Save plan" }).click();
  await expect(plan.getByText("Reason is required")).toBeVisible();
  await plan.getByLabel(/^Reason/).fill("Owner asked to start paying sooner");
  await plan.getByRole("button", { name: "Save plan" }).click();
  await expect(plan.getByText("Plan saved.")).toBeVisible();

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
  const suspend = inMain(page).getByRole("region", { name: "Suspend" });
  await suspend.getByRole("button", { name: "Suspend hostel" }).click();
  await expect(suspend.getByText("Reason is required")).toBeVisible();
  await suspend.getByLabel(/^Reason/).fill("Subscription unpaid for two months");
  await suspend.getByRole("button", { name: "Suspend hostel" }).click();
  await expect(inMain(page).getByText("Hostel suspended.")).toBeVisible();

  await ownerPage.goto("/rooms");
  await expect(ownerPage).toHaveURL(/\/suspended$/);
  await expect(ownerPage.getByText(`${hostel.name} is suspended`)).toBeVisible();
  await expect(
    ownerPage.getByText("Subscription unpaid for two months", { exact: false }),
  ).toBeVisible();

  // Moving to a paid plan and restoring gives the owner their hostel back.
  await plan.getByRole("combobox", { name: "Plan" }).selectOption("paid");
  await plan.getByLabel(/^Reason/).fill("Paid for a year by UPI");
  await plan.getByRole("button", { name: "Save plan" }).click();
  await expect(plan.getByText("Plan saved.")).toBeVisible();
  const restore = inMain(page).getByRole("region", { name: "Suspended" });
  await restore.getByLabel(/^Reason/).fill("Dues cleared");
  await restore.getByRole("button", { name: "Restore hostel" }).click();
  await expect(inMain(page).getByText("Hostel restored.")).toBeVisible();

  await ownerPage.goto("/dashboard");
  await expect(ownerPage).toHaveURL(/\/dashboard$/);
  await expect(ownerPage.getByText(/free trial/)).toHaveCount(0);
  await ownerContext.close();

  await page.goto("/admin");
  const row = inMain(page).getByRole("row", { name: new RegExp(hostel.name) });
  await expect(row.getByText("Paid")).toBeVisible();
  await expect(row.getByText("Active")).toBeVisible();

  // Every step is in the audit log, with its reason.
  await page.goto(`/admin/audit?hostel=${hostel.id}`);
  const log = inMain(page).getByRole("region", { name: "Admin actions" });
  for (const reason of [
    "Owner asked to start paying sooner",
    "Subscription unpaid for two months",
    "Paid for a year by UPI",
    "Dues cleared",
  ]) {
    await expect(log.getByText(reason)).toBeVisible();
  }
});

test("an admin opens the support view with a reason, which the owner sees", async ({
  page,
  browser,
}) => {
  test.slow();
  const platformAdmin = await factory.createUser({
    fullName: "Support Sita",
    profile: { role: "platform_admin" },
  });
  const owner = await factory.createUser({ fullName: "Kiran Owner" });
  const hostel = await factory.createHostel(owner.id, { name: `Helpdesk PG ${Date.now()}` });
  await admin
    .from("residents")
    .insert(residentRow(hostel.id, { full_name: "Private Priya", phone: "9876512345" }));

  await signIn(page, platformAdmin.email, TEST_PASSWORD);
  await completeAdminMfa(page);
  await page.goto(`/admin/hostels/${hostel.id}`);
  await inMain(page).getByRole("link", { name: "Open the read-only support view" }).click();
  await page.getByLabel(/^Why do you need to see this hostel/).fill("Owner cannot find a resident");
  await page.getByRole("button", { name: "Open support view" }).click();
  await expect(inMain(page).getByText("Private Priya")).toBeVisible();
  await expect(inMain(page).getByText("••••••2345")).toBeVisible();
  await expect(inMain(page).getByText("9876512345")).toHaveCount(0);

  // The owner directory finds the owner, with account help.
  await page.goto(`/admin/owners?q=${encodeURIComponent(owner.email)}`);
  await inMain(page).getByRole("link", { name: "Kiran Owner" }).click();
  await expect(inMain(page).getByText("Help with their account")).toBeVisible();
  await page.getByLabel(/^Action/).selectOption("sign_out_everywhere");
  await page.getByLabel(/^Reason/).fill("Lost their phone");
  await page.getByRole("button", { name: "Do it" }).click();
  await expect(inMain(page).getByText("Signed out of every device.")).toBeVisible();

  const ownerContext = await browser.newContext();
  const ownerPage = await ownerContext.newPage();
  await signIn(ownerPage, owner.email, TEST_PASSWORD);
  await ownerPage.goto("/settings/hostel");
  await expect(
    ownerPage.getByText(
      "Support Sita viewed your hostel (read-only): Owner cannot find a resident",
    ),
  ).toBeVisible();
  await ownerContext.close();
});

test("an announcement reaches owners until they dismiss it", async ({ page, browser }) => {
  const platformAdmin = await factory.createUser({ profile: { role: "platform_admin" } });
  const owner = await factory.createUser();
  await factory.createHostel(owner.id);
  const message = `Scheduled maintenance tonight ${Date.now()}`;

  await signIn(page, platformAdmin.email, TEST_PASSWORD);
  await completeAdminMfa(page);
  await page.goto("/admin/announcements");
  await page.getByLabel(/^Message/).fill(message);
  await page.getByRole("button", { name: "Publish announcement" }).click();
  await expect(inMain(page).getByText("Announcement published.", { exact: false })).toBeVisible();

  const ownerContext = await browser.newContext();
  const ownerPage = await ownerContext.newPage();
  await signIn(ownerPage, owner.email, TEST_PASSWORD);
  await ownerPage.goto("/dashboard");
  const banner = ownerPage.getByRole("region", { name: "Announcements" });
  await expect(banner.getByText(message)).toBeVisible();
  await banner.getByRole("button", { name: `Dismiss: ${message}` }).click();
  await expect(banner.getByText(message)).toHaveCount(0);
  // The dismissal is stored for the account, so it stays hidden after a reload.
  await expect
    .poll(async () => {
      const { count } = await admin
        .from("announcement_dismissals")
        .select("user_id", { count: "exact", head: true })
        .eq("user_id", owner.id);
      return count;
    })
    .toBe(1);
  await ownerPage.reload();
  await expect(ownerPage.getByText(message)).toHaveCount(0);
  await ownerContext.close();

  // End it so other tests' screens stay clear.
  await page.reload();
  await inMain(page)
    .getByRole("row", { name: new RegExp(message) })
    .getByRole("button", { name: "End now" })
    .click();
  await expect(
    inMain(page)
      .getByRole("row", { name: new RegExp(message) })
      .getByText("Ended"),
  ).toBeVisible();
});
