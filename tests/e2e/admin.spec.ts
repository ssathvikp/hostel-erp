import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

import { createUserFactory, TEST_PASSWORD } from "../support/supabase";
import { totp } from "../support/totp";
import { inMain, signIn } from "./helpers";

/** The platform admin area in a real browser (EP-10). */
const factory = createUserFactory();

test.afterAll(async () => {
  await factory.cleanup();
});

/** Waits for a fresh 30-second window so the code cannot expire mid-submit. */
async function freshCode(secret: string): Promise<string> {
  const left = 30 - (Math.floor(Date.now() / 1000) % 30);
  if (left < 5) await new Promise((resolve) => setTimeout(resolve, (left + 1) * 1000));
  return totp(secret);
}

async function expectAccessible(page: Page) {
  const { violations } = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
    .analyze();
  expect
    .soft(
      violations.map((v) => v.id),
      `accessibility on ${page.url()}`,
    )
    .toEqual([]);
}

test("an admin needs MFA, supports a hostel read-only, suspends it, and the owner sees the visit", async ({
  page,
  browser,
}) => {
  test.setTimeout(120_000);
  const owner = await factory.createUser({ fullName: "Ravi Owner" });
  const name = `Watched PG ${Math.random().toString(36).slice(2, 7)}`;
  const hostel = await factory.createHostel(owner.id, { name });
  const admin = await factory.createUser({ profile: { role: "platform_admin" } });

  await signIn(page, admin.email, TEST_PASSWORD);
  // A password alone opens nothing: every admin page leads to MFA set-up.
  await page.goto("/admin/hostels");
  await expect(page).toHaveURL(/\/admin\/mfa$/);
  await expect(inMain(page).getByText("Or enter this key by hand")).toBeVisible();
  await expectAccessible(page);
  const secret = (await inMain(page).locator("span.font-mono").innerText()).trim();
  await inMain(page)
    .getByLabel(/^Code/)
    .fill(await freshCode(secret));
  await inMain(page).getByRole("button", { name: "Verify" }).click();
  await expect(page).toHaveURL(/\/admin$/);
  await expect(inMain(page).getByRole("heading", { name: "Platform overview" })).toBeVisible();
  await expectAccessible(page);

  // Directory, then the support view, which asks why first.
  await page.goto(`/admin/hostels?q=${encodeURIComponent(name)}`);
  await inMain(page).getByRole("link", { name }).click();
  await inMain(page).getByRole("button", { name: "Open read-only view" }).click();
  await expect(inMain(page).getByText("Reason is required")).toBeVisible();
  await inMain(page)
    .getByLabel(/^Why are you opening/)
    .fill("Ticket 42: invoices look wrong");
  await inMain(page).getByRole("button", { name: "Open read-only view" }).click();
  await expect(inMain(page).getByText("Read-only support view")).toBeVisible();
  await expectAccessible(page);

  await inMain(page).getByRole("button", { name: "Suspend hostel" }).click();
  const dialog = page.getByRole("dialog", { name: "Suspend this hostel" });
  await dialog.getByLabel(/^Reason/).fill("Owner asked to pause the account");
  await dialog.getByRole("button", { name: "Suspend" }).click();
  await expect(
    inMain(page).getByText("Hostel suspended. The owner's email is queued."),
  ).toBeVisible();

  await page.goto(`/admin/audit?hostel=${hostel.id}`);
  await expect(inMain(page).getByRole("cell", { name: "Suspended hostel" })).toBeVisible();
  await expect(
    inMain(page).getByRole("cell", { name: "Ticket 42: invoices look wrong" }).first(),
  ).toBeVisible();

  // The owner: admin pages do not exist for them, and the visit is shown.
  const ownerContext = await browser.newContext();
  const ownerPage = await ownerContext.newPage();
  await signIn(ownerPage, owner.email, TEST_PASSWORD);
  const response = await ownerPage.goto("/admin");
  expect(response?.status()).toBe(404);
  await ownerPage.goto("/onboarding");
  await expect(inMain(ownerPage).getByText(new RegExp(`${name} is suspended`))).toBeVisible();
  await ownerContext.close();

  // Restore, then the owner sees the support visit in settings.
  await page.goto(`/admin/hostels/${hostel.id}`);
  await inMain(page).getByRole("button", { name: "Restore hostel" }).click();
  const restore = page.getByRole("dialog", { name: "Restore this hostel" });
  await restore.getByLabel(/^Reason/).fill("Owner is back");
  await restore.getByRole("button", { name: "Restore" }).click();
  await expect(
    inMain(page).getByText("Hostel restored. The owner's email is queued."),
  ).toBeVisible();

  const back = await browser.newContext();
  const backPage = await back.newPage();
  await signIn(backPage, owner.email, TEST_PASSWORD);
  await backPage.goto("/settings/hostel");
  await expect(
    inMain(backPage)
      .getByText(/Hostel ERP support viewed your hostel on .*Ticket 42/)
      .first(),
  ).toBeVisible();
  await back.close();
});

test("an owner exports their data and erases a former resident", async ({ page }) => {
  const owner = await factory.createUser();
  const hostel = await factory.createHostel(owner.id, { name: "Export PG" });
  const { data: resident } = await factory.admin
    .from("residents")
    .insert({
      hostel_id: hostel.id,
      full_name: "Leaving Person",
      phone: "9845022233",
      gender: "female",
      dob: "2001-02-03",
      id_proof_type: "pan",
      id_proof_last4: "123F",
      id_proof_hash: "a".repeat(64),
      permanent_address: "1 Lake Road, Pune",
      joining_date: "2026-01-01",
      status: "vacated",
    })
    .select("id")
    .single();
  await signIn(page, owner.email, TEST_PASSWORD);

  await page.goto("/settings/hostel");
  const download = page.waitForEvent("download");
  await inMain(page).getByRole("link", { name: "Download all data" }).click();
  const file = await download;
  expect(file.suggestedFilename()).toMatch(/^export-pg-data-\d{4}-\d{2}-\d{2}\.json$/);

  await page.goto(`/residents/${resident!.id}`);
  await inMain(page).getByRole("button", { name: "Erase personal data" }).click();
  const dialog = page.getByRole("dialog", { name: "Erase Leaving Person's personal data" });
  await dialog.getByLabel(/^Why/).fill("She asked to be forgotten");
  await dialog.getByLabel(/^Type ERASE/).fill("erase");
  await dialog.getByRole("button", { name: "Erase for good" }).click();
  await expect(dialog.getByText("Type the word ERASE in capitals")).toBeVisible();
  await dialog.getByLabel(/^Type ERASE/).fill("ERASE");
  await dialog.getByRole("button", { name: "Erase for good" }).click();

  await expect(
    inMain(page).getByText("The resident's personal data has been erased."),
  ).toBeVisible();
  await expect(inMain(page).getByRole("heading", { name: "Erased resident" })).toBeVisible();
  await expect(inMain(page).getByText("9845022233")).toHaveCount(0);
  await expect(inMain(page).getByRole("link", { name: "Edit details" })).toHaveCount(0);
});
