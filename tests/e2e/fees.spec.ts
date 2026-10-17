import { expect, test, type Page } from "@playwright/test";

import { formatMonth, shiftMonth } from "@/lib/money";
import { todayIst } from "@/lib/validation";

import { residentRow } from "../support/residents";
import { createUserFactory, TEST_PASSWORD } from "../support/supabase";
import { inMain, signIn } from "./helpers";

/** Rates, invoices, payments, voids and printing in a real browser (EP-07). */
const factory = createUserFactory();
const { admin } = factory;

test.afterAll(factory.cleanup);

// Last month: always billable, and its invoices are already past due.
const lastMonth = shiftMonth(todayIst(), -1);
const lastMonthLabel = formatMonth(lastMonth);

/** Fills the generator's month with last month and submits it. */
async function billMonth(page: Page) {
  const month = inMain(page).getByLabel(/^Billing month/);
  await month.fill(lastMonth.slice(0, 7));
  await expect(month).toHaveValue(lastMonth.slice(0, 7));
  await inMain(page).getByRole("button", { name: "Generate invoices" }).click();
}

async function setup(name: string) {
  const owner = await factory.createUser();
  const hostel = await factory.createHostel(owner.id, { name });
  const beds: Record<string, string> = {};
  for (const [room_number, sharing_type, capacity] of [
    ["101", "double", 2],
    ["201", "single", 1],
  ] as const) {
    const { data: room, error } = await admin
      .from("rooms")
      .insert({ hostel_id: hostel.id, room_number, floor: 1, sharing_type, capacity })
      .select("id")
      .single();
    if (error) throw error;
    const { data } = await admin.from("beds").select("id").eq("room_id", room.id).limit(1);
    beds[room_number] = data![0].id;
  }
  return { owner, hostel, beds };
}

/** A resident who has held `bedId` since two months ago. */
async function residentInBed(hostelId: string, ownerId: string, fullName: string, bedId: string) {
  const { data: resident, error } = await admin
    .from("residents")
    .insert(residentRow(hostelId, { full_name: fullName }))
    .select("id")
    .single();
  if (error) throw error;
  const { data: bed } = await admin.from("beds").select("room_id").eq("id", bedId).single();
  const { error: stayError } = await admin.from("allocations").insert({
    hostel_id: hostelId,
    resident_id: resident.id,
    bed_id: bedId,
    room_id: bed!.room_id,
    start_date: shiftMonth(todayIst(), -2),
    created_by: ownerId,
  });
  if (stayError) throw stayError;
  return resident.id;
}

