import { expect, test } from "@playwright/test";

import { createUserFactory, TEST_PASSWORD } from "../support/supabase";
import { inMain, signIn } from "./helpers";

/** Complaints, workers and job links in a real browser (EP-15). */
const factory = createUserFactory();

test.afterAll(async () => {
  await factory.cleanup();
});

test("a complaint reaches the right worker, who finishes it from a job link", async ({
  page,
  browser,
}) => {
  test.setTimeout(90_000);
  const owner = await factory.createUser({ fullName: "Divya Rao" });
  const hostel = await factory.createHostel(owner.id, { name: "Fix It PG" });
  await factory.admin.from("rooms").insert({
    hostel_id: hostel.id,
    room_number: "12",
    floor: 1,
    sharing_type: "double",
    capacity: 2,
  });
  await signIn(page, owner.email, TEST_PASSWORD);

  // The owner adds their plumber.
  await page.goto("/settings/workers");
  await expect(inMain(page).getByText("No workers yet")).toBeVisible();
  await inMain(page).getByRole("button", { name: "Add worker" }).click();
  const dialog = page.getByRole("dialog", { name: "Add a worker" });
  await dialog.getByLabel(/^Name/).fill("Salim");
  await dialog.getByLabel(/^Mobile/).fill("98450 11122");
  await dialog.getByRole("checkbox", { name: "Plumber" }).first().check();
  await dialog.getByRole("button", { name: "Save" }).click();
  await expect(inMain(page).getByText("Salim", { exact: true })).toBeVisible();

  // A complaint without a room or area is refused; with one, it is routed.
  await page.goto("/complaints/new");
  await page.getByLabel(/^What is wrong/).fill("Tap dripping all night");
  await page.getByLabel(/^Category/).selectOption({ label: "Plumbing" });
  await page.getByRole("button", { name: "Raise complaint" }).click();
  await expect(inMain(page).getByText("Choose the room, or name the common area")).toBeVisible();
  await expect(page.getByLabel(/^What is wrong/)).toHaveValue("Tap dripping all night");
  await page.getByLabel(/^Room/).selectOption({ label: "Room 12" });
  await page.getByRole("button", { name: "Raise complaint" }).click();

  await expect(page).toHaveURL(/\/complaints\/[0-9a-f-]+\?raised=1$/);
  await expect(inMain(page).getByText("Complaint raised. It went to Salim.")).toBeVisible();

  // A job link for the vendor, shown once.
  await inMain(page).getByRole("button", { name: "Create job link" }).click();
  const link = await inMain(page).getByRole("textbox", { name: "Job link" }).inputValue();
  expect(link).toMatch(/\/job\/[0-9a-f]{48}$/);

  // The worker has no account: a fresh browser with no session.
  const worker = await browser.newContext();
  const job = await worker.newPage();
  await job.goto(link);
  await expect(job.getByRole("heading", { name: /Tap dripping all night/ })).toBeVisible();
  await expect(job.getByText("Room 12")).toBeVisible();
  await job.getByRole("button", { name: "Accept job" }).click();
  await expect(job.getByText("The hostel knows you have taken the job.")).toBeVisible();
  await job.getByRole("button", { name: "Work is done" }).click();
  await job.getByLabel(/^What did you do/).fill("Changed the washer");
  await job.getByLabel(/^Your charge/).fill("350");
  await job.getByRole("button", { name: "Mark done" }).click();
  await expect(job.getByText("This job is marked done. Thank you.")).toBeVisible();

  // A made-up link shows nothing about any job.
  await job.goto(link.replace(/[0-9a-f]{48}$/, "0".repeat(48)));
  await expect(job.getByRole("heading", { name: "This link no longer works" })).toBeVisible();
  await worker.close();

  // The owner sees the outcome, the worker's charge and the history.
  await page.reload();
  await expect(inMain(page).getByText("Resolved", { exact: true }).first()).toBeVisible();
  await expect(inMain(page).getByText("₹350").first()).toBeVisible();
  await expect(inMain(page).getByText("Changed the washer")).toBeVisible();

  // Reopening needs a reason.
  await inMain(page).getByRole("button", { name: "Reopen" }).click();
  const reopen = page.getByRole("dialog", { name: "Reopen" });
  await reopen.getByRole("button", { name: "Reopen" }).click();
  await expect(reopen.getByText("Give a reason.")).toBeVisible();
  await reopen.getByLabel(/^Why reopen it/).fill("Dripping again");
  await reopen.getByRole("button", { name: "Reopen" }).click();
  await expect(inMain(page).getByText("Reopened", { exact: true }).first()).toBeVisible();
});

