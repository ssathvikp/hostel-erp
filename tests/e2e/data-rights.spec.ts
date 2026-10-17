import { readFile } from "node:fs/promises";

import { expect, test } from "@playwright/test";

import { residentRow } from "../support/residents";
import { createUserFactory, TEST_PASSWORD } from "../support/supabase";
import { inMain, signIn } from "./helpers";

/** Consent, a copy of the data, and erasure (DPDP Act, 2023). */
const factory = createUserFactory();
const { admin } = factory;

test.afterAll(factory.cleanup);

test("an owner records consent, exports a former resident's data and erases it", async ({
  page,
}) => {
  const owner = await factory.createUser({ fullName: "Revathi Menon" });
  const hostel = await factory.createHostel(owner.id);
  const { data: resident } = await admin
    .from("residents")
    .insert(
      residentRow(hostel.id, {
        full_name: "Imran Qureshi",
        email: "imran@example.com",
        status: "vacated",
      }),
    )
    .select("id, phone")
    .single();
  await signIn(page, owner.email, TEST_PASSWORD);
  await page.goto(`/residents/${resident!.id}`);
  const privacy = inMain(page).getByRole("region", { name: "Data and privacy" });

  await expect(privacy.getByText("Not recorded.", { exact: false })).toBeVisible();
  await privacy.getByRole("button", { name: "Record consent" }).click();
  await expect(privacy.getByText(/^Agreed to their details being kept, recorded/)).toBeVisible();

  const downloading = page.waitForEvent("download");
  await privacy.getByRole("link", { name: "Download data" }).click();
  const download = await downloading;
  expect(download.suggestedFilename()).toBe("resident-imran-qureshi.json");
  const exported = JSON.parse(await readFile((await download.path())!, "utf8"));
  expect(exported.resident).toMatchObject({
    full_name: "Imran Qureshi",
    email: "imran@example.com",
  });
  expect(exported.resident.id_proof_hash).toBeUndefined();
  expect(exported.data_fiduciary.name).toBe(hostel.name);

  await privacy.getByRole("button", { name: "Erase personal details" }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByRole("button", { name: "Erase for good" }).click();
  await expect(dialog.getByText("Reason is required")).toBeVisible();
  await dialog.getByLabel(/^Reason/).fill("Asked by the resident by email");
  await dialog.getByRole("button", { name: "Erase for good" }).click();

  await expect(
    inMain(page).getByText("This resident's personal details were erased"),
  ).toBeVisible();
  await expect(page.getByRole("heading", { name: /^Erased resident [0-9A-F]{6}$/ })).toBeVisible();
  await expect(inMain(page).getByText("imran@example.com")).toHaveCount(0);
  await expect(inMain(page).getByRole("link", { name: "Edit details" })).toHaveCount(0);

  const { data: log } = await admin
    .from("data_rights_log")
    .select("action")
    .eq("resident_id", resident!.id)
    .order("done_at");
  expect(log?.map((row) => row.action)).toEqual(["export", "erase"]);
});

test("erasing waits until the resident has left, and staff cannot export or erase", async ({
  page,
}) => {
  const owner = await factory.createUser({ fullName: "Owner Two" });
  const hostel = await factory.createHostel(owner.id);
  const { data: resident } = await admin
    .from("residents")
    .insert(residentRow(hostel.id, { full_name: "Still Here" }))
    .select("id")
    .single();

  await signIn(page, owner.email, TEST_PASSWORD);
  await page.goto(`/residents/${resident!.id}`);
  const privacy = inMain(page).getByRole("region", { name: "Data and privacy" });
  await expect(privacy.getByText("Mark them vacated once they have left.")).toBeVisible();
  await expect(privacy.getByRole("button", { name: "Erase personal details" })).toHaveCount(0);

  const staff = await factory.createUser({
    fullName: "Privacy Staff",
    profile: { role: "staff", hostel_id: hostel.id },
  });
  await page.context().clearCookies();
  await signIn(page, staff.email, TEST_PASSWORD);
  await page.goto(`/residents/${resident!.id}`);
  await expect(privacy.getByRole("button", { name: "Record consent" })).toBeVisible();
  await expect(privacy.getByRole("link", { name: "Download data" })).toHaveCount(0);
  const response = await page.request.get(`/residents/${resident!.id}/export`);
  expect(response.status()).toBe(403);
});

test("an erased resident's old invoices show no phone links", async ({ page }) => {
  const owner = await factory.createUser({ fullName: "History Owner" });
  const hostel = await factory.createHostel(owner.id);
  const { data: resident } = await admin
    .from("residents")
    .insert(residentRow(hostel.id, { status: "vacated" }))
    .select("id")
    .single();
  const { data: invoice } = await admin
    .from("invoices")
    .insert({
      hostel_id: hostel.id,
      resident_id: resident!.id,
      period_month: "2026-06-01",
      amount: 500000,
      due_date: "2026-06-05",
      breakdown: [],
    })
    .select("id")
    .single();
  await admin.from("payments").insert({
    hostel_id: hostel.id,
    invoice_id: invoice!.id,
    amount: 500000,
    paid_at: "2026-06-03",
    mode: "cash",
    recorded_by: owner.id,
  });
  await owner.client.rpc("erase_resident", { p_resident_id: resident!.id, p_reason: "Asked" });

  await signIn(page, owner.email, TEST_PASSWORD);
  await page.goto("/fees");
  await expect(inMain(page).getByRole("link", { name: /^Erased resident/ })).toBeVisible();
  await expect(page.locator('a[href^="tel:"]')).toHaveCount(0);

  await page.goto(`/fees/${invoice!.id}`);
  await expect(page.locator('a[href*="wa.me"]')).toHaveCount(0);
  await expect(inMain(page).getByRole("button", { name: /^Copy receipt/ })).toBeVisible();
});