test("an owner sets a rate, bills a month, collects it in parts and prints proof", async ({
  page,
}) => {
  const { owner, hostel, beds } = await setup("Ledger PG");
  const priyaId = await residentInBed(hostel.id, owner.id, "Priya Menon", beds["101"]);
  await residentInBed(hostel.id, owner.id, "Ravi Das", beds["201"]);
  await signIn(page, owner.email, TEST_PASSWORD);

  // Rates: rooms without one are flagged before anything is billed.
  await page.goto("/settings/fees");
  await expect(inMain(page).getByText("Some rooms have no rate")).toBeVisible();
  await inMain(page)
    .getByLabel(/^Sharing type/)
    .selectOption("double");
  await inMain(page)
    .getByLabel(/^Monthly rent/)
    .fill("8000");
  await inMain(page)
    .getByLabel(/^Applies from/)
    .fill(lastMonth);
  await inMain(page).getByRole("button", { name: "Save rate" }).click();
  await expect(inMain(page).getByText("Rate saved.")).toBeVisible();
  const current = inMain(page).getByRole("table", { name: "Current rates" });
  await expect(current.getByRole("row", { name: /Double.*₹8,000/ })).toBeVisible();
  await expect(inMain(page).getByText(/^Single \(1 room\) has no rate/)).toBeVisible();

  // Generate: the unpriced resident is named, not silently skipped.
  await page.goto("/fees");
  await billMonth(page);
  await expect(
    inMain(page).getByText(`Created 1 invoice for ${lastMonthLabel} worth ₹8,000.`),
  ).toBeVisible();
  await expect(
    inMain(page).getByText(/Not billed because no rate applies.*Ravi Das/),
  ).toBeVisible();

  // Running it again bills nobody twice.
  await billMonth(page);
  await expect(
    inMain(page).getByText(/No new invoices.*1 resident already had an invoice/),
  ).toBeVisible();

  const invoices = inMain(page).getByRole("table", { name: "Invoices" });
  const row = invoices.getByRole("row", { name: /Priya Menon/ });
  await expect(row.getByText("Overdue")).toBeVisible();

  // A part payment, then an attempt to overpay, then the rest.
  await row.getByRole("button", { name: "Record payment for Priya Menon" }).click();
  let dialog = page.getByRole("dialog", { name: "Record a payment from Priya Menon" });
  await expect(dialog.getByLabel(/^Amount/)).toHaveValue("8000");
  await dialog.getByLabel(/^Amount/).fill("3000");
  await dialog.getByLabel(/^Mode/).selectOption("upi");
  await dialog.getByLabel(/^Reference/).fill("UTR998877");
  await dialog.getByRole("button", { name: "Record payment" }).click();
  await expect(dialog).toBeHidden();
  await expect(row.getByRole("cell", { name: "₹5,000" })).toBeVisible();

  await row.getByRole("button", { name: "Record payment for Priya Menon" }).click();
  dialog = page.getByRole("dialog", { name: "Record a payment from Priya Menon" });
  await dialog.getByLabel(/^Amount/).fill("6000");
  await dialog.getByLabel(/^Mode/).selectOption("cash");
  await dialog.getByRole("button", { name: "Record payment" }).click();
  await expect(dialog.getByText("Only ₹5,000 is still due on this invoice.")).toBeVisible();
  await dialog.getByLabel(/^Amount/).fill("5000");
  await dialog.getByRole("button", { name: "Record payment" }).click();
  await expect(dialog).toBeHidden();
  await expect(row.getByText("Paid", { exact: true })).toBeVisible();

  // The status filter lives in the URL.
  await inMain(page).getByRole("combobox", { name: "Status" }).selectOption("overdue");
  await expect(page).toHaveURL(/status=overdue/);
  await expect(inMain(page).getByText("No invoices match")).toBeVisible();

  // Invoice, receipt and print view.
  await page.goto("/fees");
  await row.getByRole("link", { name: /View invoice for Priya Menon/ }).click();
  await expect(
    inMain(page).getByRole("heading", { name: `Priya Menon, ${lastMonthLabel}` }),
  ).toBeVisible();
  const payments = inMain(page).getByRole("table", { name: "Payments" });
  await expect(payments.getByRole("row")).toHaveCount(3);
  await payments.getByRole("link", { name: /Receipt for ₹3,000/ }).click();
  await expect(inMain(page).getByText("Payment receipt")).toBeVisible();
  await expect(inMain(page).getByText(/reference UTR998877/)).toBeVisible();
  // The first of two part payments: totals as of that payment, not today.
  const totals = inMain(page).locator("dl", { hasText: "Total paid to date" });
  await expect(totals).toContainText("₹3,000");
  await expect(totals).toContainText("₹5,000");

  await page.emulateMedia({ media: "print" });
  await expect(page.getByRole("navigation", { name: "Primary" })).toBeHidden();
  await expect(inMain(page).getByRole("button", { name: "Print receipt" })).toBeHidden();
  await expect(inMain(page).getByText("Payment receipt")).toBeVisible();
  await page.emulateMedia({ media: "screen" });

  // The resident profile shows the history and a settled balance.
  await page.goto(`/residents/${priyaId}`);
  const fees = inMain(page).getByRole("region", { name: "Fees" });
  await expect(
    fees
      .getByRole("table", { name: "Fee history" })
      .getByRole("cell", { name: "Paid", exact: true }),
  ).toBeVisible();
  await expect(inMain(page).getByText("Nothing is due.")).toBeVisible();
  await inMain(page).getByRole("button", { name: "Transfer Priya Menon to another bed" }).click();
  await expect(
    page
      .getByRole("dialog", { name: "Move Priya Menon to another bed" })
      .getByText("No fees are outstanding."),
  ).toBeVisible();
});

