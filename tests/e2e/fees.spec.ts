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
  const setRate = inMain(page).getByRole("region", { name: "Set a rate" });
  await setRate.getByLabel(/^Sharing type/).selectOption("double");
  await setRate.getByLabel(/^Monthly rent/).fill("8000");
  await setRate.getByLabel(/^Applies from/).fill(lastMonth);
  await setRate.getByRole("button", { name: "Save rate" }).click();
  await expect(setRate.getByText("Rate saved.")).toBeVisible();
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

test("an owner adds a monthly charge, bills it on the invoice and excuses one resident", async ({
  page,
}) => {
  const { owner, hostel, beds } = await setup("Mess Hall PG");
  const sitaId = await residentInBed(hostel.id, owner.id, "Sita Rao", beds["101"]);
  const arunId = await residentInBed(hostel.id, owner.id, "Arun Pal", beds["201"]);
  await owner.client.rpc("set_fee_structure", {
    p_hostel_id: hostel.id,
    p_sharing_type: "double",
    p_monthly_amount: 800000,
    p_effective_from: shiftMonth(todayIst(), -6),
  });
  await owner.client.rpc("set_fee_structure", {
    p_hostel_id: hostel.id,
    p_sharing_type: "single",
    p_monthly_amount: 1000000,
    p_effective_from: shiftMonth(todayIst(), -6),
  });
  await signIn(page, owner.email, TEST_PASSWORD);

  // Add the charge, then its rate from six months ago.
  await page.goto("/settings/fees");
  const charges = inMain(page).getByRole("region", { name: "Other charges" });
  await charges.getByLabel(/^Name/).fill("Mess");
  await charges.getByRole("button", { name: "Add charge" }).click();
  await expect(charges.getByText("Mess added. Set its rate below.")).toBeVisible();
  await charges.getByRole("combobox", { name: "Charge" }).selectOption({ label: "Mess" });
  await charges.getByLabel(/^Amount/).fill("3000");
  await charges.getByLabel(/^Applies from/).fill(shiftMonth(todayIst(), -6));
  await charges.getByRole("button", { name: "Save charge rate" }).click();
  await expect(charges.getByText("Charge rate saved.")).toBeVisible();
  await expect(
    charges.getByRole("table", { name: "Charges" }).getByRole("row", { name: /Mess.*₹3,000/ }),
  ).toBeVisible();

  // Arun eats elsewhere.
  await page.goto(`/residents/${arunId}`);
  await inMain(page).getByRole("button", { name: "Excuse this resident from Mess" }).click();
  await expect(inMain(page).getByText("Excused", { exact: true })).toBeVisible();

  await page.goto("/fees");
  await billMonth(page);
  await expect(
    inMain(page).getByText(`Created 2 invoices for ${lastMonthLabel} worth ₹21,000.`),
  ).toBeVisible();

  // Sita's invoice lists rent and mess.
  const { data: invoice } = await admin
    .from("invoices")
    .select("id")
    .eq("resident_id", sitaId)
    .single();
  await page.goto(`/fees/${invoice!.id}`);
  const lines = inMain(page).getByRole("region", { name: "What it is for" });
  await expect(lines.getByText("Rent")).toBeVisible();
  await expect(lines.getByText("Mess")).toBeVisible();
  await expect(lines.getByText("₹3,000")).toBeVisible();
  await page.goto(`/fees/${invoice!.id}/print`);
  await expect(inMain(page).getByRole("cell", { name: "Mess" })).toBeVisible();
  // Arun is billed first (by name), so Sita's is the hostel's second invoice.
  await expect(inMain(page).getByText(/^INV\/\d\d-\d\d\/00002$/)).toBeVisible();
});

