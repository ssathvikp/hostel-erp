import { expect, test } from "@playwright/test";

import { formatPaise, shiftMonth } from "@/lib/money";
import { todayIst } from "@/lib/validation";

import { residentRow } from "../support/residents";
import { createUserFactory, TEST_PASSWORD } from "../support/supabase";
import { inMain, signIn } from "./helpers";

/** KPI cards, trend, work queue and the date range in a real browser (EP-08). */
const factory = createUserFactory();
const { admin } = factory;

test.afterAll(factory.cleanup);

function daysFromToday(days: number): string {
  const date = new Date(`${todayIst()}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

const tile = (page: import("@playwright/test").Page, label: string) =>
  inMain(page).locator("dl", { has: page.getByText(label, { exact: true }) });

test("a brand new hostel shows a calm zero state", async ({ page }) => {
  const owner = await factory.createUser({ fullName: "Asha Rao" });
  await factory.createHostel(owner.id, { name: "Empty Nest PG" });
  await signIn(page, owner.email, TEST_PASSWORD);

  await page.goto("/dashboard");
  await expect(inMain(page).getByText("No beds yet.")).toBeVisible();
  await expect(tile(page, "Collected")).toContainText("₹0");
  await expect(tile(page, "Outstanding")).toContainText("₹0");
  await expect(
    inMain(page).getByText(/^Nothing yet\. Allocations, moves and payments/),
  ).toBeVisible();
  await expect(inMain(page).getByText("No one is overdue.", { exact: false })).toBeVisible();
});

test("the dashboard matches the occupancy and fee screens and acts as a work queue", async ({
  page,
}) => {
  const owner = await factory.createUser({ fullName: "Ravi Teja" });
  const hostel = await factory.createHostel(owner.id, { name: "Numbers PG" });
  const { data: room } = await admin
    .from("rooms")
    .insert({
      hostel_id: hostel.id,
      room_number: "11",
      floor: 1,
      sharing_type: "triple",
      capacity: 3,
    })
    .select("id")
    .single();
  const { data: beds } = await admin
    .from("beds")
    .select("id")
    .eq("room_id", room!.id)
    .order("bed_label");
  const { data: resident } = await admin
    .from("residents")
    .insert(residentRow(hostel.id, { full_name: "Gita Sen" }))
    .select("id")
    .single();
  await admin.from("allocations").insert({
    hostel_id: hostel.id,
    resident_id: resident!.id,
    bed_id: beds![0].id,
    room_id: room!.id,
    start_date: daysFromToday(-70),
    created_by: owner.id,
  });
  await owner.client.rpc("set_fee_structure", {
    p_hostel_id: hostel.id,
    p_sharing_type: "triple",
    p_monthly_amount: 600000,
    p_effective_from: shiftMonth(todayIst(), -6),
  });
  await owner.client.rpc("generate_invoices", {
    p_hostel_id: hostel.id,
    p_period_month: shiftMonth(todayIst(), -1),
  });
  const { data: invoice } = await admin
    .from("invoices")
    .select("id")
    .eq("resident_id", resident!.id)
    .single();
  await owner.client.from("payments").insert({
    hostel_id: hostel.id,
    invoice_id: invoice!.id,
    amount: 200000,
    paid_at: todayIst(),
    mode: "upi",
  });

  await signIn(page, owner.email, TEST_PASSWORD);
  await page.goto("/dashboard");

  // Beds today, exactly as the occupancy screen reports them.
  await expect(tile(page, "Total beds")).toContainText("3");
  await expect(tile(page, "Occupied")).toContainText("1");
  await expect(tile(page, "Vacant")).toContainText("2");
  await expect(tile(page, "Occupancy")).toContainText("33%");

  // Money: collected this month, owed today.
  await expect(tile(page, "Collected")).toContainText(formatPaise(200000));
  await expect(tile(page, "Outstanding")).toContainText(formatPaise(400000));
  await expect(tile(page, "Overdue")).toContainText(formatPaise(400000));

  // Work queue: the payment and the allocation, and who is overdue.
  const activity = inMain(page).getByRole("region", { name: "Recent activity" });
  await expect(activity.getByRole("link", { name: "₹2,000 from Gita Sen" })).toBeVisible();
  await expect(activity.getByText("Allocated")).toBeVisible();
  const overdue = inMain(page).getByRole("region", { name: "Overdue fees" });
  await expect(overdue.getByText(/\d+ days? overdue/)).toBeVisible();
  await overdue.getByRole("link", { name: "Gita Sen" }).click();
  await expect(page).toHaveURL(new RegExp(`/residents/${resident!.id}$`));

  // The same figures on the other screens.
  await page.goto("/occupancy");
  await expect(inMain(page).getByText("33%").first()).toBeVisible();
  await page.goto("/fees?status=overdue");
  await expect(
    inMain(page)
      .getByRole("link", { name: /Overdue/ })
      .getByText(formatPaise(400000)),
  ).toBeVisible();

  // Range presets live in the URL; last month had no payments.
  await page.goto("/dashboard");
  await inMain(page).getByRole("button", { name: "Last month" }).click();
  await expect(page).toHaveURL(/range=last_month/);
  await expect(tile(page, "Collected")).toContainText("₹0");
  await expect(tile(page, "Billed")).toContainText(formatPaise(600000));
  await expect(inMain(page).getByRole("button", { name: "Last month" })).toHaveAttribute(
    "aria-pressed",
    "true",
  );

  // The trend can be read from the keyboard, and as a table.
  const chart = inMain(page).getByRole("img", { name: /^Occupancy from/ });
  await chart.focus();
  await page.keyboard.press("ArrowLeft");
  await expect(inMain(page).getByRole("status").filter({ hasText: "of 3 beds" })).toBeVisible();
  await inMain(page).getByText("Show as table").click();
  await expect(inMain(page).getByRole("table", { name: "Occupancy by day" })).toBeVisible();
});

test("a reversed custom range is rejected with a clear message", async ({ page }) => {
  const owner = await factory.createUser();
  await factory.createHostel(owner.id);
  await signIn(page, owner.email, TEST_PASSWORD);

  await page.goto("/dashboard");
  await inMain(page).getByRole("button", { name: "Custom range" }).click();
  await inMain(page).getByLabel(/^From/).fill(daysFromToday(-1));
  await inMain(page).getByLabel(/^To/).fill(daysFromToday(-10));
  await inMain(page).getByRole("button", { name: "Apply" }).click();
  await expect(page).toHaveURL(/range=custom/);
  await expect(
    inMain(page).getByText(
      "The start date must be on or before the end date. Showing this month instead.",
    ),
  ).toBeVisible();

  // A valid custom range is kept and shared through the URL.
  await page.goto(`/dashboard?range=custom&from=${daysFromToday(-20)}&to=${todayIst()}`);
  await expect(inMain(page).getByRole("button", { name: "Custom range" })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await expect(inMain(page).getByLabel(/^From/)).toHaveValue(daysFromToday(-20));
});
