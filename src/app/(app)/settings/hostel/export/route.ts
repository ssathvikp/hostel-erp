import { NextResponse } from "next/server";

import { AuthorizationError } from "@/lib/auth/roles";
import { requireRole } from "@/lib/auth/session";
import { getHostelContext } from "@/lib/hostels/active";
import { fetchAll } from "@/lib/pagination";
import { createClient } from "@/lib/supabase/server";

/**
 * Everything the active hostel holds, as one JSON file (ClickUp E10-T10):
 * a backup for the owner, and their data to take with them. Owners only.
 * Every table is read in full, past the API's 1000-row cap. ID fingerprints
 * and file paths are left out: they mean nothing outside this system.
 */
export async function GET() {
  try {
    await requireRole(["owner"]);
  } catch (error) {
    if (error instanceof AuthorizationError) {
      return new NextResponse("Only the hostel owner can download the hostel's data.", {
        status: 403,
      });
    }
    throw error;
  }
  const hostelId = (await getHostelContext()).active?.id;
  if (!hostelId) return new NextResponse("Not found", { status: 404 });

  const supabase = await createClient();
  const all = (table: string, columns: string, order = "id") =>
    fetchAll((from, to) =>
      supabase
        // Table names here are fixed strings, never user input.
        .from(table as "rooms")
        .select(columns)
        .eq("hostel_id", hostelId)
        .order(order)
        .range(from, to),
    );

  const [hostel, rooms, beds, residents, stays, rates, invoices, payments, deposits] =
    await Promise.all([
      supabase
        .from("hostels")
        .select(
          "name, type, phone, alt_phone, email, address, city, state, pincode, gstin, floors, created_at",
        )
        .eq("id", hostelId)
        .single(),
      all("rooms", "id, floor, room_number, sharing_type, capacity, status, created_at"),
      all("beds", "id, room_id, bed_label, status, status_reason, archived_at"),
      all(
        "residents",
        "id, full_name, phone, alt_phone, email, gender, dob, id_proof_type, id_proof_last4, guardian_name, guardian_phone, permanent_address, joining_date, status, notes, consent_at, erased_at, created_at",
      ),
      all(
        "allocations",
        "id, resident_id, room_id, bed_id, start_date, end_date, vacate_reason, rent_override, created_at",
      ),
      all("fee_structures", "id, sharing_type, monthly_amount, effective_from, effective_to"),
      all(
        "invoices",
        "id, kind, late_fee_for, resident_id, allocation_id, period_month, amount, due_date, status, void_reason, breakdown, created_at",
      ),
      all(
        "payments",
        "id, invoice_id, amount, paid_at, mode, reference, recorded_by_name, voided_at, void_reason, created_at",
      ),
      all(
        "deposit_entries",
        "id, resident_id, allocation_id, kind, amount, entry_date, mode, reference, reason, voided_at, void_reason, created_at",
      ),
    ]);
  if (hostel.error) throw hostel.error;

  const body = {
    exported_at: new Date().toISOString(),
    note: "Everything this hostel holds in Hostel ERP. Amounts are in paise (₹1 = 100 paise); dates are in India time.",
    hostel: hostel.data,
    rooms,
    beds,
    residents,
    stays,
    rates,
    invoices,
    payments,
    security_deposits: deposits,
  };

  const name = hostel.data.name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
  return new NextResponse(JSON.stringify(body, null, 2), {
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Content-Disposition": `attachment; filename="hostel-${name || "data"}.json"`,
      "Cache-Control": "no-store",
    },
  });
}
