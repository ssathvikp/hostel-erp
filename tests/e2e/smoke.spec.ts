import { randomInt, randomUUID } from "node:crypto";

import { expect, test } from "@playwright/test";

import { formatMonth } from "@/lib/money";
import { todayIst } from "@/lib/validation";

import { confirmLink, waitForEmail } from "../support/mail";
import { randomMobile } from "../support/residents";
import { adminClient } from "../support/supabase";
import { inMain, signIn } from "./helpers";

/**
 * The end-to-end smoke journey (E9-T4): everything a new owner does in
 * their first session, through the UI only, starting from signup. It runs
 * in CI against the local stack, and against a deployed site with
 * `npm run test:staging` (playwright.staging.config.ts).
 *
 * On staging the account is created already confirmed and signed in
 * through the login form: a real SMTP provider would otherwise send the
 * confirmation to a made-up address and count the bounce against the
 * sender. The emailed link is covered locally and by the staging runbook.
 */
const ON_STAGING = process.env.SMOKE_TARGET === "staging";
const PASSWORD = "Smoke-passw0rd";
const email = `smoke-${randomUUID()}@example.com`;

test.afterAll(async () => {
  const admin = adminClient();
  const { data } = await admin.auth.admin.listUsers({ perPage: 1000 });
  const user = data?.users.find((candidate) => candidate.email === email);
  if (!user) return;
  const { data: hostels } = await admin.from("hostels").select("id").eq("owner_id", user.id);
  const ids = (hostels ?? []).map((hostel) => hostel.id);
  if (ids.length > 0) {
    for (const table of ["payments", "invoices", "allocations"] as const) {
      await admin.from(table).delete().in("hostel_id", ids);
    }
    await admin.from("hostels").delete().in("id", ids);
  }
  await admin.auth.admin.deleteUser(user.id);
});

test("signup → hostel → room → resident → bed → invoice → payment", async ({ page }) => {
  test.slow();
  const month = formatMonth(todayIst());

  // 1. Sign up and confirm by email.
  if (ON_STAGING) {
    const { error } = await adminClient().auth.admin.createUser({
      email,
      password: PASSWORD,
      email_confirm: true,
      user_metadata: { full_name: "Smoke Owner" },
    });
    if (error) throw error;
    await signIn(page, email, PASSWORD);
  } else {
    await page.goto("/signup");
    await page.getByLabel("Your name").fill("Smoke Owner");
    await page.getByLabel("Email").fill(email);
    await page.getByLabel("Password").fill(PASSWORD);
    await page.getByRole("button", { name: "Create account" }).click();
    await expect(inMain(page).getByRole("status")).toContainText("Check your email");
    const link = confirmLink((await waitForEmail(email, "Confirm your Hostel ERP account")).html);
    await page.goto(link.url.toString());
  }

  // 2. Create the hostel.
  await expect(page).toHaveURL(/\/onboarding$/);
  await page.getByLabel(/^Hostel name/).fill("Smoke Test Residency");
  await page.getByLabel(/^Hostel type/).selectOption("co_ed");
  await page.getByLabel(/^Contact phone/).fill("9876543210");
  await page.getByRole("button", { name: "Continue" }).click();
  await page.getByLabel(/^Street address/).fill("1 Test Street");
  await page.getByLabel(/^City/).fill("Pune");
  await page.getByLabel(/^State/).selectOption("Maharashtra");
  await page.getByLabel(/^PIN code/).fill("411001");
  await page.getByLabel(/^Number of floors/).fill("2");
  await page.getByRole("button", { name: "Finish setup" }).click();
  await expect(page).toHaveURL(/\/dashboard$/);

  // 3. Add a room.
  await page.goto("/rooms/new");
  await page.getByLabel(/^Room number/).fill("1A");
  await page.getByLabel(/^Floor/).fill("1");
  await page.getByLabel(/^Sharing type/).selectOption("single");
  await page.getByRole("button", { name: "Create room" }).click();
  await expect(page).not.toHaveURL(/\/rooms\/new$/);

  // 4. Set the rent for that room's sharing type.
  await page.goto("/settings/fees");
  await inMain(page)
    .getByLabel(/^Sharing type/)
    .selectOption("single");
  await inMain(page)
    .getByLabel(/^Monthly rent/)
    .fill("9000");
  await inMain(page).getByRole("button", { name: "Save rate" }).click();
  await expect(inMain(page).getByText("Rate saved.")).toBeVisible();

  // 5. Register a resident.
  await page.goto("/residents/new");
  await page.getByLabel(/^Full name/).fill("Smoke Resident");
  await page.getByLabel(/^Gender/).selectOption("female");
  await page.getByLabel(/^Date of birth/).fill("2002-02-02");
  await page.getByLabel(/^ID proof type/).selectOption("aadhaar");
  await page
    .getByLabel(/^ID proof number/)
    .fill(`${randomInt(2, 10)}${String(randomInt(0, 1e11)).padStart(11, "0")}`);
  await page.getByLabel(/^Mobile number/).fill(randomMobile());
  await page.getByLabel(/^Permanent address/).fill("2 Test Lane, Nashik");
  await page.getByLabel(/^The resident agrees/).check();
  await page.getByRole("button", { name: "Register resident" }).click();
  await expect(inMain(page).getByText("Resident registered.")).toBeVisible();

  // 6. Allocate the bed.
  await inMain(page).getByRole("button", { name: "Allocate bed" }).click();
  const allocate = page.getByRole("dialog", { name: "Allocate a bed to Smoke Resident" });
  await allocate.getByLabel(/^Bed/).selectOption({ index: 1 });
  await allocate.getByRole("button", { name: "Allocate", exact: true }).click();
  await expect(allocate).toBeHidden();
  await expect(inMain(page).getByText(/^Room 1A, bed 1A-A since/)).toBeVisible();

  // 7. Generate this month's invoice.
  await page.goto("/fees");
  await inMain(page)
    .getByLabel(/^Billing month/)
    .fill(todayIst().slice(0, 7));
  await inMain(page).getByRole("button", { name: "Generate invoices" }).click();
  await expect(inMain(page).getByText(new RegExp(`^Created 1 invoice for ${month}`))).toBeVisible();

  // 8. Record the payment in full.
  const row = inMain(page)
    .getByRole("table", { name: "Invoices" })
    .getByRole("row", {
      name: /Smoke Resident/,
    });
  await row.getByRole("button", { name: "Record payment for Smoke Resident" }).click();
  const pay = page.getByRole("dialog", { name: "Record a payment from Smoke Resident" });
  await pay.getByLabel(/^Mode/).selectOption("upi");
  await pay.getByRole("button", { name: "Record payment" }).click();
  await expect(pay).toBeHidden();
  await expect(row.getByText("Paid", { exact: true })).toBeVisible();

  // And the dashboard reflects it.
  await page.goto("/dashboard");
  await expect(inMain(page).locator("dl", { hasText: "Occupancy" })).toContainText("100%");
  await expect(inMain(page).locator("dl", { hasText: "Outstanding" })).toContainText("₹0");
});
