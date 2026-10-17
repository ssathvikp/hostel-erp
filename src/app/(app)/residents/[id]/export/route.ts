import { NextResponse } from "next/server";

import { AuthorizationError } from "@/lib/auth/roles";
import { requireRole } from "@/lib/auth/session";
import { getHostelContext } from "@/lib/hostels/active";
import { logUnexpected } from "@/lib/request-context";
import { createClient } from "@/lib/supabase/server";
import { uuid } from "@/lib/validation";

/**
 * A copy of everything the hostel holds about one resident, as JSON
 * (DPDP Act, 2023: right to access). Owners only; every export is logged.
 * The ID fingerprint is left out: it identifies nobody on its own and is
 * useless outside this system.
 */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    await requireRole(["owner"]);
  } catch (error) {
    if (error instanceof AuthorizationError) {
      return new NextResponse("Only the hostel owner can export resident data.", { status: 403 });
    }
    throw error;
  }
  const { id } = await params;
  const hostelId = (await getHostelContext()).active?.id;
  if (!uuid("Resident").safeParse(id).success || !hostelId) {
    return new NextResponse("Not found", { status: 404 });
  }

  const supabase = await createClient();
  const { data: resident, error } = await supabase
    .from("residents")
    .select(
      "id, full_name, phone, alt_phone, email, gender, dob, id_proof_type, id_proof_last4, guardian_name, guardian_phone, permanent_address, joining_date, status, status_changed_at, notes, consent_at, erased_at, created_at, updated_at",
    )
    .eq("id", id)
    .eq("hostel_id", hostelId)
    .maybeSingle();
  if (error) throw error;
  if (!resident) return new NextResponse("Not found", { status: 404 });

  const [hostel, stays, invoices, deposits, reminders, log] = await Promise.all([
    supabase
      .from("hostels")
      .select("name, address, city, phone, email")
      .eq("id", hostelId)
      .single(),
    supabase
      .from("allocations")
      .select(
        "start_date, end_date, vacate_reason, rent_override, rooms(room_number), beds!allocations_bed_fkey(bed_label)",
      )
      .eq("resident_id", id)
      .order("start_date"),
    supabase
      .from("invoice_balances")
      .select("id, period_month, amount, paid, balance, due_date, status, due_status")
      .eq("resident_id", id)
      .order("period_month"),
    supabase
      .from("deposit_entries")
      .select("kind, amount, entry_date, mode, reference, reason, voided_at, void_reason")
      .eq("resident_id", id)
      .order("entry_date"),
    supabase
      .from("reminder_log")
      .select("kind, channel, amount, sent_at")
      .eq("resident_id", id)
      .order("sent_at"),
    supabase
      .from("data_rights_log")
      .select("action, reason, done_at")
      .eq("resident_id", id)
      .order("done_at"),
  ]);
  for (const result of [hostel, stays, invoices, deposits, reminders, log]) {
    if (result.error) throw result.error;
  }
  const payments = await supabase
    .from("payments")
    .select("invoice_id, amount, paid_at, mode, reference, voided_at, void_reason")
    .in(
      "invoice_id",
      (invoices.data ?? []).map((invoice) => invoice.id!),
    )
    .order("paid_at");
  if (payments.error) throw payments.error;

  const { error: logError } = await supabase
    .from("data_rights_log")
    .insert({ hostel_id: hostelId, resident_id: id, action: "export" });
  if (logError) {
    await logUnexpected("exportResident:log", logError);
    return new NextResponse("The export could not be recorded, so it was not made. Try again.", {
      status: 500,
    });
  }

  const body = {
    exported_at: new Date().toISOString(),
    note: "Personal data held about this resident by the hostel, under the Digital Personal Data Protection Act, 2023. Amounts are in paise (₹1 = 100 paise).",
    data_fiduciary: hostel.data,
    resident,
    stays: stays.data,
    invoices: invoices.data,
    payments: payments.data,
    security_deposit: deposits.data,
    reminders_sent: reminders.data,
    data_requests: log.data,
  };

  const name = resident.full_name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
  return new NextResponse(JSON.stringify(body, null, 2), {
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Content-Disposition": `attachment; filename="resident-${name || "data"}.json"`,
      "Cache-Control": "no-store",
    },
  });
}
