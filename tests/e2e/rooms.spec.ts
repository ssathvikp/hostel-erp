import { expect, test } from "@playwright/test";

import { createUserFactory, TEST_PASSWORD } from "../support/supabase";
import { inMain, signIn } from "./helpers";

/** Room and bed inventory in a real browser (EP-04). */
const factory = createUserFactory();

test.afterAll(async () => {
  await factory.cleanup();
});

async function ownerWithHostel(name: string) {
  const owner = await factory.createUser();
  const hostel = await factory.createHostel(owner.id, { name });
  return { owner, hostel };
}

test("an owner adds a room, with server validation and a friendly duplicate error", async ({
  page,
}) => {
  const { owner } = await ownerWithHostel("Room Maker PG");
  await signIn(page, owner.email, TEST_PASSWORD);

  await page.goto("/rooms");
  await expect(inMain(page).getByText("No rooms yet")).toBeVisible();
  await inMain(page).getByRole("link", { name: "Add one room" }).click();

  // Sharing type fixes the capacity; an invalid floor keeps what was typed.
  await page.getByLabel(/^Room number/).fill(" 101a ");
  await page.getByLabel(/^Floor/).fill("101");
  await page.getByLabel(/^Sharing type/).selectOption("triple");
  await expect(page.getByLabel(/^Beds in the room/)).toHaveValue("3");
  await page.getByRole("button", { name: "Create room" }).click();
  await expect(inMain(page).getByText("Floor must be at most 100")).toBeVisible();
  await expect(page.getByLabel(/^Room number/)).toHaveValue(" 101a ");
  await expect(page.getByLabel(/^Sharing type/)).toHaveValue("triple");

  await page.getByLabel(/^Floor/).fill("1");
  await page.getByRole("button", { name: "Create room" }).click();

  // Back on the list, with the new, normalised room visible.
  await expect(page).toHaveURL(/\/rooms\?q=101A&created=101A$/);
  await expect(inMain(page).getByText("Room 101A was created with its beds.")).toBeVisible();
  await inMain(page).getByRole("link", { name: "101A" }).click();
  for (const label of ["101A-A", "101A-B", "101A-C"]) {
    await expect(inMain(page).getByRole("cell", { name: label, exact: true })).toBeVisible();
  }

  await page.goto("/rooms/new");
  await page.getByLabel(/^Room number/).fill("101A");
  await page.getByLabel(/^Floor/).fill("1");
  await page.getByLabel(/^Sharing type/).selectOption("single");
  await page.getByRole("button", { name: "Create room" }).click();
  await expect(inMain(page).getByText("Room 101A already exists in this hostel.")).toBeVisible();
});

test("an owner previews and creates a floor of rooms in bulk", async ({ page }) => {
  const { owner, hostel } = await ownerWithHostel("Bulk Builder PG");
  await factory.admin.from("rooms").insert({
    hostel_id: hostel.id,
    room_number: "205",
    floor: 2,
    sharing_type: "double",
    capacity: 2,
  });
  await signIn(page, owner.email, TEST_PASSWORD);

  await page.goto("/rooms/bulk");
  await page.getByLabel(/^First room number/).fill("201");
  await page.getByLabel(/^Last room number/).fill("210");
  await page.getByLabel(/^Floor/).fill("2");
  await page.getByLabel(/^Sharing type/).selectOption("four_plus");
  await page.getByLabel(/^Beds in the room/).fill("4");
  await page.getByRole("button", { name: "Preview" }).click();

  // The conflict is reported and nothing can be created yet.
  await expect(inMain(page).getByText("Preview: 10 rooms and 40 beds")).toBeVisible();
  await expect(
    inMain(page).getByText("205 is already in this hostel.", { exact: false }),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: /^Create/ })).toHaveCount(0);

  await page.getByLabel(/^First room number/).fill("211");
  await page.getByLabel(/^Last room number/).fill("230");
  // Editing after a preview hides it until the owner previews again.
  await expect(inMain(page).getByText(/^Preview:/)).toHaveCount(0);
  await page.getByRole("button", { name: "Preview" }).click();
  await expect(inMain(page).getByText("Preview: 20 rooms and 80 beds")).toBeVisible();
  await expect(inMain(page).getByText("211–230")).toBeVisible();
  await page.getByRole("button", { name: "Create 20 rooms" }).click();

  await expect(inMain(page).getByText("Created 20 rooms with 80 beds.")).toBeVisible();
  await inMain(page).getByRole("link", { name: "View rooms" }).click();
  await expect(inMain(page).getByText("Showing 1–21 of 21 rooms")).toBeVisible();
});

