import { expect, test } from "@playwright/test";

import { formatMonth, shiftMonth } from "@/lib/money";
import { todayIst } from "@/lib/validation";

import { residentRow } from "../support/residents";
import { createUserFactory, TEST_PASSWORD } from "../support/supabase";
import { inMain, signIn } from "./helpers";

/** Fee heads, charges, discounts and electricity in a real browser (ClickUp EP-13). */
const factory = createUserFactory();
const { admin } = factory;

test.afterAll(factory.cleanup);

const lastMonth = shiftMonth(todayIst(), -1);

test("an owner adds a mess charge, a one-off charge and a discount, and bills an itemised month", async ({
  page,
}) => {
  test.slow();
  const owner = await factory.createUser();
  const hostel = await factory.createHostel(owner.id);
  const { data: room } = await admin
    .from("rooms")
    .insert({
      hostel_id: hostel.id,
      room_number: "12",
      floor: 1,
      sharing_type: "single",
      capacity: 1,
    })
    .select("id")
    .single();
  const { data: bed } = await admin.from("beds").select("id").eq("room_id", room!.id).single();
  await admin.from("fee_structures").insert({
    hostel_id: hostel.id,
    sharing_type: "single",
    monthly_amount: 800000,
    effective_from: "2020-01-01",
  });
  const { data: resident } = await admin
    .from("residents")
    .insert(residentRow(hostel.id, { full_name: "Itemised Ira" }))
    .select("id")
    .single();
  await admin.from("allocations").insert({
    hostel_id: hostel.id,
    resident_id: resident!.id,
    room_id: room!.id,
    bed_id: bed!.id,
    start_date: shiftMonth(todayIst(), -3),
    created_by: owner.id,
  });

  await signIn(page, owner.email, TEST_PASSWORD);

  // A monthly charge type with one price for every sharing type.
  await page.goto("/settings/fees");
  const heads = inMain(page).getByRole("region", { name: "Other charges" });
  await heads.getByLabel(/^Name/).fill("Mess");
  await heads.getByRole("button", { name: "Add charge type" }).click();
  await expect(heads.getByText("Mess added. Set its price next.")).toBeVisible();
  await heads.getByLabel(/^Charge type/).selectOption({ label: "Mess" });
  await heads.getByLabel(/^Amount/).fill("3000");
  await heads.getByLabel(/^Applies from/).fill("2020-01-01");
  await heads.getByRole("button", { name: "Save price" }).click();
  await expect(heads.getByText("Price saved.")).toBeVisible();
  await expect(heads.getByRole("cell", { name: "₹3,000" })).toBeVisible();

  // A one-off charge and a discount on the resident.
  await page.goto(`/residents/${resident!.id}`);
  const charges = inMain(page).getByRole("region", { name: "Charges and discounts" });
  await charges.getByLabel(/^Description/).fill("Extra mattress");
  await charges.getByLabel(/^Amount/).fill("500");
  await charges.getByLabel(/^Date/).fill(lastMonth);
  await charges.getByRole("button", { name: "Add charge" }).click();
  await expect(charges.getByText(/₹500 added/)).toBeVisible();
  await expect(charges.getByText("Pending", { exact: true })).toBeVisible();

  await charges.locator("#discount-value").fill("10");
  await charges.locator("#discount-from").fill(lastMonth.slice(0, 7));
  await charges.locator("#discount-reason").fill("Long stay");
  await charges.getByRole("button", { name: "Add discount" }).click();
  await expect(charges.getByText(/Discount added/)).toBeVisible();

  // Bill last month: rent + mess - 10% of rent + the mattress.
  await page.goto("/fees");
  await inMain(page)
    .getByLabel(/^Billing month/)
    .fill(lastMonth.slice(0, 7));
  await inMain(page).getByRole("button", { name: "Generate invoices" }).click();
  await expect(inMain(page).getByText(/Created 1 invoice for .* worth ₹10,700/)).toBeVisible();

  await inMain(page)
    .getByRole("link", { name: `View invoice for Itemised Ira, ${formatMonth(lastMonth)}` })
    .click();
  const lines = inMain(page).getByRole("region", { name: "What it is for" });
  for (const [text, amount] of [
    [/^Rent for /, "₹8,000"],
    ["Mess", "₹3,000"],
    ["Discount: Long stay", "-₹800"],
    ["Extra mattress", "₹500"],
  ] as const) {
    const row = lines.locator("div").filter({ has: page.getByText(text) });
    await expect(row.getByText(amount)).toBeVisible();
  }
});

test("staff record meter readings and the owner bills electricity", async ({ page }) => {
  test.slow();
  const owner = await factory.createUser();
  const hostel = await factory.createHostel(owner.id);
  await admin.from("hostels").update({ electricity_unit_rate: 1000 }).eq("id", hostel.id);
  const { data: room } = await admin
    .from("rooms")
    .insert({
      hostel_id: hostel.id,
      room_number: "7",
      floor: 1,
      sharing_type: "single",
      capacity: 1,
    })
    .select("id")
    .single();
  const { data: bed } = await admin.from("beds").select("id").eq("room_id", room!.id).single();
  const { data: resident } = await admin
    .from("residents")
    .insert(residentRow(hostel.id, { full_name: "Meter Mani" }))
    .select("id")
    .single();
  await admin.from("allocations").insert({
    hostel_id: hostel.id,
    resident_id: resident!.id,
    room_id: room!.id,
    bed_id: bed!.id,
    start_date: shiftMonth(todayIst(), -3),
    created_by: owner.id,
  });
  await admin.from("room_meter_readings").insert({
    hostel_id: hostel.id,
    room_id: room!.id,
    reading_month: shiftMonth(lastMonth, -1),
    reading: 2000,
    recorded_by: owner.id,
  });

  await signIn(page, owner.email, TEST_PASSWORD);
  await page.goto("/fees/electricity");
  await expect(
    page.getByRole("heading", { name: `Electricity, ${formatMonth(lastMonth)}` }),
  ).toBeVisible();
  await page.getByLabel("Reading for room 7").fill("2150");
  await inMain(page).getByRole("button", { name: "Save" }).click();
  await expect(inMain(page).getByText("Reading saved.")).toBeVisible();
  await expect(inMain(page).getByRole("cell", { name: "150", exact: true })).toBeVisible();

  await inMain(page).getByRole("button", { name: "Add electricity charges" }).click();
  await expect(inMain(page).getByText(/Billed 1 room for .*: 1 charge worth ₹1,500/)).toBeVisible();

  await page.goto(`/residents/${resident!.id}`);
  await expect(
    inMain(page).getByText(`Electricity, room 7, ${formatMonth(lastMonth)}`),
  ).toBeVisible();
});