test("an owner voids a mistaken payment and invoice, then bills the month again", async ({
  page,
}) => {
  const { owner, hostel, beds } = await setup("Void PG");
  const residentId = await residentInBed(hostel.id, owner.id, "Meera Iyer", beds["101"]);
  await owner.client.rpc("set_fee_structure", {
    p_hostel_id: hostel.id,
    p_sharing_type: "double",
    p_monthly_amount: 700000,
    p_effective_from: lastMonth,
  });
  await owner.client.rpc("generate_invoices", {
    p_hostel_id: hostel.id,
    p_period_month: lastMonth,
  });
  const { data: invoice } = await admin
    .from("invoices")
    .select("id")
    .eq("resident_id", residentId)
    .single();
  await owner.client.from("payments").insert({
    hostel_id: hostel.id,
    invoice_id: invoice!.id,
    amount: 200000,
    paid_at: todayIst(),
    mode: "cash",
  });

  await signIn(page, owner.email, TEST_PASSWORD);
  await page.goto(`/fees/${invoice!.id}`);
  await expect(inMain(page).getByText(/This invoice has payments\. Void them first/)).toBeVisible();

  await inMain(page)
    .getByRole("button", { name: /Void payment of ₹2,000/ })
    .click();
  let dialog = page.getByRole("dialog", { name: "Void this payment" });
  await dialog.getByRole("button", { name: "Void payment" }).click();
  await expect(dialog.getByText("Reason is required")).toBeVisible();
  await dialog.getByLabel(/^Reason/).fill("Recorded against the wrong resident");
  await dialog.getByRole("button", { name: "Void payment" }).click();
  await expect(dialog).toBeHidden();
  await expect(inMain(page).getByText("Void: Recorded against the wrong resident")).toBeVisible();

  await inMain(page)
    .getByRole("button", { name: `Void invoice for ${lastMonthLabel}` })
    .click();
  dialog = page.getByRole("dialog", { name: "Void this invoice" });
  await dialog.getByLabel(/^Reason/).fill("Wrong rent");
  await dialog.getByRole("button", { name: "Void invoice" }).click();
  await expect(dialog).toBeHidden();
  await expect(inMain(page).getByText(/Voided: Wrong rent/)).toBeVisible();

  await page.goto("/fees");
  await billMonth(page);
  await expect(
    inMain(page).getByText(`Created 1 invoice for ${lastMonthLabel} worth ₹7,000.`),
  ).toBeVisible();
});

test("staff record payments but cannot generate, set rates or void", async ({ page }) => {
  const { owner, hostel, beds } = await setup("Staff PG");
  const staff = await factory.createUser({ profile: { role: "staff", hostel_id: hostel.id } });
  const residentId = await residentInBed(hostel.id, owner.id, "Kiran Rao", beds["101"]);
  await owner.client.rpc("set_fee_structure", {
    p_hostel_id: hostel.id,
    p_sharing_type: "double",
    p_monthly_amount: 600000,
    p_effective_from: lastMonth,
  });
  await owner.client.rpc("generate_invoices", {
    p_hostel_id: hostel.id,
    p_period_month: lastMonth,
  });

  await signIn(page, staff.email, TEST_PASSWORD);
  await page.goto("/fees");
  await expect(inMain(page).getByRole("heading", { name: "Fees" })).toBeVisible();
  await expect(inMain(page).getByRole("button", { name: "Generate invoices" })).toHaveCount(0);

  await page.goto(`/residents/${residentId}`);
  await inMain(page).getByRole("button", { name: "Record payment for Kiran Rao" }).click();
  const dialog = page.getByRole("dialog", { name: "Record a payment from Kiran Rao" });
  await dialog.getByLabel(/^Mode/).selectOption("cash");
  await dialog.getByRole("button", { name: "Record payment" }).click();
  await expect(dialog).toBeHidden();
  await expect(inMain(page).getByText("Nothing is due.")).toBeVisible();

  await inMain(page)
    .getByRole("link", { name: `Invoice for ${lastMonthLabel}` })
    .click();
  await expect(inMain(page).getByRole("button", { name: /^Void/ })).toHaveCount(0);

  await page.goto("/settings/fees");
  await expect(inMain(page).getByText("Only the hostel owner can change rates.")).toBeVisible();
});
