import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

import { feeFixtures, monthStart } from "../support/fees";
import { randomMobile } from "../support/residents";
import { createUserFactory, TEST_PASSWORD } from "../support/supabase";
import { inMain, signIn } from "./helpers";

/**
 * A resident reports a problem from their room's QR code and confirms the
 * fix from their status link (E15-T3, T4), in a browser with no session.
 * SMS go to the server log locally (SMS_PROVIDER=log), so the test asks the
 * database for a fresh code the way the app does.
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

test("a resident reports a leak from the room QR code and confirms the fix", async ({
  page,
  browser,
}) => {
  test.setTimeout(120_000);
  const owner = await factory.createUser({ fullName: "QR Owner" });
  const hostel = await factory.createHostel(owner.id, { name: "Lakeview PG" });
  const fees = feeFixtures(admin, () => owner);
  const phone = randomMobile();
  const residentId = await fees.resident(hostel.id, { phone, full_name: "Meera Iyer" });
  const bedId = await fees.bed(hostel.id);
  await fees.stay(hostel.id, residentId, bedId, monthStart(-1));
  const { data: bed } = await admin
    .from("beds")
    .select("room_id, rooms(room_number)")
    .eq("id", bedId)
    .single();
  const roomId = bed!.room_id;

  // The owner makes and prints the room's code.
  await signIn(page, owner.email, TEST_PASSWORD);
  await page.goto(`/rooms/${roomId}`);
  await inMain(page).getByRole("button", { name: "Make a QR code" }).click();
  await expect(
    inMain(page).getByRole("img", { name: /QR code to report a problem in room/ }),
  ).toBeVisible();
  const url = (
    await inMain(page)
      .getByText(/\/r\/[0-9a-f]{32}$/)
      .innerText()
  ).trim();
  const token = url.split("/r/")[1];
  await inMain(page).getByRole("link", { name: "Print code" }).click();
  await expect(inMain(page).getByRole("heading", { name: "Something not working?" })).toBeVisible();

  // The resident, on their own phone with no account.
  const residentContext = await browser.newContext();
  const resident = await residentContext.newPage();
  await resident.goto(`/r/${token}`);
  await expect(resident.getByRole("heading", { name: /Report a problem in room/ })).toBeVisible();
  await expectAccessible(resident);
  await resident.getByLabel(/^Your mobile number/).fill(phone);
  await resident.getByRole("button", { name: "Send code" }).click();
  await expect(
    resident.getByText(/If this number belongs to a resident of this room/),
  ).toBeVisible();
  const { data: issued } = await admin.rpc("resident_request_code", {
    p_token: token,
    p_phone: phone,
  });
  await resident.getByLabel(/^6-digit code/).fill((issued as { code: string }).code);
  await resident.getByRole("button", { name: "Continue" }).click();

  await expect(resident.getByText("Hello Meera. What needs fixing?")).toBeVisible();
  await expectAccessible(resident);
  await resident.getByLabel(/^What is it about/).selectOption({ label: "Plumbing" });
  await resident.getByLabel(/^What is wrong/).fill("The bathroom tap leaks all night");
  await resident.getByRole("button", { name: "Report the problem" }).click();
  await expect(resident.getByRole("status")).toContainText(/Complaint #\d+ is reported/);
  const statusUrl = resident.url().split("?")[0];
  await expect(resident.getByRole("listitem").filter({ hasText: /^Reported/ })).toBeVisible();
  await expectAccessible(resident);

  // Staff fix it; the resident confirms from the same link.
  const { data: complaint } = await admin
    .from("complaints")
    .select("id")
    .eq("resident_id", residentId)
    .single();
  await owner.client.rpc("set_complaint_status", {
    p_complaint_id: complaint!.id,
    p_status: "resolved",
  });
  await resident.goto(statusUrl);
  await resident.getByRole("button", { name: "Yes, it is fixed" }).click();
  await resident.getByLabel("5").check();
  await resident.getByLabel(/^Anything to add/).fill("Fixed the same day");
  await resident.getByRole("button", { name: "Close the complaint" }).click();
  await expect(resident.getByRole("status")).toHaveText("Thank you. The complaint is closed.");
  await residentContext.close();

  await page.goto(`/complaints/${complaint!.id}`);
  await expect(inMain(page).getByText("Rated 5 out of 5")).toBeVisible();
  await expect(inMain(page).getByText("from the room's QR code")).toBeVisible();
});

test("a dead room code and an unknown number reveal nothing", async ({ page }) => {
  await page.goto(`/r/${"0".repeat(32)}`);
  await expect(page.getByRole("heading", { name: "This code no longer works" })).toBeVisible();
  await page.goto(`/c/${"0".repeat(48)}`);
  await expect(page.getByRole("heading", { name: "This link no longer works" })).toBeVisible();

  const owner = await factory.createUser();
  const hostel = await factory.createHostel(owner.id);
  const fees = feeFixtures(admin, () => owner);
  const bedId = await fees.bed(hostel.id);
  const { data: bed } = await admin.from("beds").select("room_id").eq("id", bedId).single();
  const { data: token } = await owner.client.rpc("room_report_token", { p_room_id: bed!.room_id });
  await page.goto(`/r/${token as string}`);
  await page.getByLabel(/^Your mobile number/).fill(randomMobile());
  await page.getByRole("button", { name: "Send code" }).click();
  await expect(page.getByText(/If this number belongs to a resident of this room/)).toBeVisible();
});
