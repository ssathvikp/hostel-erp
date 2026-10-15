import { randomUUID } from "node:crypto";

import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

import { createUserFactory, TEST_PASSWORD } from "../support/supabase";
import { totp } from "../support/totp";
import { inMain, signIn } from "./helpers";

/** Subscription billing in a real browser (EP-14, E10-T7). */
const factory = createUserFactory();
const { admin } = factory;

test.afterAll(async () => {
  await factory.cleanup();
});

async function expectAccessible(page: Page) {
  const { violations } = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
    .analyze();
  expect
    .soft(
      violations.map((v) => v.id),
      `accessibility on ${page.url()}`,
    )
    .toEqual([]);
}

async function ownerWithHostel(name: string) {
  const owner = await factory.createUser({ fullName: "Billing Owner" });
  const hostel = await factory.createHostel(owner.id, { name });
  return { owner, hostel };
}

test("an owner on a trial sees the days left, the plans and saves billing details", async ({
  page,
}) => {
  const { owner } = await ownerWithHostel(`Trial PG ${randomUUID().slice(0, 5)}`);
  await signIn(page, owner.email, TEST_PASSWORD);

  await page.goto("/dashboard");
  await expect(inMain(page).getByText(/Free trial: 14 days left/)).toBeVisible();
  await inMain(page).getByRole("link", { name: "Choose a plan" }).click();
  await expect(page).toHaveURL(/\/settings\/billing$/);

  await expect(inMain(page).getByRole("heading", { name: "Pro" }).first()).toBeVisible();
  await expect(inMain(page).getByText("Free trial", { exact: true })).toBeVisible();
  // No Razorpay keys in the test environment: nothing can be bought online.
  await expect(inMain(page).getByText(/Online payment is not set up yet/)).toBeVisible();
  await expect(
    inMain(page).getByRole("button", { name: /Choose Starter, monthly/ }),
  ).toBeDisabled();
  await inMain(page).getByRole("radio", { name: "Annual" }).check({ force: true });
  await expect(inMain(page).getByRole("button", { name: /Choose Starter, annual/ })).toBeVisible();

  await page.getByLabel(/^Business name/).fill("Sunrise Hospitality LLP");
  await page.getByLabel(/^GSTIN/).fill("27ABCDE1234F1Z5");
  await page.getByLabel(/^Billing address/).fill("12 MG Road, Bengaluru");
  await page.getByLabel(/^State/).selectOption("29");
  await page.getByRole("button", { name: "Save billing details" }).click();
  await expect(
    inMain(page).getByText("The GSTIN's first two digits must match the state"),
  ).toBeVisible();
  await page.getByLabel(/^GSTIN/).fill("29ABCDE1234F1Z5");
  await page.getByRole("button", { name: "Save billing details" }).click();
  await expect(inMain(page).getByText(/Billing details saved/)).toBeVisible();
  await expectAccessible(page);
});

test("an ended trial makes the account read-only for owner and staff, without losing data", async ({
  page,
  browser,
}) => {
  const { owner, hostel } = await ownerWithHostel(`Expired PG ${randomUUID().slice(0, 5)}`);
  const staff = await factory.createUser({ profile: { role: "staff", hostel_id: hostel.id } });
  await admin.from("rooms").insert({
    hostel_id: hostel.id,
    room_number: "101",
    floor: 1,
    sharing_type: "double",
    capacity: 2,
  });
  await admin
    .from("subscriptions")
    .update({ trial_ends_at: new Date(Date.now() - 60_000).toISOString() })
    .eq("owner_id", owner.id);

  await signIn(page, owner.email, TEST_PASSWORD);
  await page.goto("/rooms");
  await expect(inMain(page).getByRole("region", { name: "Account status" })).toContainText(
    "The free trial has ended, so this account is read-only",
  );
  await expect(inMain(page).getByRole("link", { name: "101", exact: true })).toBeVisible();

  await page.goto("/rooms/new");
  await page.getByLabel(/^Room number/).fill("102");
  await page.getByLabel(/^Floor/).fill("1");
  await page.getByLabel(/^Sharing type/).selectOption("single");
  await page.getByRole("button", { name: "Create room" }).click();
  await expect(
    inMain(page).getByText(/Your account is read-only until its subscription is paid/),
  ).toBeVisible();

  // Staff see why, and who can fix it; billing is not theirs.
  const staffContext = await browser.newContext();
  const staffPage = await staffContext.newPage();
  await signIn(staffPage, staff.email, TEST_PASSWORD);
  await staffPage.goto("/rooms");
  await expect(inMain(staffPage).getByText("Ask the owner to sort out billing.")).toBeVisible();
  await staffPage.goto("/settings/hostel");
  await expect(inMain(staffPage).getByRole("link", { name: "Billing" })).toHaveCount(0);
  await staffContext.close();
});

