import { expect, test, type Page } from "@playwright/test";

import { todayIst } from "@/lib/validation";

import { residentRow } from "../support/residents";
import { createUserFactory, TEST_PASSWORD } from "../support/supabase";
import { inMain, signIn } from "./helpers";

/** Wide tables scroll inside their frame; the page itself never scrolls sideways. */
async function expectNoSidewaysScroll(page: Page) {
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow).toBeLessThanOrEqual(0);
}

/** Allocation, transfer, vacate and the occupancy view in a real browser (EP-06). */
const factory = createUserFactory();
const { admin } = factory;

test.afterAll(factory.cleanup);

function daysFromToday(days: number): string {
  const date = new Date(`${todayIst()}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

async function setup(name: string) {
  const owner = await factory.createUser();
  const hostel = await factory.createHostel(owner.id, { name });
  const rooms: Record<string, { id: string; beds: { id: string; bed_label: string }[] }> = {};
  for (const [room_number, capacity, floor] of [
    ["101", 2, 1],
    ["201", 1, 2],
  ] as const) {
    const { data: room, error } = await admin
      .from("rooms")
      .insert({
        hostel_id: hostel.id,
        room_number,
        floor,
        sharing_type: capacity === 1 ? "single" : "double",
        capacity,
      })
      .select("id")
      .single();
    if (error) throw error;
    const { data: beds } = await admin
      .from("beds")
      .select("id, bed_label")
      .eq("room_id", room.id)
      .order("bed_label");
    rooms[room_number] = { id: room.id, beds: beds! };
  }
  return { owner, hostel, rooms };
}

async function addResident(hostelId: string, full_name: string) {
  const { data, error } = await admin
    .from("residents")
    .insert(residentRow(hostelId, { full_name }))
    .select("id, phone")
    .single();
  if (error) throw error;
  return data;
}

test("a resident is allocated a bed, transferred, then vacated", async ({ page }) => {
  const { owner, hostel } = await setup("Stay PG");
  const { id: residentId } = await addResident(hostel.id, "Anil Varma");
  await signIn(page, owner.email, TEST_PASSWORD);

  // Allocate from the profile: only vacant beds are offered.
  await page.goto(`/residents/${residentId}`);
  await expect(inMain(page).getByText("Not allocated to a bed.")).toBeVisible();
  await inMain(page).getByRole("button", { name: "Allocate bed" }).click();
  const allocate = page.getByRole("dialog", { name: "Allocate a bed to Anil Varma" });
  await allocate.getByLabel(/^Bed/).selectOption({ label: "Bed 101-A · Double · 1st floor" });
  await allocate.getByLabel(/^First night in the bed/).fill(daysFromToday(-5));
  await allocate.getByRole("button", { name: "Allocate", exact: true }).click();
  await expect(allocate).toBeHidden();
  await expect(inMain(page).getByText(/^Room 101, bed 101-A since/)).toBeVisible();

  // Transfer: the confirmation surfaces fees before the move.
  await inMain(page).getByRole("button", { name: "Transfer Anil Varma to another bed" }).click();
  const transfer = page.getByRole("dialog", { name: "Move Anil Varma to another bed" });
  await expect(transfer.getByText("Before you confirm")).toBeVisible();
  await expect(transfer.getByRole("option", { name: /Bed 101-A/ })).toHaveCount(0);
  await transfer.getByLabel(/^New bed/).selectOption({ label: "Bed 201-A · Single · 2nd floor" });
  await transfer.getByLabel(/^First night in the new bed/).fill(daysFromToday(-2));
  await transfer.getByRole("button", { name: "Confirm transfer" }).click();
  await expect(transfer).toBeHidden();
  await expect(inMain(page).getByText(/^Room 201, bed 201-A since/)).toBeVisible();
  const log = inMain(page).getByRole("table", { name: "Allocation activity log" });
  await expect(log.getByText("Moved in (transfer)")).toBeVisible();
  await expect(log.getByText("Moved out (transfer)")).toBeVisible();

  // Vacate and mark the resident vacated in one step.
  await inMain(page).getByRole("button", { name: "Vacate bed 201-A" }).click();
  const vacate = page.getByRole("dialog", { name: "Vacate bed 201-A" });
  await vacate.getByLabel(/^Reason/).selectOption("moved_out");
  await vacate.getByRole("button", { name: "Vacate bed" }).click();
  await expect(vacate).toBeHidden();
  await expect(inMain(page).getByText("Not allocated to a bed.")).toBeVisible();
  await expect(inMain(page).getByText("Vacated", { exact: true }).first()).toBeVisible();
  await expect(log.getByText("Vacated", { exact: true })).toBeVisible();
  await expect(inMain(page).getByText(/Vacated residents cannot be given a bed/)).toBeVisible();
});

test("a taken bed is refused with the holder's name", async ({ page }) => {
  const { owner, hostel, rooms } = await setup("Clash PG");
  const first = await addResident(hostel.id, "Sita Devi");
  const second = await addResident(hostel.id, "Gita Rani");
  await signIn(page, owner.email, TEST_PASSWORD);

  // Both profiles are loaded while 201-A is still vacant.
  await page.goto(`/residents/${second.id}`);
  await inMain(page).getByRole("button", { name: "Allocate bed" }).click();
  const dialog = page.getByRole("dialog", { name: "Allocate a bed to Gita Rani" });
  await dialog.getByLabel(/^Bed/).selectOption({ label: "Bed 201-A · Single · 2nd floor" });

  // Meanwhile someone else gives the bed to Sita.
  const { error } = await admin.from("allocations").insert({
    hostel_id: hostel.id,
    resident_id: first.id,
    bed_id: rooms["201"].beds[0].id,
    room_id: rooms["201"].id,
    start_date: todayIst(),
    created_by: owner.id,
  });
  expect(error).toBeNull();

  await dialog.getByRole("button", { name: "Allocate", exact: true }).click();
  await expect(dialog.getByText(/Bed 201-A is held by Sita Devi from/)).toBeVisible();

  // Sita's stay started today, so it cannot be moved until tomorrow.
  await page.goto(`/residents/${first.id}`);
  await expect(inMain(page).getByRole("button", { name: "Vacate bed 201-A" })).toBeDisabled();
  await expect(
    inMain(page).getByText(
      "This allocation started today. It can be vacated or transferred from tomorrow.",
    ),
  ).toBeVisible();
});

test("the occupancy view shows each floor and allocates from a vacant bed", async ({ page }) => {
  const { owner, hostel, rooms } = await setup("Board PG");
  const kavya = await addResident(hostel.id, "Kavya Reddy");
  await admin
    .from("beds")
    .update({ status: "maintenance", status_reason: "Leaking tap" })
    .eq("id", rooms["101"].beds[1].id);
  await signIn(page, owner.email, TEST_PASSWORD);

  await page.goto("/occupancy");
  const main = inMain(page);
  await expect(main.getByRole("heading", { name: "Occupancy" })).toBeVisible();
  await expect(main.getByText("0 of 2 occupied")).toBeVisible();
  await expect(main.getByText("Leaking tap")).toBeVisible();
  await expect(main.getByText("Maintenance", { exact: true })).toBeVisible();
  await expectNoSidewaysScroll(page);

  await main.getByRole("button", { name: "Allocate bed 201-A" }).click();
  const dialog = page.getByRole("dialog", { name: "Allocate bed 201-A" });
  await dialog.getByLabel(/^Resident/).selectOption({ label: `Kavya Reddy · ${kavya.phone}` });
  await dialog.getByRole("button", { name: "Allocate", exact: true }).click();
  await expect(dialog).toBeHidden();

  // Updated in place by the server action, no reload.
  const floor2 = main.getByRole("region", { name: "2nd floor" });
  await expect(floor2.getByText("1 of 1 occupied")).toBeVisible();
  await expect(floor2.getByRole("link", { name: "Kavya Reddy" })).toBeVisible();
  await expect(main.getByText("33%").first()).toBeVisible();

  // The room list carries the same numbers.
  await page.goto("/rooms");
  const row = inMain(page).getByRole("row", { name: /^201/ });
  await expect(row.getByRole("cell").nth(4)).toHaveText("1");
  await expect(row.getByRole("cell").nth(5)).toHaveText("0");
  await expectNoSidewaysScroll(page);

  await page.goto(`/rooms/${rooms["101"].id}`);
  await expect(inMain(page).getByRole("heading", { name: "Allocation history" })).toBeVisible();
  await expectNoSidewaysScroll(page);
});
