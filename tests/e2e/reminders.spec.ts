import { expect, test } from "@playwright/test";

import { shiftMonth } from "@/lib/money";
import { todayIst } from "@/lib/validation";

import { residentRow } from "../support/residents";
import { createUserFactory, TEST_PASSWORD } from "../support/supabase";
import { inMain, signIn } from "./helpers";

/** Fee reminders and receipts sent by hand over WhatsApp (EP-11). */
const factory = createUserFactory();
const { admin } = factory;

test.afterAll(factory.cleanup);

/** An owner whose one resident owes last month's rent. */
async function hostelWithDues() {
  const owner = await factory.createUser({ fullName: "Latha Reddy" });
  const hostel = await factory.createHostel(owner.id, { name: "Green Leaf PG" });
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
    .insert(residentRow(hostel.id, { full_name: "Kavya Iyer", phone: "9845012345" }))
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
    p_monthly_amount: 900000,
    p_effective_from: shiftMonth(todayIst(), -6),
  });
  await owner.client.rpc("generate_invoices", {
    p_hostel_id: hostel.id,
    p_period_month: shiftMonth(todayIst(), -1),
  });
  return { owner, hostel, residentId: resident!.id };
}

test("an owner reminds a resident on WhatsApp and the send is recorded", async ({
  page,
  context,
}) => {
  const { owner } = await hostelWithDues();
  // WhatsApp itself is never contacted in tests.
  await context.route("https://wa.me/**", (route) => route.fulfill({ body: "WhatsApp" }));
  await signIn(page, owner.email, TEST_PASSWORD);

  await page.goto("/fees");
  await page.getByRole("link", { name: "Send reminders" }).click();
  await expect(page.getByRole("heading", { name: "Fee reminders" })).toBeVisible();
  const row = inMain(page).getByRole("row", { name: /Kavya Iyer/ });
  await expect(row.getByText("₹9,000", { exact: true })).toBeVisible();
  await expect(row.getByText("Never")).toBeVisible();

  const popup = page.waitForEvent("popup");
  await row.getByRole("link", { name: "Send reminder to Kavya Iyer on WhatsApp" }).click();
  const whatsapp = await popup;
  const url = new URL(whatsapp.url());
  expect(url.pathname).toBe("/919845012345");
  const text = url.searchParams.get("text") ?? "";
  expect(text).toContain("Hello Kavya Iyer, this is a reminder from Green Leaf PG.");
  expect(text).toContain("Rent of ₹9,000 is pending");
  await whatsapp.close();

  await expect(row.getByText("WhatsApp opened and the reminder recorded.")).toBeVisible();
  await page.reload();
  await expect(row.getByText("by Latha Reddy")).toBeVisible();

  // The dashboard's overdue list shows it too.
  await page.goto("/dashboard");
  await expect(inMain(page).getByText(/^Reminded \d+ \w+/)).toBeVisible();
});

test("an owner rewords the reminder; unknown placeholders are refused", async ({
  page,
  context,
}) => {
  const { owner } = await hostelWithDues();
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await signIn(page, owner.email, TEST_PASSWORD);

  await page.goto("/settings/fees");
  const message = page.getByRole("textbox", { name: "Reminder message" });
  await message.fill("Namaste {name}, {amount} is due at {hostal}.");
  await page.getByRole("button", { name: "Save message" }).click();
  await expect(inMain(page).getByText("Unknown placeholder: {hostal}")).toBeVisible();
  await message.fill("Namaste {name}, {amount} is due at {hostel}.");
  await page.getByRole("button", { name: "Save message" }).click();
  await expect(inMain(page).getByText("Reminder message saved.")).toBeVisible();

  await page.goto("/fees/reminders");
  await page.getByRole("button", { name: "Copy reminder to Kavya Iyer" }).click();
  await expect(inMain(page).getByText("Message copied and recorded.")).toBeVisible();
  const copied = await page.evaluate(() => navigator.clipboard.readText());
  expect(copied).toBe("Namaste Kavya Iyer, ₹9,000 is due at Green Leaf PG.");
});

test("staff send a payment receipt from the invoice", async ({ page, context }) => {
  const { hostel, residentId } = await hostelWithDues();
  const staff = await factory.createUser({
    fullName: "Mohan Das",
    profile: { role: "staff", hostel_id: hostel.id },
  });
  const { data: invoice } = await admin
    .from("invoices")
    .select("id")
    .eq("resident_id", residentId)
    .single();
  await staff.client.from("payments").insert({
    hostel_id: hostel.id,
    invoice_id: invoice!.id,
    amount: 400000,
    paid_at: todayIst(),
    mode: "upi",
  });
  await context.route("https://wa.me/**", (route) => route.fulfill({ body: "WhatsApp" }));
  await signIn(page, staff.email, TEST_PASSWORD);

  await page.goto(`/fees/${invoice!.id}`);
  const popup = page.waitForEvent("popup");
  await page
    .getByRole("link", { name: "Send receipt for ₹4,000 to Kavya Iyer on WhatsApp" })
    .click();
  const text = new URL((await popup).url()).searchParams.get("text") ?? "";
  expect(text).toContain("Green Leaf PG has received your payment of ₹4,000");
  expect(text).toContain("Balance still due: ₹5,000.");

  await expect
    .poll(
      async () =>
        (await admin.from("reminder_log").select("id").eq("invoice_id", invoice!.id)).data?.length,
    )
    .toBe(1);
  const { data: recorded } = await admin
    .from("reminder_log")
    .select("kind, channel, amount, sent_by_name")
    .eq("invoice_id", invoice!.id)
    .single();
  expect(recorded).toEqual({
    kind: "receipt",
    channel: "whatsapp",
    amount: 400000,
    sent_by_name: "Mohan Das",
  });
});