test("filters live in the URL and survive a reload", async ({ page }) => {
  const { owner, hostel } = await ownerWithHostel("Filter House");
  const rooms = [
    { room_number: "G1", floor: 0, sharing_type: "single", capacity: 1 },
    { room_number: "101", floor: 1, sharing_type: "double", capacity: 2 },
    { room_number: "102", floor: 1, sharing_type: "triple", capacity: 3 },
  ];
  await factory.admin
    .from("rooms")
    .insert(rooms.map((room) => ({ ...room, hostel_id: hostel.id })));
  await signIn(page, owner.email, TEST_PASSWORD);

  await page.goto("/rooms");
  await expect(inMain(page).getByText("Showing 1–3 of 3 rooms")).toBeVisible();
  await page.getByLabel("Floor").selectOption("1");
  await expect(page).toHaveURL(/floor=1/);
  await page.getByLabel("Sharing type").selectOption("triple");
  await expect(page).toHaveURL(/floor=1&sharing=triple/);
  await expect(inMain(page).getByText("Showing 1–1 of 1 room")).toBeVisible();

  await page.reload();
  await expect(page.getByLabel("Floor")).toHaveValue("1");
  await expect(inMain(page).getByRole("link", { name: "102" })).toBeVisible();
  await expect(inMain(page).getByRole("link", { name: "101" })).toHaveCount(0);
});

test("an owner edits capacity, blocks a bed and archives a room", async ({ page }) => {
  const { owner, hostel } = await ownerWithHostel("Lifecycle Lodge");
  const { data: room } = await factory.admin
    .from("rooms")
    .insert({
      hostel_id: hostel.id,
      room_number: "301",
      floor: 3,
      sharing_type: "four_plus",
      capacity: 4,
    })
    .select("id")
    .single();
  await signIn(page, owner.email, TEST_PASSWORD);

  await page.goto(`/rooms/${room!.id}`);
  await inMain(page).getByRole("link", { name: "Edit room" }).click();
  await page.getByLabel(/^Beds in the room/).fill("5");
  await page.getByRole("button", { name: "Save changes" }).click();
  await expect(inMain(page).getByText("Room details saved.")).toBeVisible();
  await expect(inMain(page).getByRole("cell", { name: "301-E", exact: true })).toBeVisible();

  await page.getByRole("button", { name: "Change status of bed 301-B" }).click();
  const dialog = page.getByRole("dialog", { name: "Bed 301-B" });
  await dialog.getByLabel("Status").selectOption("blocked");
  await dialog.getByLabel(/^Reason/).fill("Broken frame");
  await dialog.getByRole("button", { name: "Save status" }).click();
  await expect(dialog).toBeHidden();
  const row = inMain(page).getByRole("row", { name: /301-B/ });
  // Cells: bed, status, resident, reason, last changed (the closed dialog also lives in the row).
  await expect(row.getByRole("cell").nth(1)).toHaveText("Blocked");
  await expect(row.getByRole("cell").nth(3)).toHaveText("Broken frame");

  await page.goto("/rooms");
  await expect(inMain(page).getByText("1 out of service")).toBeVisible();
  await page.getByLabel("Availability").selectOption("full");
  await expect(inMain(page).getByText("No rooms match these filters")).toBeVisible();

  await page.goto(`/rooms/${room!.id}`);
  await page.getByRole("button", { name: "Archive room" }).click();
  await page
    .getByRole("dialog", { name: "Archive room 301?" })
    .getByRole("button", { name: "Archive room" })
    .click();
  await expect(page).toHaveURL(/\/rooms\?archived=301$/);
  await expect(inMain(page).getByText("Room 301 was archived. Its history is kept.")).toBeVisible();
  await expect(inMain(page).getByRole("link", { name: "301" })).toHaveCount(0);

  await page.getByLabel("Show").selectOption("archived");
  await expect(inMain(page).getByRole("link", { name: "301" })).toBeVisible();
});

test("staff see the inventory and manage bed status, but cannot change rooms", async ({ page }) => {
  const { hostel } = await ownerWithHostel("Staffed Stay");
  const { data: room } = await factory.admin
    .from("rooms")
    .insert({
      hostel_id: hostel.id,
      room_number: "401",
      floor: 4,
      sharing_type: "double",
      capacity: 2,
    })
    .select("id")
    .single();
  const staff = await factory.createUser({ profile: { role: "staff", hostel_id: hostel.id } });
  await signIn(page, staff.email, TEST_PASSWORD);

  await page.goto("/rooms");
  await expect(inMain(page).getByRole("link", { name: "401" })).toBeVisible();
  await expect(inMain(page).getByRole("link", { name: "Add room" })).toHaveCount(0);

  await page.goto("/rooms/new");
  await expect(page).toHaveURL(/\/rooms$/);

  await page.goto(`/rooms/${room!.id}`);
  await expect(inMain(page).getByRole("link", { name: "Edit room" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Archive room" })).toHaveCount(0);

  await page.getByRole("button", { name: "Change status of bed 401-A" }).click();
  const dialog = page.getByRole("dialog", { name: "Bed 401-A" });
  await dialog.getByLabel("Status").selectOption("maintenance");
  await dialog.getByRole("button", { name: "Save status" }).click();
  await expect(dialog).toBeHidden();
  await expect(
    inMain(page).getByRole("row", { name: /401-A/ }).getByRole("cell").nth(1),
  ).toHaveText("Maintenance");
});
