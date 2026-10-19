import { expect, test } from "@playwright/test";

import { createUserFactory, TEST_PASSWORD } from "../support/supabase";
import { inMain, signIn } from "./helpers";

/** Set-up checklist, money lost, referrals and the admin metrics page. */
const factory = createUserFactory();
const { admin } = factory;

test.afterAll(async () => {
  await admin.from("platform_settings").update({ trial_days: 30 }).eq("id", true);
  await factory.cleanup();
});

test("a new owner sees what is left to set up and what empty beds cost", async ({ page }) => {
  const owner = await factory.createUser({ fullName: "Checklist Owner" });
  const hostel = await factory.createHostel(owner.id, { name: `Checklist PG ${Date.now()}` });
  await admin.from("rooms").insert({
    hostel_id: hostel.id,
    room_number: "1",
    floor: 1,
    sharing_type: "double",
    capacity: 2,
  });
  await admin.from("fee_structures").insert({
    hostel_id: hostel.id,
    sharing_type: "double",
    monthly_amount: 500000,
    effective_from: "2020-01-01",
  });

  await signIn(page, owner.email, TEST_PASSWORD);
  await page.goto("/dashboard");
  const setup = inMain(page).getByRole("region", { name: `Get ${hostel.name} running` });
  await expect(setup.getByText(/days left in your free trial/)).toBeVisible();
  await expect(setup.getByRole("link", { name: "Add residents and give them beds" })).toBeVisible();
  // Done steps are not links.
  await expect(setup.getByRole("link", { name: "Add rooms and beds" })).toHaveCount(0);

  const lost = inMain(page).getByRole("region", { name: "Money you are missing" });
  await expect(lost.getByText("₹10,000")).toBeVisible();
  await expect(lost.getByText(/2 vacant beds/)).toBeVisible();
});

test("an owner shares a referral link and a new owner signs up with it", async ({
  page,
  browser,
}) => {
  const owner = await factory.createUser({ fullName: "Referring Owner" });
  await factory.createHostel(owner.id);
  await signIn(page, owner.email, TEST_PASSWORD);
  await page.goto("/settings/referrals");
  const link = await inMain(page)
    .getByText(/\/signup\?ref=[A-Z2-9]{8}$/)
    .textContent();
  expect(link).toBeTruthy();

  const visitor = await browser.newContext();
  const signup = await visitor.newPage();
  await signup.goto(new URL(link!).pathname + new URL(link!).search);
  await expect(signup.getByText("You were invited by another hostel owner.")).toBeVisible();
  await visitor.close();
});

test("a platform admin reads the metrics and changes the trial length", async ({ page }) => {
  const platformAdmin = await factory.createUser({ profile: { role: "platform_admin" } });
  await signIn(page, platformAdmin.email, TEST_PASSWORD);
  await page
    .getByRole("navigation", { name: "Admin" })
    .getByRole("link", { name: "Metrics" })
    .click();
  await expect(page.getByRole("heading", { name: "Metrics" })).toBeVisible();
  await expect(inMain(page).getByText("Owners signed up")).toBeVisible();
  await expect(inMain(page).getByRole("table", { name: /sign-ups per week/i })).toBeVisible();

  await page.getByLabel(/^Free trial for new hostels/).fill("21");
  await page.getByRole("button", { name: "Save trial length" }).click();
  await expect(inMain(page).getByText("New hostels now start on a 21-day trial.")).toBeVisible();
});
