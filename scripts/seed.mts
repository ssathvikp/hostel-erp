/**
 * Seeds the local database with a demo hostel (E9-T6): an owner and a staff
 * member, 40 beds over three floors, 25 residents, live allocations, rates,
 * three months of invoices and a realistic mix of payments.
 *
 * Idempotent: every step looks for what it would create first, so running
 * it again adds nothing. Test suites never depend on it.
 *
 * Usage: npm run db:seed   (after `npm run db:start` and `npm run env:local`)
 */
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";

import { createClient, type SupabaseClient } from "@supabase/supabase-js";

if (existsSync(".env.local")) process.loadEnvFile(".env.local");

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
if (!url || !serviceKey || !anonKey) {
  console.error("Supabase keys are missing. Run `npm run db:start`, then `npm run env:local`.");
  process.exit(1);
}
// Demo data must never reach a hosted project.
if (!/^https?:\/\/(127\.0\.0\.1|localhost)(:\d+)?/.test(url)) {
  console.error(`Refusing to seed ${url}: the seed script only runs against local Supabase.`);
  process.exit(1);
}

const PASSWORD = "Demo-passw0rd";
const OWNER = { email: "owner@demo.hostel-erp.test", fullName: "Lakshmi Narayanan" };
const STAFF = { email: "warden@demo.hostel-erp.test", fullName: "Suresh Kumar" };
const PLATFORM_ADMIN = { email: "admin@demo.hostel-erp.test", fullName: "Platform Admin" };
const HOSTEL_NAME = "Sunrise Residency";

const options = { auth: { autoRefreshToken: false, persistSession: false } } as const;
const admin = createClient(url, serviceKey, options);

/**
 * Stops the seed on the first error. Writes without `.select()` return no
 * data; only reads use the return value, and those always return rows.
 */
function check<R extends { data: unknown; error: unknown }>(
  result: R,
  what: string,
): NonNullable<R["data"]> {
  if (result.error) {
    console.error(`Seeding failed while ${what}:`, result.error);
    process.exit(1);
  }
  return result.data as NonNullable<R["data"]>;
}

// ---------------------------------------------------------------------------
// Dates, in India's calendar like the app
// ---------------------------------------------------------------------------

const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" }).format(new Date());

function monthStart(offset: number): string {
  const [year, month] = today.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1 + offset, 1)).toISOString().slice(0, 10);
}

function addDays(date: string, days: number): string {
  const next = new Date(`${date}T00:00:00Z`);
  next.setUTCDate(next.getUTCDate() + days);
  return next.toISOString().slice(0, 10);
}

// ---------------------------------------------------------------------------
// Users and hostel
// ---------------------------------------------------------------------------

async function ensureUser(email: string, fullName: string): Promise<string> {
  const { data } = await admin.auth.admin.listUsers({ perPage: 1000 });
  const existing = data?.users.find((user) => user.email === email);
  if (existing) return existing.id;
  const created = await admin.auth.admin.createUser({
    email,
    password: PASSWORD,
    email_confirm: true,
    user_metadata: { full_name: fullName },
  });
  return check(created, `creating ${email}`).user!.id;
}

async function ensureHostel(ownerId: string): Promise<string> {
  const found = check(
    await admin.from("hostels").select("id").eq("owner_id", ownerId).eq("name", HOSTEL_NAME),
    "looking up the hostel",
  );
  if (found.length > 0) return found[0].id;
  const created = await admin
    .from("hostels")
    .insert({
      owner_id: ownerId,
      name: HOSTEL_NAME,
      type: "co_ed",
      phone: "9845012345",
      email: "hello@sunrise.example",
      address: "14, 5th Cross, Koramangala 4th Block",
      city: "Bengaluru",
      state: "Karnataka",
      pincode: "560034",
      floors: 3,
      status: "active",
    })
    .select("id")
    .single();
  return check(created, "creating the hostel").id;
}

// ---------------------------------------------------------------------------
// Inventory: 40 beds over three floors
// ---------------------------------------------------------------------------

const ROOMS = [
  ...["101", "102", "103", "104", "105"].map((n) => [n, 1, "double", 2] as const),
  ...["201", "202", "203", "204", "205"].map((n) => [n, 2, "triple", 3] as const),
  ...["301", "302", "303"].map((n) => [n, 3, "four_plus", 4] as const),
  ...["304", "305", "306"].map((n) => [n, 3, "single", 1] as const),
];

const RATES = { single: 1200000, double: 850000, triple: 700000, four_plus: 600000 } as const;

