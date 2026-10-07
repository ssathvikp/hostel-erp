import { randomUUID } from "node:crypto";

import { expect, test, type Page } from "@playwright/test";

import { confirmLink, waitForEmail } from "../support/mail";
import { adminClient, createUserFactory } from "../support/supabase";

const PASSWORD = "Hostel2026";

// Next.js renders its own role="alert" route announcer; page messages are
// always looked up inside <main>.
const factory = createUserFactory();
const signedUpEmails: string[] = [];

test.afterAll(async () => {
  await factory.cleanup();
  // Users created through the signup form are found by email.
  const admin = adminClient();
  const { data } = await admin.auth.admin.listUsers({ perPage: 1000 });
  await Promise.all(
    (data?.users ?? [])
      .filter((user) => user.email && signedUpEmails.includes(user.email))
      .map((user) => admin.auth.admin.deleteUser(user.id)),
  );
});

async function signOut(page: Page) {
  const openNav = page.getByRole("button", { name: "Open navigation" });
  if (await openNav.isVisible()) await openNav.click();
  await page.getByRole("button", { name: "Sign out" }).click();
  await expect(page).toHaveURL(/\/login$/);
}

async function signIn(page: Page, email: string, password: string) {
  await page.getByLabel("Email").fill(email);
  await page.getByLabel(/^Password/).fill(password);
  await page.getByRole("button", { name: "Sign in" }).click();
}

test("an owner signs up, confirms by email, signs out and signs back in", async ({ page }) => {
  const email = `e2e-${randomUUID()}@example.com`;
  signedUpEmails.push(email);

  await page.goto("/signup");
  await page.getByLabel("Your name").fill("Lakshmi Menon");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(PASSWORD);
  await page.getByRole("button", { name: "Create account" }).click();

  await expect(page.getByRole("main").getByRole("status")).toContainText("Check your email");
  await expect(page.getByRole("main").getByRole("status")).toContainText(email);

  const link = confirmLink((await waitForEmail(email, "Confirm your Hostel ERP account")).html);
  await page.goto(link.url.toString());

  await expect(page).toHaveURL(/\/onboarding$/);
  await expect(page.getByRole("heading", { name: "Set up your hostel" })).toBeVisible();

  await signOut(page);

  // A protected deep link survives the trip through sign-in.
  await page.goto("/onboarding?step=1");
  await expect(page).toHaveURL(/\/login\?next=%2Fonboarding%3Fstep%3D1$/);
  await signIn(page, email, PASSWORD);
  await expect(page).toHaveURL(/\/onboarding\?step=1$/);

  // Signed-in users are sent away from the sign-in page.
  await page.goto("/login");
  await expect(page).toHaveURL(/\/dashboard$/);
  await expect(page.getByRole("heading", { name: "Welcome, Lakshmi" })).toBeVisible();
});

test("a wrong password shows one generic error and keeps the email", async ({ page }) => {
  const user = await factory.createUser();

  await page.goto("/login");
  await signIn(page, user.email, "Not-the-passw0rd");

  await expect(page.getByRole("main").getByRole("alert")).toHaveText(
    "Incorrect email or password.",
  );
  await expect(page.getByLabel("Email")).toHaveValue(user.email);
  await expect(page).toHaveURL(/\/login/);
});

test("signup validation errors appear next to their fields", async ({ page }) => {
  await page.goto("/signup");
  await page.getByLabel("Email").fill("not-an-email");
  await page.getByLabel("Password").fill("short");
  await page.getByRole("button", { name: "Create account" }).click();

  await expect(page.getByText("Your name is required")).toBeVisible();
  await expect(page.getByText("Enter a valid email address")).toBeVisible();
  await expect(page.getByText("Use at least 8 characters")).toBeVisible();
  await expect(page.getByLabel("Email")).toHaveValue("not-an-email");
});

test("an owner resets a forgotten password from the emailed link", async ({ page }) => {
  const user = await factory.createUser({ fullName: "Farah Khan" });

  await page.goto("/login");
  await page.getByRole("link", { name: "Forgot password?" }).click();
  await expect(page).toHaveURL(/\/forgot-password$/);
  await page.getByLabel("Email").fill(user.email);
  await page.getByRole("button", { name: "Send reset link" }).click();
  await expect(page.getByRole("main").getByRole("status")).toContainText("If an account exists");

  const link = confirmLink((await waitForEmail(user.email, "Reset your Hostel ERP password")).html);
  await page.goto(link.url.toString());
  await expect(page).toHaveURL(/\/reset-password$/);

  await page.getByLabel(/^New password/).fill("Fresh-start-2026");
  await page.getByLabel(/^Confirm new password/).fill("Fresh-start-2026");
  await page.getByRole("button", { name: "Save new password" }).click();
  await expect(page).toHaveURL(/\/dashboard$/);

  await signOut(page);
  await signIn(page, user.email, "Fresh-start-2026");
  await expect(page).toHaveURL(/\/dashboard$/);

  // The same link cannot be used twice.
  await signOut(page);
  await page.goto(link.url.toString());
  await expect(page).toHaveURL(/\/forgot-password\?error=link_invalid$/);
  await expect(page.getByRole("main").getByRole("alert")).toContainText(
    "expired or was already used",
  );
});
