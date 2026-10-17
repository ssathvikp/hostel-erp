import { expect, test } from "@playwright/test";

import { createUserFactory, TEST_PASSWORD } from "../support/supabase";
import { inMain, openNavigation, signIn } from "./helpers";

/**
 * A form left open on one hostel must not save into another hostel the
 * owner switched to in a different tab (review fix 4).
 */
const factory = createUserFactory();

test.afterAll(factory.cleanup);

test("a stale tab cannot save into the hostel chosen in another tab", async ({ page, context }) => {
  const owner = await factory.createUser({ fullName: "Two Hostel Owner" });
  const first = await factory.createHostel(owner.id, { name: "First Tab PG" });
  const second = await factory.createHostel(owner.id, { name: "Second Tab PG" });
  await signIn(page, owner.email, TEST_PASSWORD);

  // Tab A: the first hostel's settings.
  await expect(inMain(page).getByText("First Tab PG at a glance.")).toBeVisible();
  await page.goto("/settings/hostel");
  await expect(page.getByLabel(/^Hostel name/)).toHaveValue("First Tab PG");

  // Tab B switches to the second hostel.
  const other = await context.newPage();
  await other.goto("/dashboard");
  await openNavigation(other);
  await other
    .getByLabel("Switch hostel")
    .filter({ visible: true })
    .selectOption({ label: "Second Tab PG" });
  await expect(inMain(other).getByText("Second Tab PG at a glance.")).toBeVisible();

  // Tab A saves: refused, and the second hostel keeps its own name.
  await page.getByLabel(/^Hostel name/).fill("First Tab PG Renamed");
  await page.getByRole("button", { name: "Save changes" }).click();
  await expect(
    inMain(page).getByText("You switched to a different hostel in another tab.", { exact: false }),
  ).toBeVisible();

  const { data } = await factory.admin
    .from("hostels")
    .select("id, name")
    .in("id", [first.id, second.id])
    .order("name");
  expect(data).toEqual([
    { id: first.id, name: "First Tab PG" },
    { id: second.id, name: "Second Tab PG" },
  ]);

  // After reloading, tab A works on the hostel now selected.
  await page.reload();
  await expect(page.getByLabel(/^Hostel name/)).toHaveValue("Second Tab PG");
});
