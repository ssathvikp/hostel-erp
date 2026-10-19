import { expect, test } from "@playwright/test";

import { todayIst } from "@/lib/validation";

import { residentRow } from "../support/residents";
import { createUserFactory, TEST_PASSWORD } from "../support/supabase";
import { inMain, signIn } from "./helpers";

/** Late fees in a real browser (ClickUp E13-T6): set the rule, charge, waive. */
const factory = createUserFactory();
const { admin } = factory;

test.afterAll(factory.cleanup);

function addDays(date: string, days: number): string {
  const value = new Date(`${date}T00:00:00Z`);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}

test("an owner sets a late fee rule, charges a late fee and waives it", async ({ page }) => {
  test.slow();
  const owner = await factory.createUser();
  const hostel = await factory.createHostel(owner.id);
  const { data: resident } = await admin
    .from("residents")
    .insert(residentRow(hostel.id, { full_name: "Late Larry" }))
    .select("id")
    .single();
  const due = addDays(todayIst(), -10);
  const { data: rent } = await admin
    .from("invoices")
    .insert({
      hostel_id: hostel.id,
      resident_id: resident!.id,
      period_month: `${due.slice(0, 7)}-01`,
      amount: 600000,
      due_date: due,
      breakdown: [],
    })
    .select("id")
    .single();

  await signIn(page, owner.email, TEST_PASSWORD);
  await page.goto("/settings/fees");
  const section = inMain(page).getByRole("region", { name: "Late fees" });
  await expect(section.getByText("Late fees are off.")).toBeVisible();
  await section.getByLabel("Late fees").selectOption("fixed");
  await section.getByLabel(/^Late fee \(₹\)/).fill("250");
  await section.getByLabel(/^Grace days/).fill("3");
  await section.getByRole("button", { name: "Save late fee rule" }).click();
  await expect(section.getByText("Late fee rule saved.")).toBeVisible();

  // Switching the rule on today only covers rent due from today, so the
  // fixture rule start is moved back as a support script would.
  await admin.from("hostels").update({ late_fee_since: "2020-01-01" }).eq("id", hostel.id);

  await page.goto("/fees");
  const lateFees = inMain(page).getByRole("region", { name: "Late fees" });
  await expect(
    lateFees.getByText("A late fee of ₹250 applies from 3 days after rent is due."),
  ).toBeVisible();
  await lateFees.getByRole("button", { name: "Add late fees now" }).click();
  await expect(lateFees.getByText("Added 1 late fee worth ₹250.")).toBeVisible();
  await lateFees.getByRole("button", { name: "Add late fees now" }).click();
  await expect(lateFees.getByText("No new late fees.")).toBeVisible();

  // The rent invoice links to its late fee and cannot be voided first.
  await page.goto(`/fees/${rent!.id}`);
  await expect(inMain(page).getByText(/A late fee of ₹250 was charged/)).toBeVisible();
  await expect(inMain(page).getByRole("button", { name: /^Void invoice/ })).toHaveCount(0);
  await inMain(page).getByRole("link", { name: "View the late fee" }).click();

  await expect(
    page.getByRole("heading", { level: 1, name: /^Late Larry, .+ late fee$/ }),
  ).toBeVisible();
  await expect(inMain(page).getByText(/7 days late after the 3-day grace period/)).toBeVisible();
  await inMain(page)
    .getByRole("button", { name: /^Waive late fee/ })
    .click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel(/^Reason/).fill("First time, let off");
  await dialog.getByRole("button", { name: "Waive late fee" }).click();
  await expect(inMain(page).getByText("Waived: First time, let off")).toBeVisible();
});