test("an owner charges, discounts and fines a resident, then waives the fine", async ({ page }) => {
  const { owner, hostel, beds } = await setup("Extras PG");
  const sitaId = await residentInBed(hostel.id, owner.id, "Sita Iyer", beds["101"]);
  await owner.client.rpc("set_fee_structure", {
    p_hostel_id: hostel.id,
    p_sharing_type: "double",
    p_monthly_amount: 800000,
    p_effective_from: shiftMonth(todayIst(), -6),
  });
  await signIn(page, owner.email, TEST_PASSWORD);

  // A one-off charge, dated last month so it lands on last month's invoice.
  await page.goto(`/residents/${sitaId}`);
  await inMain(page).getByRole("button", { name: "Add charge" }).click();
  const chargeDialog = page.getByRole("dialog", { name: "Charge Sita Iyer" });
  await chargeDialog.getByLabel(/^Description/).fill("Key replacement");
  await chargeDialog.getByLabel(/^Amount/).fill("200");
  await chargeDialog.getByLabel(/^Date/).fill(`${lastMonth.slice(0, 8)}15`);
  await chargeDialog.getByRole("button", { name: "Add charge" }).click();
  const charges = inMain(page).getByRole("table", { name: "Charges and late fees" });
  await expect(
    charges.getByRole("row", { name: /Key replacement.*₹200.*Next invoice/ }),
  ).toBeVisible();

  // Ten percent off rent from last month.
  await inMain(page).getByRole("button", { name: "Give discount" }).click();
  const discountDialog = page.getByRole("dialog", { name: "Discount for Sita Iyer" });
  await discountDialog.getByLabel(/^Percentage or amount/).fill("10");
  await discountDialog.getByLabel(/^From/).fill(lastMonth.slice(0, 7));
  await discountDialog.getByLabel(/^Reason/).fill("Sibling also staying");
  await discountDialog.getByRole("button", { name: "Save discount" }).click();
  await expect(inMain(page).getByText(/10% off rent from/)).toBeVisible();

  // A fixed late fee with no grace days.
  await page.goto("/settings/fees");
  const lateFees = inMain(page).getByRole("region", { name: "Late fees" });
  await lateFees.getByLabel(/^Grace days/).fill("0");
  await lateFees.getByLabel(/^Amount/).fill("100");
  await lateFees.getByRole("button", { name: "Save late fee rule" }).click();
  await expect(lateFees.getByText("Late fee rule saved.", { exact: false })).toBeVisible();

  // Rent 8,000 less 800, plus the 200 charge.
  await page.goto("/fees");
  await billMonth(page);
  await expect(
    inMain(page).getByText(`Created 1 invoice for ${lastMonthLabel} worth ₹7,400.`),
  ).toBeVisible();

  // Last month's invoice is already past due: the fine applies.
  await inMain(page).getByRole("button", { name: "Apply late fees now" }).click();
  await expect(inMain(page).getByText("Late fees updated on 1 invoice.")).toBeVisible();

  await page.goto(`/residents/${sitaId}`);
  await expect(charges.getByRole("row", { name: /Key replacement.*Billed/ })).toBeVisible();
  const fine = charges.getByRole("row", { name: /Late fee on INV.*₹100.*Next invoice/ });
  await expect(fine).toBeVisible();
  await fine.getByRole("button", { name: "Void late fee of ₹100" }).click();
  const voidDialog = page.getByRole("dialog", { name: "Void this charge" });
  await voidDialog.getByLabel(/^Reason/).fill("First delay, waived");
  await voidDialog.getByRole("button", { name: "Void charge" }).click();
  await expect(charges.getByRole("row", { name: /Late fee on INV.*Void/ })).toBeVisible();
});

