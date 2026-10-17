import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

import { shiftMonth } from "@/lib/money";
import { todayIst } from "@/lib/validation";

import { residentRow } from "../support/residents";
import { createUserFactory, TEST_PASSWORD } from "../support/supabase";
import { signIn } from "./helpers";

/**
 * Automated WCAG 2.1 AA checks (axe-core) on every screen, filled with real
 * data so tables, badges and forms are all on the page when it is scanned.
 */
const factory = createUserFactory();
const { admin } = factory;

test.afterAll(factory.cleanup);

async function expectNoViolations(page: Page, path: string) {
  await page.goto(path);
  await page.waitForLoadState("networkidle");
  const { violations } = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
    .analyze();
  const summary = violations.map((v) => ({
    rule: v.id,
    impact: v.impact,
    help: v.help,
    targets: v.nodes.slice(0, 5).map((n) => n.target.join(" ")),
  }));
  expect.soft(summary, `accessibility violations on ${path}`).toEqual([]);
}

test("signed-out screens", async ({ page }) => {
  for (const path of ["/login", "/signup", "/forgot-password"]) {
    await expectNoViolations(page, path);
  }
});

test("a new owner's onboarding screen", async ({ page }) => {
  const owner = await factory.createUser({ fullName: "Neha Iyer" });
  await signIn(page, owner.email, TEST_PASSWORD);
  await expectNoViolations(page, "/onboarding");
});

test("every signed-in screen with data on it", async ({ page }) => {
  test.setTimeout(120_000);
  const owner = await factory.createUser({ fullName: "Kiran Das" });
  const hostel = await factory.createHostel(owner.id, { name: "Access PG" });
  await factory.createUser({
    fullName: "Access Warden",
    profile: { role: "staff", hostel_id: hostel.id },
  });
  const { data: room } = await admin
    .from("rooms")
    .insert({
      hostel_id: hostel.id,
      room_number: "21",
      floor: 2,
      sharing_type: "double",
      capacity: 2,
    })
    .select("id")
    .single();
  const { data: beds } = await admin.from("beds").select("id").eq("room_id", room!.id);
  const { data: resident } = await admin
    .from("residents")
    .insert(residentRow(hostel.id, { full_name: "Meera Pillai" }))
    .select("id")
    .single();
  await admin.from("allocations").insert({
    hostel_id: hostel.id,
    resident_id: resident!.id,
    bed_id: beds![0].id,
    room_id: room!.id,
    start_date: shiftMonth(todayIst(), -2),
    created_by: owner.id,
  });
  await owner.client.from("deposit_entries").insert({
    hostel_id: hostel.id,
    resident_id: resident!.id,
    kind: "collected",
    amount: 1500000,
    entry_date: todayIst(),
    mode: "upi",
  });
  await owner.client.rpc("set_fee_structure", {
    p_hostel_id: hostel.id,
    p_sharing_type: "double",
    p_monthly_amount: 750000,
    p_effective_from: shiftMonth(todayIst(), -6),
  });
  await owner.client.rpc("generate_invoices", {
    p_hostel_id: hostel.id,
    p_period_month: shiftMonth(todayIst(), -1),
  });
  const { data: invoice } = await admin
    .from("invoices")
    .select("id")
    .eq("resident_id", resident!.id)
    .single();
  const { data: payment } = await owner.client
    .from("payments")
    .insert({
      hostel_id: hostel.id,
      invoice_id: invoice!.id,
      amount: 250000,
      paid_at: todayIst(),
      mode: "cash",
    })
    .select("id")
    .single();

  await signIn(page, owner.email, TEST_PASSWORD);
  for (const path of [
    "/dashboard",
    "/occupancy",
    "/rooms",
    "/rooms/new",
    "/rooms/bulk",
    `/rooms/${room!.id}`,
    `/rooms/${room!.id}/edit`,
    "/residents",
    "/residents/new",
    `/residents/${resident!.id}`,
    `/residents/${resident!.id}/edit`,
    "/fees",
    `/fees/${invoice!.id}`,
    `/fees/${invoice!.id}/print`,
    `/fees/${invoice!.id}/print?payment=${payment!.id}`,
    "/settings",
    "/settings/hostel",
    "/settings/fees",
    "/settings/staff",
  ]) {
    await expectNoViolations(page, path);
  }
});