async function ensureInventory(hostelId: string) {
  check(
    await admin.from("rooms").upsert(
      ROOMS.map(([room_number, floor, sharing_type, capacity]) => ({
        hostel_id: hostelId,
        room_number,
        floor,
        sharing_type,
        capacity,
      })),
      { onConflict: "hostel_id,room_number", ignoreDuplicates: true },
    ),
    "creating rooms",
  );

  // One bed under maintenance, so the occupancy view shows every state.
  check(
    await admin
      .from("beds")
      .update({ status: "maintenance", status_reason: "Mattress replacement" })
      .eq("hostel_id", hostelId)
      .eq("bed_label", "205-C")
      .eq("status", "available"),
    "marking a bed for maintenance",
  );

  for (const [sharingType, amount] of Object.entries(RATES)) {
    const existing = check(
      await admin
        .from("fee_structures")
        .select("id")
        .eq("hostel_id", hostelId)
        .eq("sharing_type", sharingType),
      "looking up rates",
    );
    if (existing.length === 0) {
      check(
        await admin.from("fee_structures").insert({
          hostel_id: hostelId,
          sharing_type: sharingType,
          monthly_amount: amount,
          effective_from: monthStart(-6),
        }),
        "setting rates",
      );
    }
  }
}

// ---------------------------------------------------------------------------
// Residents and their stays
// ---------------------------------------------------------------------------

const NAMES = [
  ["Aarav Sharma", "male"],
  ["Diya Patel", "female"],
  ["Vihaan Reddy", "male"],
  ["Ananya Iyer", "female"],
  ["Arjun Nair", "male"],
  ["Ishita Gupta", "female"],
  ["Kabir Singh", "male"],
  ["Meera Krishnan", "female"],
  ["Rohan Das", "male"],
  ["Saanvi Joshi", "female"],
  ["Aditya Rao", "male"],
  ["Kavya Menon", "female"],
  ["Rahul Verma", "male"],
  ["Pooja Hegde", "female"],
  ["Nikhil Kulkarni", "male"],
  ["Sneha Pillai", "female"],
  ["Karthik Subramanian", "male"],
  ["Riya Banerjee", "female"],
  ["Siddharth Mehta", "male"],
  ["Tanvi Deshpande", "female"],
  ["Varun Choudhary", "male"],
  ["Neha Agarwal", "female"],
  ["Manish Tiwari", "male"],
  ["Priyanka Bose", "female"],
  ["Harsh Malhotra", "male"],
] as const;

/** Residents who have stayed but left, or registered but not yet given a bed. */
const NOT_LIVING_HERE = new Set([22, 23, 24]);

async function ensureResidents(hostelId: string, ownerId: string) {
  check(
    await admin.from("residents").upsert(
      NAMES.map(([full_name, gender], i) => ({
        hostel_id: hostelId,
        full_name,
        gender,
        phone: `98860${String(10001 + i).padStart(5, "0")}`,
        email: `${full_name.split(" ")[0].toLowerCase()}@example.com`,
        dob: `200${i % 6}-0${(i % 9) + 1}-1${i % 9}`,
        id_proof_type: "aadhaar",
        id_proof_last4: String(4000 + i),
        id_proof_hash: createHash("sha256").update(`seed-aadhaar-${i}`).digest("hex"),
        guardian_name: `Parent of ${full_name.split(" ")[0]}`,
        guardian_phone: `97400${String(20001 + i).padStart(5, "0")}`,
        permanent_address: "Demo address, Andhra Pradesh",
        joining_date: monthStart(-4),
        consent_at: `${monthStart(-4)}T09:00:00+05:30`,
        created_by: ownerId,
      })),
      { onConflict: "hostel_id,phone", ignoreDuplicates: true },
    ),
    "creating residents",
  );

  const residents = check(
    await admin
      .from("residents")
      .select("id, phone, allocations(id)")
      .eq("hostel_id", hostelId)
      .order("phone"),
    "reading residents",
  );
  const beds = check(
    await admin
      .from("bed_states")
      .select("id, room_id, bed_label, status")
      .eq("hostel_id", hostelId)
      .eq("status", "available")
      .order("bed_label"),
    "reading vacant beds",
  );

  let bedIndex = 0;
  for (const [i, resident] of residents.entries()) {
    if (resident.allocations.length > 0 || NOT_LIVING_HERE.has(i)) continue;
    const bed = beds[bedIndex++];
    if (!bed) break;
    // Arrivals spread over the last four months, some mid-month.
    const start = addDays(monthStart(-3 + (i % 4)), (i * 3) % 20);
    check(
      await admin.from("allocations").insert({
        hostel_id: hostelId,
        resident_id: resident.id,
        bed_id: bed.id!,
        room_id: bed.room_id!,
        start_date: start > today ? today : start,
        // Two residents pay a negotiated rent.
        rent_override: i === 3 || i === 11 ? 750000 : null,
        created_by: ownerId,
      }),
      "allocating beds",
    );
    // Most residents paid a two-month security deposit on arrival.
    if (i % 3 !== 2) {
      check(
        await admin.from("deposit_entries").insert({
          hostel_id: hostelId,
          resident_id: resident.id,
          kind: "collected",
          amount: 1200000,
          entry_date: start > today ? today : start,
          mode: i % 2 === 0 ? "upi" : "cash",
          recorded_by: ownerId,
        }),
        "recording deposits",
      );
    }
  }
}

