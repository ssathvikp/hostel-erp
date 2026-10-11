import { expect, test, type Page } from "@playwright/test";

import { randomMobile, residentRow } from "../support/residents";
import { createUserFactory, TEST_PASSWORD } from "../support/supabase";
import { inMain, signIn } from "./helpers";

/** Resident management in a real browser (EP-05). */
const factory = createUserFactory();
const uploaded: string[] = [];

test.afterAll(async () => {
  if (uploaded.length > 0) await factory.admin.storage.from("id-proofs").remove(uploaded);
  await factory.cleanup();
});

async function ownerWithHostel(name: string) {
  const owner = await factory.createUser();
  const hostel = await factory.createHostel(owner.id, { name });
  return { owner, hostel };
}

/** A random valid Aadhaar number (never starts with 0 or 1). */
function aadhaar() {
  return `${2 + Math.floor(Math.random() * 8)}${String(Math.floor(Math.random() * 1e11)).padStart(11, "0")}`;
}

async function fillRegistration(
  page: Page,
  person: { name: string; phone: string; idNumber: string; dob?: string },
) {
  await page.getByLabel(/^Full name/).fill(person.name);
  await page.getByLabel(/^Gender/).selectOption("female");
  await page.getByLabel(/^Date of birth/).fill(person.dob ?? "2003-04-12");
  await page.getByLabel(/^ID proof type/).selectOption("aadhaar");
  await page.getByLabel(/^ID proof number/).fill(person.idNumber);
  await page.getByLabel(/^Mobile number/).fill(person.phone);
  await page.getByLabel(/^Permanent address/).fill("4-1-22 Gandhi Nagar, Guntur");
}

test("an owner registers a resident with server-side validation", async ({ page }) => {
  const { owner } = await ownerWithHostel("Register PG");
  await signIn(page, owner.email, TEST_PASSWORD);

  await page.goto("/residents");
  await expect(inMain(page).getByText("No residents yet")).toBeVisible();
  await inMain(page).getByRole("link", { name: "Register the first resident" }).click();

  const phone = randomMobile();
  const idNumber = aadhaar();
  // Too young: rejected on the server, values kept (except the ID number).
  await fillRegistration(page, { name: "Lakshmi Prasanna", phone, idNumber, dob: "2020-01-01" });
  await page.getByRole("button", { name: "Register resident" }).click();
  await expect(inMain(page).getByText(/Resident must be between 15 and 80/)).toBeVisible();
  await expect(page.getByLabel(/^Full name/)).toHaveValue("Lakshmi Prasanna");
  await expect(page.getByLabel(/^Mobile number/)).toHaveValue(phone);
  await expect(page.getByLabel(/^ID proof number/)).toHaveValue("");

  await page.getByLabel(/^Date of birth/).fill("2003-04-12");
  await page.getByLabel(/^ID proof number/).fill(idNumber);
  await page.getByRole("button", { name: "Register resident" }).click();

  await expect(page).toHaveURL(/\/residents\/[0-9a-f-]+\?registered=1$/);
  await expect(inMain(page).getByRole("heading", { name: "Lakshmi Prasanna" })).toBeVisible();
  await expect(inMain(page).getByText("Resident registered.")).toBeVisible();
  await expect(inMain(page).getByText(`Aadhaar ending ${idNumber.slice(-4)}`)).toBeVisible();
  await expect(inMain(page).getByText("Not allocated to a bed.")).toBeVisible();
  // The full number never appears anywhere on the page.
  await expect(page.locator("body")).not.toContainText(idNumber);
});

test("a duplicate resident is refused and the existing record is offered", async ({ page }) => {
  const { owner } = await ownerWithHostel("Duplicate PG");
  await signIn(page, owner.email, TEST_PASSWORD);

  const phone = randomMobile();
  const idNumber = aadhaar();
  await page.goto("/residents/new");
  await fillRegistration(page, { name: "Ravi Kumar", phone, idNumber });
  await page.getByRole("button", { name: "Register resident" }).click();
  await expect(page).toHaveURL(/registered=1$/);
  const firstUrl = page.url().replace(/\?.*$/, "");

  // Same phone.
  await page.goto("/residents/new");
  await fillRegistration(page, { name: "R. Kumar", phone, idNumber: aadhaar() });
  await page.getByRole("button", { name: "Register resident" }).click();
  await expect(inMain(page).getByText("This phone number belongs to")).toBeVisible();
  await expect(page).toHaveURL(/\/residents\/new$/);

  // Same ID proof, different phone.
  await page.getByLabel(/^Mobile number/).fill(randomMobile());
  await page.getByLabel(/^ID proof number/).fill(idNumber);
  await page.getByRole("button", { name: "Register resident" }).click();
  await expect(inMain(page).getByText("This ID proof belongs to")).toBeVisible();
  await inMain(page).getByRole("link", { name: "Open the existing resident" }).click();
  await expect(page).toHaveURL(firstUrl);
});

