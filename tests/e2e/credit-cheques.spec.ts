import { expect, test } from "@playwright/test";

import { todayIst } from "@/lib/validation";

import { residentRow } from "../support/residents";
import { createUserFactory, TEST_PASSWORD } from "../support/supabase";
import { inMain, signIn } from "./helpers";

/** Advance credit and cheques in a real browser (ClickUp E13-T7, E13-T11). */
const factory = createUserFactory();
const { admin } = factory;

test.afterAll(factory.cleanup);

const monthStart = `${todayIst().slice(0, 7)}-01`;

async function setup() {
  const owner = await factory.createUser();
  const hostel = await factory.createHostel(owner.id);
  const { data: resident } = await admin
    .from("residents")
    .insert(residentRow(hostel.id, { full_name: "Cheque Chetan" }))
    .select("id")
    .single();
  const { data: invoice } = await admin
    .from("invoices")
    .insert({
      hostel_id: hostel.id,
      resident_id: resident!.id,
      period_month: monthStart,
      amount: 500000,
      due_date: monthStart,
    })
    .select("id")
    .single();
  return { owner, residentId: resident!.id, invoiceId: invoice!.id };
}

test("a cheque stays pending until cleared, then counts as paid", async ({ page }) => {
  const { owner, invoiceId } = await setup();
  await signIn(page, owner.email, TEST_PASSWORD);
  await page.goto(`/fees/${invoiceId}`);
  await inMain(page)
    .getByRole("button", { name: /^Record payment/ })
    .click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel(/^Mode/).selectOption("cheque");
  await dialog.getByLabel(/^Cheque number/).fill("004455");
  await dialog.getByLabel(/^Bank/).fill("Canara Bank");
  await dialog.getByRole("button", { name: "Record payment" }).click();
  await expect(inMain(page).getByText("Awaiting clearance")).toBeVisible();
  // Nothing is left to collect, but nothing is paid yet either.
  await expect(inMain(page).getByRole("button", { name: /^Record payment/ })).toHaveCount(0);

  await page.goto("/fees/cheques");
  await expect(inMain(page).getByText("No. 004455")).toBeVisible();
  await inMain(page).getByRole("button", { name: "Mark cheque 004455 cleared" }).click();
  await expect(inMain(page).getByText("No cheques waiting")).toBeVisible();

  await page.goto(`/fees/${invoiceId}`);
  await expect(inMain(page).getByText("Awaiting clearance")).toHaveCount(0);
  await expect(page.getByText("Paid", { exact: true }).first()).toBeVisible();
});

test("paying more than is due keeps the extra as advance credit", async ({ page }) => {
  const { owner, residentId, invoiceId } = await setup();
  await signIn(page, owner.email, TEST_PASSWORD);
  await page.goto(`/fees/${invoiceId}`);
  await inMain(page)
    .getByRole("button", { name: /^Record payment/ })
    .click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel(/^Amount/).fill("7000");
  await dialog.getByLabel(/^Mode/).selectOption("upi");
  await dialog.getByRole("button", { name: "Record payment" }).click();
  await expect(dialog).toBeHidden();

  await page.goto(`/residents/${residentId}`);
  const credit = inMain(page).getByRole("region", { name: "Advance credit" });
  await expect(credit.getByText("₹2,000", { exact: true }).first()).toBeVisible();
  await expect(credit.getByText("held as advance credit", { exact: false })).toBeVisible();
});