test("staff raise and follow complaints but cannot change workers", async ({ page }) => {
  const owner = await factory.createUser();
  const hostel = await factory.createHostel(owner.id, { name: "Warden PG" });
  const staff = await factory.createUser({ profile: { role: "staff", hostel_id: hostel.id } });
  await signIn(page, staff.email, TEST_PASSWORD);

  await page.goto("/complaints/new");
  await page.getByLabel(/^What is wrong/).fill("Corridor light fused");
  await page.getByLabel(/^Category/).selectOption({ label: "Electrical" });
  await page.getByRole("radio", { name: "A common area" }).check();
  await page.getByLabel(/^Common area/).fill("First floor corridor");
  await page.getByRole("button", { name: "Raise complaint" }).click();
  await expect(
    inMain(page).getByText("Nobody was available for it, so assign a worker below."),
  ).toBeVisible();
  await expect(inMain(page).getByRole("button", { name: "Edit costs" })).toHaveCount(0);

  await page.goto("/complaints");
  await expect(inMain(page).getByRole("link", { name: "Corridor light fused" })).toBeVisible();
  await expect(inMain(page).getByText("Needs a worker")).toBeVisible();

  await page.goto("/settings/workers");
  await expect(inMain(page).getByText("Only the owner can add or change workers.")).toBeVisible();
  await expect(inMain(page).getByRole("button", { name: "Add worker" })).toHaveCount(0);
});

test("an owner sets targets, routing and preventive maintenance", async ({ page }) => {
  test.setTimeout(60_000);
  const owner = await factory.createUser();
  await factory.createHostel(owner.id, { name: "Settings PG" });
  await signIn(page, owner.email, TEST_PASSWORD);

  await page.goto("/settings/complaints");
  const urgent = inMain(page)
    .locator("form")
    .filter({ has: page.getByText("Urgent") });
  await urgent.getByLabel(/^Respond within/).fill("1.5");
  await urgent.getByLabel(/^Fix within/).fill("12");
  await urgent.getByRole("button", { name: "Save" }).click();
  await expect(inMain(page).getByRole("button", { name: "Use the default" })).toBeVisible();
  await page.reload();
  await expect(urgent.getByLabel(/^Respond within/)).toHaveValue("1.5");

  await inMain(page).getByRole("button", { name: "Assign by hand: Internet" }).click();
  await expect(
    inMain(page).getByRole("button", { name: "Route automatically: Internet" }),
  ).toBeVisible();

  await page.goto("/complaints/maintenance");
  await inMain(page).getByRole("button", { name: "Add task" }).click();
  const dialog = page.getByRole("dialog", { name: "Add a recurring task" });
  await dialog.getByLabel(/^Task/).fill("Fire extinguisher check");
  await dialog.getByLabel(/^Category/).selectOption({ label: "Security" });
  await dialog.getByLabel(/^Common area/).fill("Ground floor");
  await dialog.getByRole("button", { name: "Save" }).click();
  await expect(inMain(page).getByText("Fire extinguisher check")).toBeVisible();

  // It is due today, so running the schedule now creates the job.
  await inMain(page).getByRole("button", { name: "Create due jobs now" }).click();
  await expect(inMain(page).getByText("1 job was created and routed.")).toBeVisible();
  await page.goto("/complaints");
  await expect(inMain(page).getByRole("link", { name: "Fire extinguisher check" })).toBeVisible();
});
