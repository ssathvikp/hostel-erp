import { NextResponse, type NextRequest } from "next/server";

import { DUE_STATUS_LABELS, invoiceLabel, PAYMENT_MODE_LABELS } from "@/features/fees/options";
import {
  getDiscounts,
  getFeeRegister,
  getMoneyIn,
  getOpenDues,
} from "@/features/fees/report-queries";
import { AGE_BUCKETS, ageBucket, csvRupees, reportPeriod, toCsv } from "@/features/fees/reports";
import { AuthorizationError } from "@/lib/auth/roles";
import { requireRole } from "@/lib/auth/session";
import { getHostelContext } from "@/lib/hostels/active";
import { daysBetween } from "@/lib/money";
import { createClient } from "@/lib/supabase/server";
import { todayIst } from "@/lib/validation";
import type { InvoiceDueStatus, InvoiceKind, PaymentMode } from "@/types";

const AGE_LABELS = Object.fromEntries(AGE_BUCKETS.map((bucket) => [bucket.key, bucket.label]));

/** The fee reports as CSV files (ClickUp E13-T12). Owners only. */
export async function GET(request: NextRequest) {
  try {
    await requireRole(["owner"]);
  } catch (error) {
    if (error instanceof AuthorizationError) {
      return new NextResponse("Only the hostel owner can download fee reports.", { status: 403 });
    }
    throw error;
  }
  const hostelId = (await getHostelContext()).active?.id;
  if (!hostelId) return new NextResponse("Not found", { status: 404 });

  const search = request.nextUrl.searchParams;
  const today = todayIst();
  const { from, to, month } = reportPeriod(
    {
      from: search.get("from") ?? undefined,
      to: search.get("to") ?? undefined,
      month: search.get("month") ?? undefined,
    },
    today,
  );
  const supabase = await createClient();
  const label = (row: { periodMonth: string; kind: string }) =>
    invoiceLabel({ periodMonth: row.periodMonth, kind: row.kind as InvoiceKind });
  const status = (value: string) => DUE_STATUS_LABELS[value as InvoiceDueStatus] ?? value;

  let name: string;
  let body: string;
  switch (search.get("report")) {
    case "collections": {
      const rows = (await getMoneyIn(supabase, hostelId, from, to)).sort(
        (a, b) => a.date.localeCompare(b.date) || a.collector.localeCompare(b.collector),
      );
      name = `money-in-${from}-to-${to}`;
      body = toCsv(
        ["Date", "Type", "Mode", "Collected by", "Amount (₹)"],
        rows.map((row) => [
          row.date,
          row.type === "advance" ? "Advance" : "Payment",
          PAYMENT_MODE_LABELS[row.mode as PaymentMode] ?? row.mode,
          row.collector,
          csvRupees(row.amount),
        ]),
      );
      break;
    }
    case "dues": {
      const rows = await getOpenDues(supabase, hostelId);
      name = `dues-${today}`;
      body = toCsv(
        [
          "Invoice number",
          "Invoice",
          "Resident",
          "Room",
          "Due date",
          "Days late",
          "Age",
          "Billed (₹)",
          "Paid (₹)",
          "Pending cheques (₹)",
          "Owed (₹)",
        ],
        rows.map((row) => [
          row.invoiceNumber,
          label(row),
          row.residentName,
          row.room,
          row.dueDate,
          Math.max(0, daysBetween(row.dueDate, today)),
          AGE_LABELS[ageBucket(row.dueDate, today)],
          csvRupees(row.amount),
          csvRupees(row.paid),
          csvRupees(row.pendingCheques),
          csvRupees(row.balance),
        ]),
      );
      break;
    }
    case "register": {
      const rows = await getFeeRegister(supabase, hostelId, month);
      name = `fee-register-${month.slice(0, 7)}`;
      body = toCsv(
        [
          "Invoice number",
          "Invoice",
          "Resident",
          "Room",
          "Due date",
          "Billed (₹)",
          "Paid (₹)",
          "Pending cheques (₹)",
          "Owed (₹)",
          "Status",
        ],
        rows.map((row) => [
          row.invoiceNumber,
          label(row),
          row.residentName,
          row.room,
          row.dueDate,
          csvRupees(row.amount),
          csvRupees(row.paid),
          csvRupees(row.pendingCheques),
          csvRupees(row.balance),
          status(row.dueStatus),
        ]),
      );
      break;
    }
    case "discounts": {
      const rows = await getDiscounts(supabase, hostelId, month);
      name = `discounts-${month.slice(0, 7)}`;
      body = toCsv(
        ["Invoice number", "Resident", "Discount", "Amount (₹)"],
        rows.map((row) => [
          row.invoiceNumber,
          row.residentName,
          row.description,
          csvRupees(row.amount),
        ]),
      );
      break;
    }
    default:
      return new NextResponse("Unknown report", { status: 400 });
  }

  return new NextResponse(body, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${name}.csv"`,
      "Cache-Control": "no-store",
    },
  });
}
