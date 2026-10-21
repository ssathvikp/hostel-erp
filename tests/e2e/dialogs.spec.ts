import { expect, test } from "@playwright/test";

import { shiftMonth } from "@/lib/money";
import { todayIst } from "@/lib/validation";

import { residentRow } from "../support/residents";
import { createUserFactory, TEST_PASSWORD } from "../support/supabase";
import { signIn } from "./helpers";

/** Dialogs reopen clean after a failed or cancelled attempt (review fix 18). */
const factory = createUserFactory();
const { admin } = factory;

test.afterAll(factory.cleanup);

test("a payment dialog reopens without the last error or typed amount", async ({ page }) => {
  const owner = await factory.createUser({ fullName: "Dialog Owner" });
  const hostel = await factory.createHostel(owner.id);
  const { data: room } = await admin
    .from("rooms")
    .insert({
      hostel_id: hostel.id,
      room_number: "9",
      floor: 1,
      sharing_type: "single",
      capacity: 1,
    })
    .select("id")
    .single();
  const { data: bed } = await admin.from("beds").select("id").eq("room_id", room!.id).single();
  const { data: resident } = await admin
    .from("residents")
    .insert(residentRow(hostel.id, { full_name: "Sana Mirza" }))
    .select("id")
    .single();
  await admin.from("allocations").insert({
    hostel_id: hostel.id,
    resident_id: resident!.id,
    bed_id: bed!.id,
    room_id: room!.id,
    start_date: shiftMonth(todayIst(), -3),
    created_by: owner.id,
  });
  await owner.client.rpc("set_fee_structure", {
    p_hostel_id: hostel.id,
    p_sharing_type: "single",
    p_monthly_amount: 700000,
    p_effective_from: shiftMonth(todayIst(), -6),
  });
  await owner.client.rpc("generate_invoices", {
    p_hostel_id: hostel.id,
    p_period_month: shiftMonth(todayIst(), -1),
  });

  await signIn(page, owner.email, TEST_PASSWORD);
  await page.goto(`/residents/${resident!.id}`);
  await page.getByRole("button", { name: "Record payment for Sana Mirza" }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel(/^Amount/).fill("9000");
  // Cash beyond what is due becomes advance credit (E13-T7); a cheque for more
  // than is due is still refused, which gives a failed attempt to reopen after.
  await dialog.getByLabel(/^Mode/).selectOption("cheque");
  await dialog.getByLabel(/^Cheque number/).fill("123456");
  await dialog.getByLabel(/^Bank/).fill("SBI");
  await dialog.getByRole("button", { name: "Record payment" }).click();
  const refused = dialog.getByText(/A cheque cannot be more than is due/);
  await expect(refused).toBeVisible();
  await dialog.getByRole("button", { name: "Cancel" }).click();

  await page.getByRole("button", { name: "Record payment for Sana Mirza" }).click();
  await expect(refused).toHaveCount(0);
  await expect(dialog.getByLabel(/^Amount/)).toHaveValue("7000");
  await expect(dialog.getByLabel(/^Mode/)).toHaveValue("");
});
