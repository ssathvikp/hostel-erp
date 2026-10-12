import { expect, test } from "@playwright/test";

import { createUserFactory, TEST_PASSWORD } from "../support/supabase";
import { inMain, openNavigation, signIn, signOut } from "./helpers";

/** Hostel onboarding, settings and switching in a real browser (EP-03). */
const factory = createUserFactory();

test.afterAll(async () => {
  await factory.cleanup();
});

test("a new owner sets up their hostel in two steps without losing input", async ({ page }) => {
  const owner = await factory.createUser({ fullName: "Ravi Teja" });

  await signIn(page, owner.email, TEST_PASSWORD);
  // No hostel yet: the dashboard sends the owner into onboarding.
  await expect(page).toHaveURL(/\/onboarding$/);
  await expect(page.getByRole("heading", { name: "Set up your hostel" })).toBeVisible();

  // Step 1, interrupted by a refresh before submitting.
  await page.getByLabel(/^Hostel name/).fill("Sai Krupa Residency");
  await page.getByLabel(/^Hostel type/).selectOption("boys");
  await page.reload();
  await expect(page.getByLabel(/^Hostel name/)).toHaveValue("Sai Krupa Residency");
  await expect(page.getByLabel(/^Hostel type/)).toHaveValue("boys");
  await page.getByLabel(/^Contact phone/).fill("98765 43210");
  await page.getByRole("button", { name: "Continue" }).click();

  // Step 2 validates on the server and keeps what was typed.
  await expect(page).toHaveURL(/\/onboarding\?step=2$/);
  await page.getByLabel(/^Street address/).fill("8-2-293 Road No. 12, Banjara Hills");
  await page.getByLabel(/^City/).fill("Hyderabad");
  await page.getByLabel(/^State/).selectOption("Telangana");
  await page.getByLabel(/^PIN code/).fill("012345");
  await page.getByLabel(/^Number of floors/).fill("5");
  await page.getByRole("button", { name: "Finish setup" }).click();
  await expect(inMain(page).getByText("Enter a valid 6-digit PIN code")).toBeVisible();
  await expect(page.getByLabel(/^City/)).toHaveValue("Hyderabad");

  // Back to step 1 shows the saved details, then forward again.
  await page.getByRole("link", { name: "Back" }).click();
  await expect(page.getByLabel(/^Contact phone/)).toHaveValue("9876543210");
  await page.getByRole("button", { name: "Continue" }).click();
  await expect(page.getByLabel(/^City/)).toHaveValue("Hyderabad");

  await page.getByLabel(/^PIN code/).fill("500034");
  await page.getByRole("button", { name: "Finish setup" }).click();

  await expect(page).toHaveURL(/\/dashboard$/);
  await expect(inMain(page).getByText("Sai Krupa Residency at a glance.")).toBeVisible();

  await page.goto("/settings/hostel");
  await expect(page.getByLabel(/^PIN code/)).toHaveValue("500034");
  await expect(page.getByLabel(/^State/)).toHaveValue("Telangana");
});

test("an owner who left onboarding half-way is taken back to it", async ({ page }) => {
  const owner = await factory.createUser();
  await factory.createHostel(owner.id, {
    name: "Unfinished Nest",
    status: "draft",
    address: null,
    city: null,
    state: null,
    pincode: null,
    floors: null,
  });

  await signIn(page, owner.email, TEST_PASSWORD);
  await expect(page).toHaveURL(/\/onboarding$/);
  await expect(inMain(page).getByText("Continuing setup for Unfinished Nest")).toBeVisible();
  await expect(page.getByLabel(/^Hostel name/)).toHaveValue("Unfinished Nest");
});

test("a duplicate hostel name is flagged before and after submitting", async ({ page }) => {
  const owner = await factory.createUser();
  await factory.createHostel(owner.id, { name: "Comfort Inn" });

  await signIn(page, owner.email, TEST_PASSWORD);
  await expect(page).toHaveURL(/\/dashboard$/);
  await page.goto("/onboarding");
  await expect(page.getByRole("heading", { name: "Add another hostel" })).toBeVisible();

  await page.getByLabel(/^Hostel name/).fill("comfort inn");
  await page.getByLabel(/^Hostel type/).focus();
  await expect(inMain(page).getByRole("status")).toContainText(
    'already have a hostel called "comfort inn"',
  );

  await page.getByLabel(/^Hostel type/).selectOption("girls");
  await page.getByLabel(/^Contact phone/).fill("9123456789");
  await page.getByRole("button", { name: "Continue" }).click();
  await expect(
    inMain(page).getByText(/You already have a hostel called "comfort inn"/),
  ).toBeVisible();
  await expect(page).toHaveURL(/\/onboarding$/);
});

