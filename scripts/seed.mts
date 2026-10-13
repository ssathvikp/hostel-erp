/**
 * Seeds the local database with a demo hostel (E9-T6): an owner and a staff
 * member, 40 beds over three floors, 25 residents, live allocations, rates,
 * three months of invoices and a realistic mix of payments, plus a mess
 * charge, metered electricity, deposits, late fees and a pending cheque.
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
// Fees beyond rent (EP-13): mess, electricity, late fees, deposits, a cheque
// ---------------------------------------------------------------------------

/** A monthly mess charge and metered electricity, before anything is billed. */
async function ensureFeeSetup(hostelId: string, owner: SupabaseClient) {
  const existing = check(
    await admin.from("fee_heads").select("id").eq("hostel_id", hostelId).eq("name", "Mess"),
    "reading fee heads",
  );
  if (existing.length === 0) {
    const [head] = check(
      await owner
        .from("fee_heads")
        .insert({ hostel_id: hostelId, name: "Mess", billing: "monthly", pricing: "flat" })
        .select("id"),
      "adding the mess charge",
    );
    check(
      await owner.rpc("set_fee_head_rate", {
        p_fee_head_id: head.id,
        p_amount: 250000,
        p_effective_from: monthStart(-12),
      }),
      "pricing the mess charge",
    );
  }

  const rate = check(
    await admin.from("electricity_rates").select("hostel_id").eq("hostel_id", hostelId),
    "reading the electricity rate",
  );
  if (rate.length === 0) {
    check(
      await owner.from("electricity_rates").insert({ hostel_id: hostelId, unit_rate: 900 }),
      "setting the electricity rate",
    );
  }

  const rule = check(
    await admin.from("late_fee_rules").select("hostel_id").eq("hostel_id", hostelId),
    "reading the late fee rule",
  );
  if (rule.length === 0) {
    check(
      await owner.from("late_fee_rules").insert({
        hostel_id: hostelId,
        grace_days: 5,
        kind: "fixed",
        amount: 20000,
      }),
      "setting the late fee rule",
    );
  }
}

/**
 * Meter readings for the three months before this one, for every room that
 * had someone in it. Each month's units follow on from the last.
 */
async function ensureMeterReadings(hostelId: string, owner: SupabaseClient) {
  const rooms = check(
    await admin
      .from("rooms")
      .select("id, room_number")
      .eq("hostel_id", hostelId)
      .order("room_number"),
    "reading rooms",
  );
  for (const [i, room] of rooms.entries()) {
    let closing = 1000 + i * 250;
    for (const offset of [-3, -2, -1]) {
      const month = monthStart(offset);
      const [read] = check(
        await admin
          .from("meter_readings")
          .select("closing")
          .eq("room_id", room.id)
          .eq("period_month", month)
          .is("voided_at", null),
        "reading meter readings",
      );
      if (read) {
        closing = Number(read.closing);
        continue;
      }
      const missing = check(
        await owner.rpc("missing_meter_readings", { p_hostel_id: hostelId, p_period_month: month }),
        "finding rooms to read",
      );
      if (!missing.some((row: { room_id: string }) => row.room_id === room.id)) continue;
      const opening = closing;
      closing = opening + 40 + ((i * 37 + offset * 11) % 90);
      check(
        await owner.rpc("record_meter_reading", {
          p_room_id: room.id,
          p_period_month: month,
          p_opening: opening,
          p_closing: closing,
        }),
        `reading room ${room.room_number}`,
      );
    }
  }
}

/** Deposits for most residents, a pending cheque, and today's late fees. */
async function ensureMoneyExtras(hostelId: string, owner: SupabaseClient) {
  const residents = check(
    await admin
      .from("residents")
      .select("id")
      .eq("hostel_id", hostelId)
      .eq("status", "active")
      .order("full_name"),
    "reading residents",
  );
  for (const [i, resident] of residents.entries()) {
    if (i % 5 === 4) continue;
    const held = check(
      await admin.from("deposit_ledger").select("id").eq("resident_id", resident.id).limit(1),
      "reading deposits",
    );
    if (held.length > 0) continue;
    check(
      await owner.rpc("record_deposit", {
        p_resident_id: resident.id,
        p_amount: 1000000,
        p_paid_at: monthStart(-2),
        p_mode: i % 2 === 0 ? "bank_transfer" : "upi",
      }),
      "recording a deposit",
    );
  }

  const pending = check(
    await admin.from("pending_cheques").select("id").eq("hostel_id", hostelId),
    "reading pending cheques",
  );
  if (pending.length === 0) {
    const [open] = check(
      await admin
        .from("invoice_balances")
        .select("id, balance, pending_cheques")
        .eq("hostel_id", hostelId)
        .eq("period_month", monthStart(0))
        .eq("status", "issued")
        .gt("balance", 0)
        .order("resident_name")
        .limit(1),
      "finding an invoice for a cheque",
    );
    if (open) {
      check(
        await owner.rpc("record_cheque", {
          p_invoice_id: open.id!,
          p_amount: open.balance! - open.pending_cheques!,
          p_paid_at: today,
          p_cheque_number: "004127",
          p_bank: "Canara Bank",
        }),
        "recording a cheque",
      );
    }
  }

  check(await owner.rpc("apply_late_fees", { p_hostel_id: hostelId }), "applying late fees");
}

// ---------------------------------------------------------------------------

const ownerId = await ensureUser(OWNER.email, OWNER.fullName);
const hostelId = await ensureHostel(ownerId);
const staffId = await ensureUser(STAFF.email, STAFF.fullName);
check(
  await admin.from("profiles").update({ role: "staff", hostel_id: hostelId }).eq("id", staffId),
  "making the warden staff",
);

await ensureInventory(hostelId);
await ensureResidents(hostelId, ownerId);

const ownerClient = createClient(url, anonKey, options);
check(
  await ownerClient.auth.signInWithPassword({ email: OWNER.email, password: PASSWORD }),
  "signing in as the owner",
);
await ensureFeeSetup(hostelId, ownerClient);
await ensureMeterReadings(hostelId, ownerClient);
await ensureBilling(hostelId, ownerClient);
await ensureMoneyExtras(hostelId, ownerClient);

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
  Password for both: ${PASSWORD}

Sign in at http://localhost:3000/login
`);