test("an owner takes a deposit, keeps an overpayment as credit, and settles on move-out", async ({
  page,
}) => {
  const { owner, hostel, beds } = await setup("Deposit PG");
  await owner.client
    .from("deposit_amounts")
    .insert({ hostel_id: hostel.id, sharing_type: "double", amount: 1500000 });
  const raviId = await residentInBed(hostel.id, owner.id, "Ravi Kiran", beds["101"]);
  await owner.client.rpc("set_fee_structure", {
    p_hostel_id: hostel.id,
    p_sharing_type: "double",
    p_monthly_amount: 800000,
    p_effective_from: shiftMonth(todayIst(), -6),
  });
  await signIn(page, owner.email, TEST_PASSWORD);

  // The deposit asked for on his first stay, then received.
  await page.goto(`/residents/${raviId}`);
  const money = inMain(page).getByRole("region", { name: "Credit and deposit" });
  await expect(money.getByText("₹15,000 still to receive")).toBeVisible();
  await money.getByRole("button", { name: "Record deposit" }).click();
  const depositDialog = page.getByRole("dialog", { name: "Record the deposit received" });
  await expect(depositDialog.getByLabel(/^Amount/)).toHaveValue("15000");
  await depositDialog.getByLabel(/^Mode/).selectOption("bank_transfer");
  await depositDialog.getByRole("button", { name: "Record deposit" }).click();
  await expect(depositDialog).toBeHidden();
  await expect(money.getByRole("row", { name: /Deposit received.*₹15,000.*RCT\// })).toBeVisible();

  // Last month's rent, paid with ₹2,000 extra, kept as credit.
  await page.goto("/fees");
  await billMonth(page);
  const row = inMain(page)
    .getByRole("table", { name: "Invoices" })
    .getByRole("row", { name: /Ravi Kiran/ });
  await row.getByRole("button", { name: "Record payment for Ravi Kiran" }).click();
  const payDialog = page.getByRole("dialog", { name: "Record a payment from Ravi Kiran" });
  await payDialog.getByLabel(/^Amount/).fill("10000");
  await payDialog.getByLabel(/^Mode/).selectOption("cash");
  await payDialog.getByRole("button", { name: "Record payment" }).click();
  await expect(payDialog.getByText(/To keep the rest as credit/)).toBeVisible();
  await payDialog.getByLabel("Keep anything above what is due as credit").check();
  await payDialog.getByRole("button", { name: "Record payment" }).click();
  await expect(payDialog).toBeHidden();

  // He leaves today.
  await page.goto(`/residents/${raviId}`);
  await expect(money.getByText("₹2,000").first()).toBeVisible();
  await inMain(page)
    .getByRole("button", { name: /^Vacate bed/ })
    .click();
  const vacate = page.getByRole("dialog", { name: /^Vacate bed/ });
  await vacate.getByLabel(/^Reason/).selectOption("moved_out");
  await vacate.getByRole("button", { name: "Vacate bed" }).click();
  await expect(vacate).toBeHidden();

  // Settle: keep ₹500 for cleaning, pay back the rest by UPI.
  await money.getByRole("link", { name: "Settle and close" }).click();
  await expect(page).toHaveURL(new RegExp(`/residents/${raviId}/settlement$`));
  const statement = inMain(page).getByRole("region", { name: "Statement" });
  await expect(statement.getByText("To pay back to the resident")).toBeVisible();
  await inMain(page).getByLabel("Deduction 1 (₹)").fill("500");
  await inMain(page).getByLabel("Reason 1").fill("Room cleaning");
  await inMain(page)
    .getByLabel(/^Pay back what is left by/)
    .selectOption("upi");
  await inMain(page).getByRole("button", { name: "Settle" }).click();
  await expect(inMain(page).getByText("Nothing left to settle")).toBeVisible();
  const movements = inMain(page).getByRole("table", { name: "Credit and deposit movements" });
  await expect(
    movements.getByRole("row", { name: /Kept from deposit.*₹500.*Room cleaning/ }),
  ).toBeVisible();
  await expect(movements.getByRole("row", { name: /Deposit paid back.*₹14,500/ })).toBeVisible();
  await expect(movements.getByRole("row", { name: /Credit paid back.*₹2,000/ })).toBeVisible();
});

test("a cheque waits to clear, one clears and one bounces with a charge", async ({ page }) => {
  const { owner, hostel, beds } = await setup("Cheque PG");
  const asha = await residentInBed(hostel.id, owner.id, "Asha Nair", beds["101"]);
  await residentInBed(hostel.id, owner.id, "Kabir Shah", beds["201"]);
  for (const [sharing, amount] of [
    ["double", 600000],
    ["single", 900000],
  ] as const) {
    await owner.client.rpc("set_fee_structure", {
      p_hostel_id: hostel.id,
      p_sharing_type: sharing,
      p_monthly_amount: amount,
      p_effective_from: lastMonth,
    });
  }
  await owner.client.rpc("generate_invoices", {
    p_hostel_id: hostel.id,
    p_period_month: lastMonth,
  });
  await signIn(page, owner.email, TEST_PASSWORD);

  // Both pay by cheque from the fee list.
  await page.goto("/fees");
  const invoices = inMain(page).getByRole("table", { name: "Invoices" });
  for (const [name, number] of [
    ["Asha Nair", "100201"],
    ["Kabir Shah", "553002"],
  ]) {
    await invoices.getByRole("button", { name: `Record payment for ${name}` }).click();
    const dialog = page.getByRole("dialog", { name: `Record a payment from ${name}` });
    await dialog.getByLabel(/^Mode/).selectOption("cheque");
    await dialog.getByRole("button", { name: "Record payment" }).click();
    await expect(dialog.getByText("Enter the cheque number")).toBeVisible();
    await dialog.getByLabel(/^Cheque number/).fill(number);
    await dialog.getByLabel(/^Bank/).fill("Canara Bank");
    await dialog.getByRole("button", { name: "Record payment" }).click();
    await expect(dialog).toBeHidden();
  }
  // Nothing is paid yet, and nothing more can be recorded against them.
  await expect(invoices.getByRole("row", { name: /Asha Nair.*₹6,000.*₹0.*₹6,000/ })).toBeVisible();
  await expect(invoices.getByRole("button", { name: "Record payment for Asha Nair" })).toHaveCount(
    0,
  );

  await inMain(page).getByRole("link", { name: "Cheques" }).click();
  await expect(page).toHaveURL(/\/fees\/cheques$/);
  await expect(inMain(page).getByText(/2 cheques, ₹15,000/)).toBeVisible();

  await inMain(page).getByRole("button", { name: "Mark cheque 100201 for ₹6,000 cleared" }).click();
  const clear = page.getByRole("dialog", { name: "Mark this cheque cleared" });
  await clear.getByRole("button", { name: "Mark cleared" }).click();
  await expect(clear).toBeHidden();

  await inMain(page).getByRole("button", { name: "Mark cheque 553002 for ₹9,000 bounced" }).click();
  const bounce = page.getByRole("dialog", { name: "Mark this cheque bounced" });
  await bounce.getByLabel(/^Reason/).fill("Insufficient funds");
  await bounce.getByLabel(/^Bounce charge/).fill("500");
  await bounce.getByRole("button", { name: "Mark bounced" }).click();
  await expect(bounce).toBeHidden();
  await expect(inMain(page).getByText("No cheques waiting")).toBeVisible();

  // Asha's invoice is paid; Kabir owes it again, plus the charge.
  await page.goto(`/residents/${asha}`);
  await expect(inMain(page).getByText(/Paid/).first()).toBeVisible();
  await page.goto("/fees");
  await expect(invoices.getByRole("row", { name: /Asha Nair.*₹6,000.*₹6,000.*₹0/ })).toBeVisible();
  await invoices.getByRole("link", { name: /View invoice for Kabir Shah/ }).click();
  await expect(inMain(page).getByText("Bounced: Insufficient funds")).toBeVisible();
  const { data: charge } = await admin
    .from("resident_charges")
    .select("amount, description")
    .eq("hostel_id", hostel.id)
    .single();
  expect(charge).toEqual({ amount: 50000, description: "Cheque bounce charge (cheque 553002)" });
});
