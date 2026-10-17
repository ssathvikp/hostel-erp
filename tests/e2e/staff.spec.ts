import { randomUUID } from "node:crypto";

import { expect, test } from "@playwright/test";

import { confirmLink, waitForEmail } from "../support/mail";
import { adminClient, createUserFactory, TEST_PASSWORD } from "../support/supabase";
import { inMain, signIn } from "./helpers";

/** Staff invitation, acceptance and removal in a real browser (EP-12). */
const factory = createUserFactory();
const invitedEmails: string[] = [];

test.afterAll(async () => {
  // Invited accounts are created by the app, so they are found by email and
  // removed before the factory deletes the hostels they belong to.
  const admin = adminClient();
  const { data } = await admin.auth.admin.listUsers({ perPage: 1000 });
  await Promise.all(
    (data?.users ?? [])
      .filter((user) => user.email && invitedEmails.includes(user.email))
      .map((user) => admin.auth.admin.deleteUser(user.id)),
  );
  await factory.cleanup();
});

test("an owner invites a warden, who accepts, works, and is later removed", async ({
  page,
  browser,
}) => {
  // Two browsers and an email round trip.
  test.slow();
  const owner = await factory.createUser({ fullName: "Anita Rao" });
  const hostel = await factory.createHostel(owner.id, {
    name: `Lotus PG ${randomUUID().slice(0, 4)}`,
  });
  const email = `warden-${randomUUID()}@example.com`;
  invitedEmails.push(email);

  await signIn(page, owner.email, TEST_PASSWORD);
  await page.goto("/settings/staff");
  await expect(page.getByRole("heading", { name: "Staff", level: 1 })).toBeVisible();

  // Server-side validation keeps what was typed.
  await page.getByLabel(/^Name/).fill("Ramesh Gupta");
  await page.getByLabel(/^Email/).fill("not-an-email");
  await page.getByRole("button", { name: "Send invitation", exact: true }).click();
  await expect(inMain(page).getByText("Enter a valid email address")).toBeVisible();
  await expect(page.getByLabel(/^Name/)).toHaveValue("Ramesh Gupta");

  await page.getByLabel(/^Email/).fill(email);
  await page.getByRole("button", { name: "Send invitation", exact: true }).click();
  await expect(inMain(page).getByText(`Invitation sent to ${email}`)).toBeVisible();
  const row = inMain(page).getByRole("row", { name: /Ramesh Gupta/ });
  await expect(row.getByText("Invited")).toBeVisible();

  // Inviting the same address again is refused.
  await page.getByLabel(/^Name/).fill("Ramesh Gupta");
  await page.getByLabel(/^Email/).fill(email);
  await page.getByRole("button", { name: "Send invitation", exact: true }).click();
  await expect(
    inMain(page).getByText("This person is already invited.", { exact: false }),
  ).toBeVisible();

  // The warden opens the email in their own browser and chooses a password.
  const mail = await waitForEmail(email, "You have been invited to Hostel ERP");
  expect(mail.html).toContain(hostel.name);
  const link = confirmLink(mail.html);
  expect(link.type).toBe("invite");

  const wardenContext = await browser.newContext();
  const warden = await wardenContext.newPage();
  await warden.goto(link.url.toString());
  await expect(warden).toHaveURL(/\/welcome$/);
  await expect(warden.getByRole("heading", { name: "Welcome, Ramesh Gupta" })).toBeVisible();
  await warden.getByLabel(/^Password/).fill("Warden2026");
  await warden.getByLabel("Confirm password").fill("Warden2026");
  await warden.getByRole("button", { name: "Accept and continue" }).click();
  await expect(warden).toHaveURL(/\/dashboard$/);

  // Staff see no Staff tab and cannot open the page's controls.
  await warden.goto("/settings/staff");
  await expect(warden.getByText("Only the hostel owner can manage staff.")).toBeVisible();
  await expect(warden.getByRole("link", { name: "Staff" })).toHaveCount(0);

  // The owner sees the warden as active, then removes them.
  await page.reload();
  await expect(row.getByText("Active")).toBeVisible();
  await row.getByRole("button", { name: /Remove/ }).click();
  await page.getByRole("button", { name: "Remove access" }).click();
  await expect(
    inMain(page).getByText(`Ramesh Gupta no longer has access to ${hostel.name}.`),
  ).toBeVisible();
  await expect(row.getByText("Removed")).toBeVisible();

  // The warden's session ends at once, and signing in again is refused.
  await warden.goto("/dashboard");
  await expect(warden).toHaveURL(/\/login/);
  await warden.getByLabel("Email").fill(email);
  await warden.getByLabel(/^Password/).fill("Warden2026");
  await warden.getByRole("button", { name: "Sign in" }).click();
  await expect(
    warden.getByText("This account no longer has access.", { exact: false }),
  ).toBeVisible();
  await wardenContext.close();
});

test("a pending invitation can be resent or cancelled", async ({ page }) => {
  const owner = await factory.createUser({ fullName: "Kiran Shah" });
  await factory.createHostel(owner.id);
  const email = `cook-${randomUUID()}@example.com`;
  invitedEmails.push(email);

  await signIn(page, owner.email, TEST_PASSWORD);
  await page.goto("/settings/staff");
  await page.getByLabel(/^Name/).fill("Meena Devi");
  await page.getByLabel(/^Email/).fill(email);
  await page.getByRole("button", { name: "Send invitation", exact: true }).click();
  await expect(inMain(page).getByText(`Invitation sent to ${email}`)).toBeVisible();

  const first = confirmLink((await waitForEmail(email, "You have been invited")).html);
  await page.getByRole("button", { name: "Resend invitation to Meena Devi" }).click();
  await expect(inMain(page).getByText("Invitation sent again.")).toBeVisible();

  // The first link stops working once a new one is sent.
  await expect
    .poll(
      async () => confirmLink((await waitForEmail(email, "You have been invited")).html).tokenHash,
    )
    .not.toBe(first.tokenHash);

  await page.getByRole("button", { name: "Cancel invitation to Meena Devi" }).click();
  await expect(inMain(page).getByText("Invitation cancelled.")).toBeVisible();
  await expect(
    inMain(page)
      .getByRole("row", { name: /Meena Devi/ })
      .getByText("Removed"),
  ).toBeVisible();
});