test("residents are found by name, phone and status, and edited", async ({ page }) => {
  const { owner, hostel } = await ownerWithHostel("Search PG");
  const meena = residentRow(hostel.id, { full_name: "Meena Kumari" });
  const suresh = residentRow(hostel.id, { full_name: "Suresh Babu" });
  const gone = residentRow(hostel.id, { full_name: "Vacated Person" });
  const { data } = await factory.admin
    .from("residents")
    .insert([meena, suresh, gone])
    .select("id, full_name");
  // Residents are always registered active; move this one through the lifecycle.
  const goneId = data!.find((row) => row.full_name === "Vacated Person")!.id;
  await factory.admin.from("residents").update({ status: "notice" }).eq("id", goneId);
  await factory.admin.from("residents").update({ status: "vacated" }).eq("id", goneId);
  const meenaId = data!.find((row) => row.full_name === "Meena Kumari")!.id;
  await signIn(page, owner.email, TEST_PASSWORD);

  await page.goto("/residents");
  await expect(inMain(page).getByText("2 residents found")).toBeVisible();

  await page.getByLabel("Search", { exact: true }).fill("meena");
  await page.getByLabel("Search", { exact: true }).press("Enter");
  await expect(page).toHaveURL(/q=meena/);
  await expect(inMain(page).getByText("1 resident found")).toBeVisible();

  await page.getByLabel("Search", { exact: true }).fill(suresh.phone.slice(-5));
  await page.getByLabel("Search", { exact: true }).press("Enter");
  await expect(inMain(page).getByRole("link", { name: "Suresh Babu" })).toBeVisible();

  await page.goto("/residents?status=vacated");
  await expect(inMain(page).getByRole("link", { name: "Vacated Person" })).toBeVisible();
  await page.reload();
  await expect(page.getByLabel("Status")).toHaveValue("vacated");

  await page.goto(`/residents/${meenaId}`);
  await inMain(page).getByRole("link", { name: "Edit details" }).click();
  await page.getByLabel(/^Guardian name/).fill("Kumari Devi");
  await page.getByRole("button", { name: "Save changes" }).click();
  await expect(inMain(page).getByText("Resident details saved.")).toBeVisible();
  await expect(inMain(page).getByText("Kumari Devi")).toBeVisible();
});

test("a resident moves through notice and vacated, then is reactivated", async ({ page }) => {
  const { owner, hostel } = await ownerWithHostel("Lifecycle PG");
  const { data } = await factory.admin
    .from("residents")
    .insert(residentRow(hostel.id, { full_name: "Anil Varma" }))
    .select("id")
    .single();
  await signIn(page, owner.email, TEST_PASSWORD);
  await page.goto(`/residents/${data!.id}`);

  // Active residents cannot jump straight to vacated.
  await expect(page.getByRole("button", { name: "Mark vacated" })).toHaveCount(0);

  for (const [action, result] of [
    ["Put on notice", "Anil Varma is now on notice."],
    ["Mark vacated", "Anil Varma is now vacated."],
    ["Mark active", "Anil Varma is now active."],
  ]) {
    await page.getByRole("button", { name: action }).first().click();
    await page.getByRole("dialog").getByRole("button", { name: action }).click();
    await expect(inMain(page).getByText(result)).toBeVisible();
  }
});

test("an ID proof copy is checked, stored privately and opened through a signed URL", async ({
  page,
}) => {
  const { owner, hostel } = await ownerWithHostel("Upload PG");
  const { data } = await factory.admin
    .from("residents")
    .insert(residentRow(hostel.id, { full_name: "Upload Tester" }))
    .select("id")
    .single();
  await signIn(page, owner.email, TEST_PASSWORD);
  await page.goto(`/residents/${data!.id}`);

  // A file that only claims to be a PDF is refused.
  await page.getByLabel("Upload ID proof copy").setInputFiles({
    name: "proof.pdf",
    mimeType: "application/pdf",
    buffer: Buffer.from("MZ not really a pdf"),
  });
  await page.getByRole("button", { name: "Upload", exact: true }).click();
  await expect(inMain(page).getByText("Upload a PDF, JPG or PNG file")).toBeVisible();

  await page.getByLabel("Upload ID proof copy").setInputFiles({
    name: "proof.pdf",
    mimeType: "application/pdf",
    buffer: Buffer.from("%PDF-1.4\n% masked aadhaar copy\n"),
  });
  await page.getByRole("button", { name: "Upload", exact: true }).click();
  await expect(inMain(page).getByText("ID proof uploaded.")).toBeVisible();
  await expect(inMain(page).getByRole("link", { name: "View ID proof" })).toBeVisible();

  const { data: stored } = await factory.admin
    .from("residents")
    .select("id_proof_path")
    .eq("id", data!.id)
    .single();
  uploaded.push(stored!.id_proof_path!);
  expect(stored!.id_proof_path).toMatch(new RegExp(`^${hostel.id}/${data!.id}/[0-9a-f-]+\\.pdf$`));

  const response = await page.request.get(`/residents/${data!.id}/id-proof`);
  expect(response.status()).toBe(200);
  expect(response.headers()["content-type"]).toContain("application/pdf");
  expect(response.url()).toContain("token=");
});

test("staff register residents; another hostel cannot open them", async ({ page }) => {
  const { hostel } = await ownerWithHostel("Front Desk PG");
  const staff = await factory.createUser({ profile: { role: "staff", hostel_id: hostel.id } });
  const { owner: stranger } = await ownerWithHostel("Stranger PG");

  await signIn(page, staff.email, TEST_PASSWORD);
  await page.goto("/residents/new");
  await fillRegistration(page, {
    name: "Staff Registered",
    phone: randomMobile(),
    idNumber: aadhaar(),
  });
  await page.getByRole("button", { name: "Register resident" }).click();
  await expect(page).toHaveURL(/registered=1$/);
  const residentPath = new URL(page.url()).pathname;

  await page.context().clearCookies();
  await signIn(page, stranger.email, TEST_PASSWORD);
  const response = await page.goto(residentPath);
  expect(response?.status()).toBe(404);
  const proof = await page.request.get(`${residentPath}/id-proof`);
  expect(proof.status()).toBe(404);
});