test("an owner opens a GST invoice issued for a gateway payment", async ({ page }) => {
  const { owner } = await ownerWithHostel(`Paid PG ${randomUUID().slice(0, 5)}`);
  await owner.client.from("billing_profiles").insert({
    legal_name: "Paid PG Pvt Ltd",
    address: "4 Residency Road, Bengaluru",
    state_code: "29",
  });
  const { data: checkout } = await owner.client.rpc("billing_prepare_checkout", {
    p_plan_code: "starter",
    p_interval: "month",
  });
  const gatewaySub = `sub_${randomUUID().slice(0, 14)}`;
  await admin.rpc("billing_attach_checkout", {
    p_subscription_id: (checkout as { subscription_id: string }).subscription_id,
    p_gateway_subscription_id: gatewaySub,
    p_gateway_customer_id: "cust_e2e",
    p_gateway_plan_id: "plan_e2e",
  });
  const start = new Date();
  const end = new Date(start.getTime() + 30 * 86_400_000);
  await admin.rpc("billing_apply_gateway_event", {
    p_event_id: `evt_${randomUUID()}`,
    p_event_type: "subscription.charged",
    p_kind: "charged",
    p_data: {
      subscription_id: gatewaySub,
      current_start: start.toISOString(),
      current_end: end.toISOString(),
      payment: { id: `pay_${randomUUID().slice(0, 14)}`, amount: 117882 },
    },
  });

  await signIn(page, owner.email, TEST_PASSWORD);
  await page.goto("/settings/billing");
  await expect(inMain(page).getByText("Active", { exact: true })).toBeVisible();
  await expect(inMain(page).getByText(/Next charge ₹1,178.82 including GST/)).toBeVisible();
  await expect(inMain(page).getByRole("button", { name: "Cancel plan" })).toBeVisible();
  await inMain(page)
    .getByRole("link", { name: /View or download HE\// })
    .click();
  await expect(inMain(page).getByText("Tax invoice")).toBeVisible();
  await expect(inMain(page).getByText("Paid PG Pvt Ltd")).toBeVisible();
  await expect(inMain(page).getByText("CGST at 9%")).toBeVisible();
  await expect(inMain(page).getByText("₹1,178.82")).toBeVisible();
  await expectAccessible(page);
});

test("an admin extends an owner's trial with a reason and manages plans and coupons", async ({
  page,
}) => {
  test.setTimeout(120_000);
  const { owner } = await ownerWithHostel(`Support PG ${randomUUID().slice(0, 5)}`);
  await admin
    .from("subscriptions")
    .update({ trial_ends_at: new Date(Date.now() - 60_000).toISOString() })
    .eq("owner_id", owner.id);
  const platformAdmin = await factory.createUser({ profile: { role: "platform_admin" } });

  await signIn(page, platformAdmin.email, TEST_PASSWORD);
  await page.goto("/admin");
  await expect(page).toHaveURL(/\/admin\/mfa$/);
  const secret = (await inMain(page).locator("span.font-mono").innerText()).trim();
  const left = 30 - (Math.floor(Date.now() / 1000) % 30);
  if (left < 5) await page.waitForTimeout((left + 1) * 1000);
  await inMain(page).getByLabel(/^Code/).fill(totp(secret));
  await inMain(page).getByRole("button", { name: "Verify" }).click();
  await expect(inMain(page).getByRole("heading", { name: "Subscription revenue" })).toBeVisible();

  await page.goto(`/admin/customers/${owner.id}`);
  await expect(inMain(page).getByRole("heading", { name: "Plan and billing" })).toBeVisible();
  await expect(inMain(page).getByText("Read-only", { exact: true })).toBeVisible();
  await inMain(page).getByRole("button", { name: "Extend trial" }).click();
  const dialog = page.getByRole("dialog", { name: "Extend the free trial" });
  await dialog.getByLabel(/^Days to add/).fill("10");
  await dialog.getByLabel(/^Reason/).fill("Owner was unwell during the trial");
  await dialog.getByRole("button", { name: "Extend trial" }).click();
  await expect(inMain(page).getByText("Trial extended.")).toBeVisible();
  await page.reload();
  await expect(inMain(page).getByText("Owner was unwell during the trial").first()).toBeVisible();
  await expectAccessible(page);

  await page.goto("/admin/billing");
  await expect(inMain(page).getByRole("cell", { name: /Starter/ })).toBeVisible();
  await inMain(page).getByRole("button", { name: "Add coupon" }).click();
  const coupon = page.getByRole("dialog", { name: "Add a coupon" });
  const code = `E2E${randomUUID().slice(0, 5).toUpperCase()}`;
  await coupon.getByLabel(/^Code/).fill(code);
  await coupon.getByLabel(/^Percent off/).fill("20");
  await coupon.getByRole("button", { name: "Create coupon" }).click();
  await expect(inMain(page).getByText(`Coupon ${code} created.`)).toBeVisible();
  await expect(inMain(page).getByRole("cell", { name: code, exact: true })).toBeVisible();
  await expectAccessible(page);
});
