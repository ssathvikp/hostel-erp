import { expect, test } from "@playwright/test";

import { formatMonth, shiftMonth } from "@/lib/money";
import { todayIst } from "@/lib/validation";

import { residentRow } from "../support/residents";
import { createUserFactory, TEST_PASSWORD } from "../support/supabase";
import { inMain, signIn } from "./helpers";

/** Collection reports and exports in a real browser (E13-T12). */
const factory = createUserFactory();
const { admin } = factory;

test.afterAll(factory.cleanup);

test("an owner reads collections and dues by age, and downloads both exports", async ({ page }) => {
  const owner = await factory.createUser({ fullName: "Nisha Owner" });
  const hostel = await factory.createHostel(owner.id, { name: "Report PG" });
  const lastMonth = shiftMonth(todayIst(), -1);
  const { data: resident } = await admin
    .from("residents")
    .insert(residentRow(hostel.id, { full_name: "Gopal Rao" }))
    .select("id")
    .single();
  const invoices = [];
  for (const [month, amount, due] of [
    [lastMonth, 800000, `${lastMonth.slice(0, 8)}05`],
    [shiftMonth(todayIst(), -4), 500000, `${shiftMonth(todayIst(), -4).slice(0, 8)}05`],
  ] as const) {
    const { data, error } = await admin
      .from("invoices")
      .insert({
        hostel_id: hostel.id,
        resident_id: resident!.id,
        period_month: month,
        amount,
        due_date: due,
      })
      .select("id")
      .single();
    if (error) throw error;
    invoices.push(data.id);
  }
  await owner.client.rpc("record_payment", {
    p_invoice_id: invoices[0],
    p_amount: 300000,
    p_paid_at: todayIst(),
    p_mode: "upi",
    p_reference: "UTR77",
  });

  await signIn(page, owner.email, TEST_PASSWORD);
  await page.goto("/reports");

  // This month: one UPI receipt of ₹3,000 collected by the owner.
  await expect(inMain(page).getByText("₹3,000").first()).toBeVisible();
  await expect(
    inMain(page)
      .getByRole("table", { name: "By collector" })
      .getByRole("row", { name: /Nisha Owner.*1.*₹3,000/ }),
  ).toBeVisible();

  // Dues: ₹5,000 left on last month, ₹5,000 from four months ago, over 90 days late.
  const dues = inMain(page).getByRole("table", { name: "Dues by resident and age" });
  await expect(dues.getByRole("row", { name: /Gopal Rao.*₹5,000.*₹10,000/ })).toBeVisible();

  const receipts = page.waitForEvent("download");
  await inMain(page).getByRole("link", { name: "Download receipts (CSV)" }).click();
  const receiptsFile = await receipts;
  expect(receiptsFile.suggestedFilename()).toMatch(/^collections-.*\.csv$/);
  const receiptsText = await (await receiptsFile.createReadStream()).toArray();
  expect(Buffer.concat(receiptsText).toString("utf8")).toContain('"Gopal Rao","upi","UTR77"');

  const register = page.waitForEvent("download");
  await inMain(page).locator("#register-month").fill(lastMonth.slice(0, 7));
  await inMain(page).getByRole("button", { name: "Download register (CSV)" }).click();
  const registerFile = await register;
  expect(registerFile.suggestedFilename()).toBe(`fee-register-${lastMonth.slice(0, 7)}.csv`);
  const registerText = Buffer.concat(
    await (await registerFile.createReadStream()).toArray(),
  ).toString("utf8");
  expect(registerText).toContain(`"Monthly invoice for ${formatMonth(lastMonth)}"`);
  expect(registerText).toContain("8000.00");
});
