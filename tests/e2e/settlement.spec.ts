import { expect, test } from "@playwright/test";

import { todayIst } from "@/lib/validation";

import { residentRow } from "../support/residents";
import { createUserFactory, TEST_PASSWORD } from "../support/supabase";
import { inMain, signIn } from "./helpers";

/** Move-out settlement in a real browser (ClickUp E13-T8). */
const factory = createUserFactory();
const { admin } = factory;

test.afterAll(factory.cleanup);

test("an owner settles a move-out and prints the statement", async ({ page }) => {
  test.slow();
  const owner = await factory.createUser();
  const hostel = await factory.createHostel(owner.id);
  const { data: room } = await admin
    .from("rooms")
    .insert({
      hostel_id: hostel.id,
      room_number: "21",
      floor: 2,
      sharing_type: "single",
      capacity: 1,
    })
    .select("id")
    .single();
  const { data: bed } = await admin.from("beds").select("id").eq("room_id", room!.id).single();
  const { data: resident } = await admin
    .from("residents")
    .insert(residentRow(hostel.id, { full_name: "Leaving Lata" }))
    .select("id")
    .single();
  const { data: allocation } = await admin
    .from("allocations")
    .insert({
      hostel_id: hostel.id,
      resident_id: resident!.id,
      room_id: room!.id,
      bed_id: bed!.id,
      start_date: "2026-01-01",
      created_by: owner.id,
    })
    .select("id")
    .single();
  await owner.client.from("deposit_entries").insert({
    hostel_id: hostel.id,
    resident_id: resident!.id,
    kind: "collected",
    amount: 1000000,
    entry_date: "2026-01-01",
    mode: "cash",
  });
  await owner.client.from("invoices").insert({
    hostel_id: hostel.id,
    resident_id: resident!.id,
    period_month: "2026-02-01",
    amount: 300000,
    due_date: "2026-02-05",
  });
  await owner.client.rpc("vacate_allocation", {
    p_allocation_id: allocation!.id,
    p_move_out_date: todayIst(),
    p_reason: "moved_out",
    p_mark_vacated: true,
  });

  await signIn(page, owner.email, TEST_PASSWORD);
  await page.goto(`/residents/${resident!.id}`);
  await inMain(page).getByRole("link", { name: "Settle move-out" }).click();
  await expect(
    page.getByRole("heading", { name: "Settle Leaving Lata's move-out", level: 1 }),
  ).toBeVisible();

  await page.getByLabel("Deduction 1 (₹)").fill("1500");
  await page.locator("#settle-deduction-reason-1").fill("Deep cleaning");
  const summary = page.getByRole("region", { name: "Summary" });
  await expect(summary.getByText("Paid from deposit")).toBeVisible();
  // ₹10,000 deposit − ₹1,500 − ₹3,000 of dues.
  await expect(summary.getByText("₹5,500")).toBeVisible();
  await page.getByLabel("Refund paid by").selectOption("upi");
  await page.getByRole("button", { name: "Settle move-out" }).click();

  await expect(page.getByText("Move-out settlement", { exact: true })).toBeVisible();
  await expect(page.getByRole("row", { name: /Deduction: Deep cleaning -₹1,500/ })).toBeVisible();
  await expect(page.getByRole("row", { name: /Net refund to the resident ₹5,500/ })).toBeVisible();
  await expect(page.getByRole("button", { name: "Print statement" })).toBeVisible();

  await page.goto(`/residents/${resident!.id}`);
  await expect(inMain(page).getByRole("link", { name: "Statement" })).toBeVisible();
});
