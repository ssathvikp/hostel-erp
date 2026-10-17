import { expect, test } from "@playwright/test";

import { residentRow } from "../support/residents";
import { createUserFactory, TEST_PASSWORD } from "../support/supabase";
import { inMain, signIn } from "./helpers";

/** Security deposits on the resident profile (EP-12). */
const factory = createUserFactory();
const { admin } = factory;

test.afterAll(factory.cleanup);

async function hostelWithResident(name: string) {
  const owner = await factory.createUser({ fullName: "Deepa Nair" });
  const hostel = await factory.createHostel(owner.id);
  const { data, error } = await admin
    .from("residents")
    .insert(residentRow(hostel.id, { full_name: name }))
    .select("id")
    .single();
  if (error) throw error;
  return { owner, hostel, residentId: data.id };
}

test("an owner collects a deposit, keeps part of it and refunds the rest", async ({ page }) => {
  const { owner, residentId } = await hostelWithResident("Arjun Menon");
  await signIn(page, owner.email, TEST_PASSWORD);
  await page.goto(`/residents/${residentId}`);
  const deposit = inMain(page).getByRole("region", { name: "Security deposit" });
  await expect(deposit.getByText("No security deposit recorded.")).toBeVisible();

  // Collect ₹10,000 by UPI.
  await page.getByRole("button", { name: "Record deposit for Arjun Menon" }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByLabel(/^What happened/)).toHaveValue("collected");
  await dialog.getByLabel(/^Amount/).fill("10000");
  await dialog.getByRole("button", { name: "Record" }).click();
  await expect(dialog.getByText("Choose a payment mode")).toBeVisible();
  await dialog.getByLabel(/^Mode/).selectOption("upi");
  await dialog.getByRole("button", { name: "Record" }).click();
  await expect(dialog).toBeHidden();
  await expect(deposit.getByText("Held now")).toBeVisible();
  await expect(deposit.locator("dd").first()).toHaveText("₹10,000");

  // Keep ₹1,500 for damage; a reason is required.
  await page.getByRole("button", { name: "Record deposit for Arjun Menon" }).click();
  await dialog.getByLabel(/^What happened/).selectOption("deduction");
  await expect(dialog.getByLabel(/^Mode/)).toHaveCount(0);
  await dialog.getByLabel(/^Amount/).fill("1500");
  await dialog.getByRole("button", { name: "Record" }).click();
  await expect(dialog.getByText("Say why the amount is being kept")).toBeVisible();
  await dialog.getByLabel(/^Reason/).fill("Broken cupboard door");
  await dialog.getByRole("button", { name: "Record" }).click();
  await expect(dialog).toBeHidden();
  await expect(deposit.locator("dd").first()).toHaveText("₹8,500");

  // A refund above what is held is refused; the default is everything held.
  await page.getByRole("button", { name: "Record deposit for Arjun Menon" }).click();
  await expect(dialog.getByLabel(/^What happened/)).toHaveValue("refund");
  await expect(dialog.getByLabel(/^Amount/)).toHaveValue("8500");
  await dialog.getByLabel(/^Amount/).fill("9000");
  await dialog.getByLabel(/^Mode/).selectOption("cash");
  await dialog.getByRole("button", { name: "Record" }).click();
  await expect(dialog.getByText("Only ₹8500.00 of the deposit is held.")).toBeVisible();
  await dialog.getByLabel(/^Amount/).fill("8500");
  await dialog.getByRole("button", { name: "Record" }).click();
  await expect(dialog).toBeHidden();
  await expect(deposit.locator("dd").first()).toHaveText("₹0");
  await expect(deposit.getByRole("row")).toHaveCount(4);

  // Voiding the refund puts the money back in the held amount.
  await deposit.getByRole("button", { name: "Void refunded entry of ₹8,500" }).click();
  await dialog.getByLabel(/^Reason/).fill("Refund not handed over yet");
  await dialog.getByRole("button", { name: "Void entry" }).click();
  await expect(deposit.locator("dd").first()).toHaveText("₹8,500");
  await expect(deposit.getByText("Refunded (void)")).toBeVisible();
});

test("staff record deposits but cannot void them", async ({ page }) => {
  const { hostel, residentId } = await hostelWithResident("Farah Khan");
  const staff = await factory.createUser({
    fullName: "Suresh Kumar",
    profile: { role: "staff", hostel_id: hostel.id },
  });
  await signIn(page, staff.email, TEST_PASSWORD);
  await page.goto(`/residents/${residentId}`);

  await page.getByRole("button", { name: "Record deposit for Farah Khan" }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel(/^Amount/).fill("5000");
  await dialog.getByLabel(/^Mode/).selectOption("cash");
  await dialog.getByRole("button", { name: "Record" }).click();
  await expect(dialog).toBeHidden();

  const deposit = inMain(page).getByRole("region", { name: "Security deposit" });
  await expect(deposit.getByRole("cell", { name: "Suresh Kumar" })).toBeVisible();
  await expect(deposit.getByRole("button", { name: /^Void/ })).toHaveCount(0);
});