// ---------------------------------------------------------------------------
// Invoices and payments
// ---------------------------------------------------------------------------

async function ensureBilling(hostelId: string, owner: SupabaseClient) {
  for (const offset of [-2, -1, 0]) {
    check(
      await owner.rpc("generate_invoices", {
        p_hostel_id: hostelId,
        p_period_month: monthStart(offset),
        p_due_day: 5,
      }),
      `generating invoices for ${monthStart(offset)}`,
    );
  }

  const invoices = check(
    await admin
      .from("invoice_balances")
      .select("id, period_month, amount, paid")
      .eq("hostel_id", hostelId)
      .eq("status", "issued")
      .order("period_month")
      .order("resident_name"),
    "reading invoices",
  );

  const modes = ["upi", "cash", "bank_transfer", "upi", "card"] as const;
  for (const [i, invoice] of invoices.entries()) {
    if ((invoice.paid ?? 0) > 0) continue;
    const month = invoice.period_month!;
    const amount = invoice.amount!;
    // Two months ago: nearly everyone paid. Last month: a mix. This month:
    // the early payers only.
    const share =
      month === monthStart(-2)
        ? i % 9 === 0
          ? 0
          : 1
        : month === monthStart(-1)
          ? [1, 1, 0.5, 0, 1, 0.4][i % 6]
          : [1, 0, 0, 0.5][i % 4];
    if (share === 0) continue;
    const paidAt = addDays(month, 2 + (i % 6));
    check(
      await owner.from("payments").insert({
        hostel_id: hostelId,
        invoice_id: invoice.id!,
        amount: share === 1 ? amount : Math.round((amount * share) / 100) * 100,
        paid_at: paidAt > today ? today : paidAt,
        mode: modes[i % modes.length],
        reference: i % 2 === 0 ? `UTR${String(410000000 + i * 7919)}` : null,
      }),
      "recording payments",
    );
  }
}

// ---------------------------------------------------------------------------

const ownerId = await ensureUser(OWNER.email, OWNER.fullName);
const hostelId = await ensureHostel(ownerId);
const staffId = await ensureUser(STAFF.email, STAFF.fullName);
check(
  await admin.from("profiles").update({ role: "staff", hostel_id: hostelId }).eq("id", staffId),
  "making the warden staff",
);
// Listed on the staff settings page like anyone invited through the app.
const { data: wardenInvite } = await admin
  .from("staff_invitations")
  .select("id")
  .eq("hostel_id", hostelId)
  .eq("email", STAFF.email)
  .maybeSingle();
if (!wardenInvite) {
  check(
    await admin.from("staff_invitations").insert({
      hostel_id: hostelId,
      email: STAFF.email,
      full_name: STAFF.fullName,
      profile_id: staffId,
      invited_by: ownerId,
      accepted_at: new Date().toISOString(),
    }),
    "recording the warden's invitation",
  );
}

// The operator console (/admin) for the people running Hostel ERP.
const platformAdminId = await ensureUser(PLATFORM_ADMIN.email, PLATFORM_ADMIN.fullName);
check(
  await admin
    .from("profiles")
    .update({ role: "platform_admin", hostel_id: null })
    .eq("id", platformAdminId),
  "making the platform admin",
);

await ensureInventory(hostelId);
await ensureResidents(hostelId, ownerId);

const ownerClient = createClient(url, anonKey, options);
check(
  await ownerClient.auth.signInWithPassword({ email: OWNER.email, password: PASSWORD }),
  "signing in as the owner",
);
await ensureBilling(hostelId, ownerClient);

const [{ count: beds }, { count: residents }, { count: invoices }, { count: payments }] =
  await Promise.all(
    (["beds", "residents", "invoices", "payments"] as const).map((table) =>
      admin.from(table).select("id", { count: "exact", head: true }).eq("hostel_id", hostelId),
    ),
  );

console.log(`
Seeded "${HOSTEL_NAME}": ${beds} beds, ${residents} residents, ${invoices} invoices, ${payments} payments.

  Owner   ${OWNER.email}
  Staff   ${STAFF.email}
  Admin   ${PLATFORM_ADMIN.email}  (platform console at /admin)
  Password for all: ${PASSWORD}

Sign in at http://localhost:3000/login
`);
