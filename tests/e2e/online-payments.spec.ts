import { randomBytes, randomUUID } from "node:crypto";

import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

import { signRazorpayBody } from "@/lib/billing/razorpay-webhook";
import { seal } from "@/lib/crypto/secret-box";

import { feeFixtures, monthStart } from "../support/fees";
import { createUserFactory, TEST_PASSWORD, type TestUser } from "../support/supabase";
import { inMain, signIn } from "./helpers";

/**
 * Online rent collection end to end (E13-T10), without a real gateway: the
 * hostel's account is stored as the app stores it, and Razorpay's webhooks
 * are replayed, signed with the hostel's secret, against the running app.
 */
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

function encryptionKey(): string {
  const key = process.env.PAYMENT_KEYS_ENCRYPTION_KEY;
  if (!key) throw new Error("Run `npm run env:local` to set PAYMENT_KEYS_ENCRYPTION_KEY");
  return key;
}

test("a resident pays a rent link online and the webhook records it once", async ({
  page,
  request,
}) => {
  const owner: TestUser = await factory.createUser({ fullName: "Online Rent Owner" });
  const hostel = await factory.createHostel(owner.id, {
    name: `Online PG ${randomUUID().slice(0, 5)}`,
  });
  const fees = feeFixtures(admin, () => owner);
  const residentId = await fees.billedResident(hostel.id, 900000);
  await fees.generate(hostel.id, monthStart(-1));
  const invoice = (await fees.invoiceFor(residentId, monthStart(-1)))!;

  // Connected as the app connects it: secrets sealed with the server key.
  const webhookSecret = `whsec_${randomBytes(12).toString("hex")}`;
  const token = randomBytes(16).toString("hex");
  const { error: connectError } = await admin.from("payment_gateway_accounts").insert({
    hostel_id: hostel.id,
    key_id: "rzp_test_E2EKEY123456",
    key_secret_encrypted: seal("not-a-real-secret", encryptionKey()),
    webhook_secret_encrypted: seal(webhookSecret, encryptionKey()),
    webhook_token: token,
  });
  expect(connectError).toBeNull();
  const linkId = `plink_${randomUUID().slice(0, 12)}`;
  await admin.from("payment_links").insert({
    hostel_id: hostel.id,
    invoice_id: invoice.id,
    resident_id: residentId,
    amount: 900000,
    gateway_link_id: linkId,
    short_url: `https://rzp.io/i/${linkId}`,
    expires_at: new Date(Date.now() + 7 * 86_400_000).toISOString(),
  });

  await signIn(page, owner.email, TEST_PASSWORD);
  await page.goto("/settings/payments");
  await expect(inMain(page).getByText("rzp_test_E2EKEY123456")).toBeVisible();
  await expect(inMain(page).getByText(`/api/webhooks/payments/${token}`)).toBeVisible();
  await expectAccessible(page);

  await page.goto(`/fees/${invoice.id}`);
  await expect(inMain(page).getByRole("heading", { name: "Pay online" })).toBeVisible();
  await expect(
    inMain(page).getByRole("img", { name: `QR code to pay ${invoice.number}` }),
  ).toBeVisible();
  await expect(inMain(page).getByText(`https://rzp.io/i/${linkId}`)).toBeVisible();
  await expect(inMain(page).getByRole("link", { name: "Send on WhatsApp" })).toBeVisible();
  await expectAccessible(page);

  const paymentId = `pay_${randomUUID().slice(0, 12)}`;
  const body = JSON.stringify({
    entity: "event",
    event: "payment_link.paid",
    payload: {
      payment_link: { entity: { id: linkId, status: "paid" } },
      payment: {
        entity: {
          id: paymentId,
          amount: 900000,
          fee: 18000,
          tax: 3240,
          method: "upi",
          status: "captured",
        },
      },
    },
  });
  const url = `/api/webhooks/payments/${token}`;
  const eventId = `evt${randomUUID().replaceAll("-", "").slice(0, 14)}`;

  const forged = await request.post(url, {
    data: body,
    headers: {
      "content-type": "application/json",
      "x-razorpay-signature": signRazorpayBody(body, "someone-elses-secret"),
      "x-razorpay-event-id": eventId,
    },
  });
  expect(forged.status()).toBe(401);

  const headers = {
    "content-type": "application/json",
    "x-razorpay-signature": signRazorpayBody(body, webhookSecret),
    "x-razorpay-event-id": eventId,
  };
  const first = await request.post(url, { data: body, headers });
  expect(first.status()).toBe(200);
  expect(await first.json()).toEqual({ result: "applied" });
  const replay = await request.post(url, { data: body, headers });
  expect(await replay.json()).toEqual({ result: "duplicate" });

  await page.reload();
  await expect(inMain(page).getByText("Online (gateway)")).toBeVisible();
  await expect(inMain(page).getByRole("heading", { name: "Pay online" })).toHaveCount(0);

  await page.goto("/fees/online");
  await expect(inMain(page).getByRole("cell", { name: paymentId })).toBeVisible();
  await expect(inMain(page).getByText("₹32.40 of it GST")).toBeVisible();
  await expectAccessible(page);
});

test("an owner sees why keys are refused before anything is stored", async ({ page }) => {
  const owner = await factory.createUser();
  await factory.createHostel(owner.id);
  await signIn(page, owner.email, TEST_PASSWORD);
  await page.goto("/settings/payments");
  await expect(inMain(page).getByText("Online payments are not connected.")).toBeVisible();
  await page.getByLabel(/^Key id/).fill("not-a-key");
  await page.getByLabel(/^Key secret/).fill("short");
  await page.getByRole("button", { name: "Connect Razorpay" }).click();
  await expect(inMain(page).getByText("Key id starts with rzp_test_ or rzp_live_")).toBeVisible();
  await expect(inMain(page).getByText("Paste the key secret")).toBeVisible();
  await expect(
    inMain(page).getByText("Use a webhook secret of at least 8 characters"),
  ).toBeVisible();
});
