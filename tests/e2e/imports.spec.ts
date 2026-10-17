import { expect, test, type Page } from "@playwright/test";

import { createUserFactory, TEST_PASSWORD } from "../support/supabase";
import { inMain, signIn } from "./helpers";

/** Bringing an owner's spreadsheets in (data import). */
const factory = createUserFactory();

test.afterAll(factory.cleanup);

async function upload(page: Page, name: string, csv: string) {
  await page.getByLabel("CSV file").setInputFiles({
    name,
    mimeType: "text/csv",
    buffer: Buffer.from(csv),
  });
  await page.getByRole("button", { name: "Check file" }).click();
}

test("an owner imports rooms after fixing the rows the check finds", async ({ page }) => {
  const owner = await factory.createUser({ fullName: "Prakash Jain" });
  await factory.createHostel(owner.id);
  await signIn(page, owner.email, TEST_PASSWORD);

  await page.goto("/rooms");
  await page.getByRole("link", { name: "Import" }).click();
  await expect(page.getByRole("heading", { name: "Import rooms" })).toBeVisible();

  await upload(
    page,
    "rooms.csv",
    "Room No,Floor,Sharing\n101,1,double\n102,1,triple\n101,1,single\n",
  );
  await expect(inMain(page).getByText("rooms.csv: 2 of 3 rooms ready")).toBeVisible();
  await expect(inMain(page).getByRole("row", { name: /4 Same room 101 as line 2/ })).toBeVisible();
  await expect(page.getByRole("button", { name: /^Import \d+ rooms$/ })).toHaveCount(0);

  await upload(page, "rooms.csv", "Room No,Floor,Sharing\n101,1,double\n102,1,triple\n103,1,4+\n");
  await expect(inMain(page).getByText("rooms.csv: 2 of 3 rooms ready")).toBeVisible();
  await expect(inMain(page).getByText("capacity:", { exact: false })).toBeVisible();

  await upload(
    page,
    "rooms.csv",
    "Room No,Floor,Sharing,Beds\n101,1,double,\n102,1,triple,\n103,1,4+,6\n",
  );
  await expect(inMain(page).getByText("rooms.csv: 3 of 3 rooms ready")).toBeVisible();
  await page.getByRole("button", { name: "Import 3 rooms" }).click();

  await expect(page).toHaveURL(/\/rooms\?imported=3$/);
  await expect(inMain(page).getByText("3 rooms were imported with their beds.")).toBeVisible();
  await expect(inMain(page).getByRole("link", { name: "103", exact: true })).toBeVisible();

  // The same file again clashes with what is now in the hostel.
  await page.goto("/rooms/import");
  await upload(page, "rooms.csv", "room_number,floor,sharing_type\n101,1,double\n");
  await expect(inMain(page).getByText("Room 101 already exists in this hostel")).toBeVisible();
});

test("staff import residents; ID numbers never come back to the browser", async ({ page }) => {
  const owner = await factory.createUser({ fullName: "Geetha Rao" });
  const hostel = await factory.createHostel(owner.id);
  const staff = await factory.createUser({
    fullName: "Import Warden",
    profile: { role: "staff", hostel_id: hostel.id },
  });
  await signIn(page, staff.email, TEST_PASSWORD);

  await page.goto("/residents/import");
  const header = "name,mobile,gender,dob,id_proof_type,id_proof_number,address,joining_date";
  await upload(
    page,
    "register.csv",
    [
      header,
      "Nikhil Verma,98450 11111,M,14-05-2002,Aadhaar,2345 6789 0123,12 Station Road,01-06-2026",
      "Pooja Shah,9845022222,F,03-11-2001,PAN,ABCDE1234F,7 Lake View,15/06/2026",
    ].join("\n"),
  );
  await expect(inMain(page).getByText("register.csv: 2 of 2 residents ready")).toBeVisible();
  await expect(inMain(page).getByRole("cell", { name: "Nikhil Verma" })).toBeVisible();
  await expect(inMain(page).getByText("234567890123")).toHaveCount(0);
  await page.getByRole("button", { name: "Import 2 residents" }).click();
  await expect(
    inMain(page).getByText("Confirm that every resident in the file agreed"),
  ).toBeVisible();
  await page.getByLabel(/^Every resident in this file agreed/).check();
  await page.getByRole("button", { name: "Import 2 residents" }).click();

  await expect(page).toHaveURL(/\/residents\?imported=2$/);
  await expect(
    inMain(page).getByText("2 residents were imported.", { exact: false }),
  ).toBeVisible();
  await inMain(page).getByRole("link", { name: "Nikhil Verma" }).click();
  await expect(inMain(page).getByText("Aadhaar ending 0123")).toBeVisible();
  // Consent ticked on the import is stored for every resident in the file.
  const { data: imported } = await factory.admin
    .from("residents")
    .select("consent_at, consent_recorded_by")
    .eq("hostel_id", hostel.id);
  expect(imported).toHaveLength(2);
  for (const row of imported ?? []) {
    expect(row.consent_at).not.toBeNull();
    expect(row.consent_recorded_by).toBe(staff.id);
  }

  // Rooms stay owner-only.
  await page.goto("/rooms/import");
  await expect(inMain(page).getByText("Only the hostel owner can add rooms.")).toBeVisible();
});

test("a 500-resident file is checked and imported in one go", async ({ page }) => {
  test.slow();
  const owner = await factory.createUser({ fullName: "Big Register" });
  const hostel = await factory.createHostel(owner.id);
  await signIn(page, owner.email, TEST_PASSWORD);

  // Valid Aadhaar-format numbers (first digit 2-9) and distinct mobiles.
  const rows = Array.from({ length: 500 }, (_, i) => {
    const n = String(i).padStart(3, "0");
    return `Resident ${n},9${String(100000000 + i).slice(-9)},female,04-03-2001,aadhaar,23456789${String(1000 + i)},5 Temple Street,01-06-2026`;
  });
  await page.goto("/residents/import");
  await upload(
    page,
    "big.csv",
    ["name,mobile,gender,dob,id_proof_type,id_proof_number,address,joining_date", ...rows].join(
      "\n",
    ),
  );
  await expect(inMain(page).getByText("big.csv: 500 of 500 residents ready")).toBeVisible({
    timeout: 30_000,
  });
  await page.getByLabel(/^Every resident in this file agreed/).check();
  await page.getByRole("button", { name: "Import 500 residents" }).click();
  await expect(page).toHaveURL(/\/residents\?imported=500$/, { timeout: 30_000 });

  // The same file again: every row now clashes, found across all batches.
  await page.goto("/residents/import");
  await upload(
    page,
    "big.csv",
    ["name,mobile,gender,dob,id_proof_type,id_proof_number,address,joining_date", ...rows].join(
      "\n",
    ),
  );
  await expect(inMain(page).getByText("big.csv: 0 of 500 residents ready")).toBeVisible({
    timeout: 30_000,
  });
  const { count } = await factory.admin
    .from("residents")
    .select("id", { count: "exact", head: true })
    .eq("hostel_id", hostel.id)
    .not("consent_at", "is", null);
  expect(count).toBe(500);
});