test("an owner edits hostel details and they are saved", async ({ page }) => {
  const owner = await factory.createUser();
  await factory.createHostel(owner.id, { name: "Lake View PG" });

  await signIn(page, owner.email, TEST_PASSWORD);
  await page.goto("/settings/hostel");
  await page.getByLabel(/^Contact phone/).fill("9000012345");
  await page.getByLabel(/^GSTIN/).fill("29abcde1234f1z5");
  await page.getByRole("button", { name: "Save changes" }).click();
  await expect(inMain(page).getByRole("status")).toHaveText("Hostel details saved.");

  await page.reload();
  await expect(page.getByLabel(/^Contact phone/)).toHaveValue("9000012345");
  await expect(page.getByLabel(/^GSTIN/)).toHaveValue("29ABCDE1234F1Z5");
});

test("staff can view but not edit hostel settings", async ({ page }) => {
  const owner = await factory.createUser();
  const hostel = await factory.createHostel(owner.id, { name: "Staffed House" });
  const staff = await factory.createUser({ profile: { role: "staff", hostel_id: hostel.id } });

  await signIn(page, staff.email, TEST_PASSWORD);
  await expect(page).toHaveURL(/\/dashboard$/);
  await page.goto("/settings/hostel");
  await expect(
    inMain(page).getByText("Only the hostel owner can change these details."),
  ).toBeVisible();
  await expect(page.getByLabel(/^Hostel name/)).toBeDisabled();
  await expect(page.getByRole("button", { name: "Save changes" })).toHaveCount(0);
});

test("a multi-hostel owner switches hostels and a forged cookie is ignored", async ({
  page,
  context,
}) => {
  const owner = await factory.createUser();
  await factory.createHostel(owner.id, { name: "First Home" });
  await factory.createHostel(owner.id, { name: "Second Home" });
  const stranger = await factory.createUser();
  const foreign = await factory.createHostel(stranger.id, { name: "Not Yours" });

  await signIn(page, owner.email, TEST_PASSWORD);
  await expect(inMain(page).getByText("First Home at a glance.")).toBeVisible();

  await openNavigation(page);
  await page
    .getByLabel("Switch hostel")
    .filter({ visible: true })
    .selectOption({ label: "Second Home" });
  await expect(inMain(page).getByText("Second Home at a glance.")).toBeVisible();
  await page.reload();
  await expect(inMain(page).getByText("Second Home at a glance.")).toBeVisible();

  // Point the cookie at another tenant's hostel: it must fall back, not leak.
  const cookie = (await context.cookies()).find((c) => c.name === "active_hostel");
  expect(cookie).toBeDefined();
  await context.addCookies([{ ...cookie!, value: foreign.id }]);
  await page.reload();
  await expect(inMain(page).getByText("First Home at a glance.")).toBeVisible();
  await expect(page.getByText("Not Yours")).toHaveCount(0);
});

test("a suspended hostel is explained, never a redirect loop", async ({ page }) => {
  const owner = await factory.createUser({ fullName: "Mohan Lal" });
  const hostel = await factory.createHostel(owner.id, { name: "Paused PG" });
  const staff = await factory.createUser({ profile: { role: "staff", hostel_id: hostel.id } });
  // Suspension is an operator action, done with the service role.
  await factory.admin.from("hostels").update({ status: "suspended" }).eq("id", hostel.id);

  await signIn(page, staff.email, TEST_PASSWORD);
  await expect(page).toHaveURL(/\/onboarding$/);
  await expect(inMain(page).getByText("Paused PG is not active right now")).toBeVisible();
  await page.goto("/residents");
  await expect(page).toHaveURL(/\/onboarding$/);

  await signOut(page);
  await signIn(page, owner.email, TEST_PASSWORD);
  await expect(page).toHaveURL(/\/onboarding$/);
  await expect(inMain(page).getByText(/Paused PG is suspended/)).toBeVisible();
});
