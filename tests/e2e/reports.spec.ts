import { expect, test } from "@playwright/test";

import { todayIst } from "@/lib/validation";

import { residentRow } from "../support/residents";
import { createUserFactory, TEST_PASSWORD } from "../support/supabase";
import { inMain, signIn } from "./helpers";

/** Fee reports and their CSV downloads (ClickUp E13-T12). */
const factory = createUserFactory();
const { admin } = factory;

test.afterAll(factory.cleanup);

const today = todayIst();
const monthStart = `${today.slice(0, 7)}-01`;

test("an owner sees money in, dues and the fee register, and downloads them", async ({ page }) => {
  test.slow();
  const owner = await factory.createUser();
  const hostel = await factory.createHostel(owner.id);
  const { data: resident } = await admin
    .from("residents")
    .insert(residentRow(hostel.id, { full_name: "Report Rani" }))
    .select("id")
    .single();
  const { data: invoice } = await admin
    .from("invoices")
    .insert({
      hostel_id: hostel.id,
      resident_id: resident!.id,
      period_month: monthStart,
      amount: 600000,
      due_date: monthStart,
    })
    .select("id")
    .single();

  await signIn(page, owner.email, TEST_PASSWORD);
  // A part payment by UPI, recorded as the owner.
  const { error } = await owner.client.from("payments").insert({
    hostel_id: hostel.id,
    invoice_id: invoice!.id,
    amount: 250000,
    paid_at: today,
    mode: "upi",
  });
  expect(error).toBeNull();

  await page.goto("/fees");
  await inMain(page).getByRole("link", { name: "Reports" }).click();
  await expect(page.getByRole("heading", { name: "Fee reports", level: 1 })).toBeVisible();

  const byMode = inMain(page).getByRole("table", { name: "By payment mode" });
  await expect(byMode.getByRole("row", { name: /UPI 1 ₹2,500/ })).toBeVisible();
  const register = inMain(page).getByRole("region", { name: /Fee register/ });
  await expect(register.getByText("₹6,000 billed, ₹2,500 paid, ₹3,500 owed.")).toBeVisible();
  await expect(register.getByRole("cell", { name: "Report Rani" })).toBeVisible();
  await expect(
    inMain(page)
      .getByRole("region", { name: "Dues by age" })
      .getByText(/₹3,500 owed across 1/),
  ).toBeVisible();

  const response = await page.request.get(
    `/fees/reports/export?report=register&month=${monthStart.slice(0, 7)}`,
  );
  expect(response.headers()["content-type"]).toContain("text/csv");
  const csv = await response.text();
  expect(csv).toContain("Report Rani");
  expect(csv).toContain(",6000,2500,0,3500,");

  const collections = await (
    await page.request.get(`/fees/reports/export?report=collections&from=${monthStart}&to=${today}`)
  ).text();
  expect(collections).toContain(`${today},Payment,UPI,`);
  expect(collections.trim().endsWith(",2500")).toBe(true);
});

test("staff cannot open the reports or download them", async ({ page }) => {
  const owner = await factory.createUser();
  const hostel = await factory.createHostel(owner.id);
  const staff = await factory.createUser({ profile: { role: "staff", hostel_id: hostel.id } });

  await signIn(page, staff.email, TEST_PASSWORD);
  await page.goto("/fees/reports");
  await expect(page).toHaveURL(/\/fees$/);
  await expect(inMain(page).getByRole("link", { name: "Reports" })).toHaveCount(0);
  const response = await page.request.get("/fees/reports/export?report=dues");
  expect(response.status()).toBe(403);
});
