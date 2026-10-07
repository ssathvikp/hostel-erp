import { expect, type Page } from "@playwright/test";

// Next.js renders its own role="alert" route announcer, so page messages are
// always looked up inside <main>.
export const inMain = (page: Page) => page.getByRole("main");

/** Submits the sign-in form; waits until the app has moved past /login. */
export async function signIn(page: Page, email: string, password: string) {
  await submitSignIn(page, email, password);
  await page.waitForURL((url) => !url.pathname.startsWith("/login"));
}

/** Submits the sign-in form without waiting, for tests that expect it to fail. */
export async function submitSignIn(page: Page, email: string, password: string) {
  if (!page.url().includes("/login")) await page.goto("/login");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel(/^Password/).fill(password);
  await page.getByRole("button", { name: "Sign in" }).click();
}

export async function signOut(page: Page) {
  const openNav = page.getByRole("button", { name: "Open navigation" });
  if (await openNav.isVisible()) await openNav.click();
  await page.getByRole("button", { name: "Sign out" }).click();
  await expect(page).toHaveURL(/\/login$/);
}

/** The hostel panel lives in the sidebar, or the drawer on small screens. */
export async function openNavigation(page: Page) {
  const openNav = page.getByRole("button", { name: "Open navigation" });
  if (await openNav.isVisible()) await openNav.click();
}
