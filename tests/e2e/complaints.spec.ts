import { expect, test } from "@playwright/test";

import { createUserFactory, TEST_PASSWORD } from "../support/supabase";
import { inMain, signIn } from "./helpers";

/** Complaints, workers and job links in a real browser (ClickUp EP-15). */
const factory = createUserFactory();
const { admin } = factory;

test.afterAll(factory.cleanup);

// A 1x1 PNG.
const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
);

test("an owner adds a plumber, raises a complaint, and the plumber finishes it from a job link", async ({
  page,
  browser,
}) => {
  test.slow();
  const owner = await factory.createUser();
  const hostel = await factory.createHostel(owner.id);
  await admin.from("rooms").insert({
    hostel_id: hostel.id,
    room_number: "204",
    floor: 2,
    sharing_type: "double",
    capacity: 2,
  });

  await signIn(page, owner.email, TEST_PASSWORD);

  // The plumber, as a shared vendor.
  await page.goto("/settings/workers");
  const add = inMain(page).getByRole("region", { name: "Add a worker" });
  await add.locator("#worker-new-name").fill("Prakash Plumbing");
  await add.locator("#worker-new-phone").fill("9876512345");
  await add.getByLabel("Plumber").check();
  await add.getByRole("button", { name: "Add worker" }).click();
  await expect(add.getByText("Prakash Plumbing added.")).toBeVisible();

  // A complaint, routed to the plumber as it saves.
  await page.goto("/complaints");
  await inMain(page).getByRole("link", { name: "Raise complaint" }).click();
  await page.locator("#complaint-room").selectOption({ label: "Room 204 (floor 2)" });
  await page.locator("#complaint-category").selectOption({ label: "Plumbing" });
  await page.locator("#complaint-priority").selectOption("urgent");
  await page.locator("#complaint-title").fill("Bathroom tap leaking");
  await page.getByRole("button", { name: "Raise complaint" }).click();
  await expect(page.getByText("Complaint raised and assigned to Prakash Plumbing.")).toBeVisible();
  await expect(page.getByRole("heading", { name: "Bathroom tap leaking", level: 1 })).toBeVisible();

  // A photo of the problem.
  await page
    .locator('input[type="file"]')
    .setInputFiles({ name: "tap.png", mimeType: "image/png", buffer: PNG });
  await expect(page.getByText("File added.")).toBeVisible();
  await expect(page.getByRole("img", { name: "Photo of the problem" })).toBeVisible();

  // The job link, opened by the plumber with no account.
  await page.getByRole("button", { name: "Send job link" }).click();
  const link = await page.locator("p.font-mono").filter({ hasText: "/job/" }).textContent();
  expect(link).toContain("/job/");
  await expect(page.getByRole("link", { name: "Send on WhatsApp" })).toHaveAttribute(
    "href",
    /wa\.me\/919876512345/,
  );

  const worker = await browser.newContext();
  const job = await worker.newPage();
  await job.goto(new URL(link!).pathname);
  await expect(job.getByRole("heading", { name: "Bathroom tap leaking" })).toBeVisible();
  await expect(job.getByText("Room 204, floor 2")).toBeVisible();
  await job.getByRole("button", { name: "Accept the job" }).click();
  await expect(job.getByText("The hostel knows you have taken the job.")).toBeVisible();
  await job.getByRole("button", { name: "Finished" }).click();
  await job.getByLabel("What did you do? (optional)").fill("Changed the washer");
  await job.getByLabel("Your charge (₹, optional)").fill("350");
  await job.getByRole("button", { name: "Mark as done" }).click();
  await expect(job.getByText("Marked as done. Thank you.")).toBeVisible();
  await job.reload();
  await expect(job.getByRole("heading", { name: "This job link no longer works" })).toBeVisible();
  await worker.close();

  // Back with the owner: resolved, with the plumber's note and charge.
  await page.reload();
  await expect(inMain(page).getByText("Resolved").first()).toBeVisible();
  await expect(page.getByText("Changed the washer")).toBeVisible();
  await expect(page.getByRole("cell", { name: "₹350" })).toBeVisible();

  await page.goto("/complaints?status=all");
  await expect(inMain(page).getByRole("link", { name: "Bathroom tap leaking" })).toBeVisible();
  await page.goto("/complaints/reports");
  await expect(
    page
      .getByRole("table", { name: "Complaints by category" })
      .getByRole("cell", { name: "Plumbing" }),
  ).toBeVisible();
});

test("staff raise a complaint for a common area and owners see it on the dashboard", async ({
  page,
}) => {
  const owner = await factory.createUser();
  const hostel = await factory.createHostel(owner.id);
  const staff = await factory.createUser({ profile: { role: "staff", hostel_id: hostel.id } });

  await signIn(page, staff.email, TEST_PASSWORD);
  await page.goto("/complaints/new");
  await page.getByLabel("A common area").check();
  await page.locator("#complaint-area").fill("Kitchen");
  await page.locator("#complaint-category").selectOption({ label: "Pest control" });
  await page.locator("#complaint-title").fill("Cockroaches near the sink");
  await page.getByRole("button", { name: "Raise complaint" }).click();
  await expect(page.getByText(/No available worker has the right trade yet/)).toBeVisible();

  await page.goto("/dashboard");
  const card = page.getByRole("region", { name: "Complaints" });
  await expect(card.getByRole("link", { name: /Need a worker\s*1/ })).toBeVisible();
  // Staff cannot change complaint settings.
  await page.goto("/settings/complaints");
  await expect(
    page.getByText("Only the hostel owner can change complaint settings."),
  ).toBeVisible();
});
