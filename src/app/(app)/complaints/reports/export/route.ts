import { NextResponse, type NextRequest } from "next/server";

import {
  complaintNumber,
  PRIORITY_LABELS,
  STATUS_LABELS,
  type ComplaintStatus,
  type Priority,
} from "@/features/complaints/options";
import { whereLabel } from "@/features/complaints/queries";
import { reportPeriod, toCsv } from "@/features/fees/reports";
import { getSessionUser } from "@/lib/auth/session";
import { getHostelContext } from "@/lib/hostels/active";
import { fetchAll } from "@/lib/pagination";
import { createClient } from "@/lib/supabase/server";
import { todayIst } from "@/lib/validation";

const minutesBetween = (from: string, to: string | null) =>
  to ? Math.round((Date.parse(to) - Date.parse(from)) / 60000) : null;

/** Every complaint raised in the dates chosen, as CSV (ClickUp EP-15 T11). */
export async function GET(request: NextRequest) {
  const user = await getSessionUser();
  const hostelId = (await getHostelContext()).active?.id;
  if (!user || !hostelId) return new NextResponse("Not found", { status: 404 });
  const search = request.nextUrl.searchParams;
  const { from, to } = reportPeriod(
    { from: search.get("from") ?? undefined, to: search.get("to") ?? undefined },
    todayIst(),
  );
  const supabase = await createClient();
  // India dates, as UTC instants: from 00:00 IST on `from` to the end of `to`.
  const start = new Date(`${from}T00:00:00+05:30`).toISOString();
  const end = new Date(Date.parse(`${to}T00:00:00+05:30`) + 86_400_000).toISOString();
  const rows = await fetchAll((first, last) =>
    supabase
      .from("complaint_overview")
      .select(
        "number, created_at, kind, category_name, room_number, bed_label, area, resident_name, priority, title, status, worker_name, first_response_at, resolved_at, held_seconds",
      )
      .eq("hostel_id", hostelId)
      .gte("created_at", start)
      .lt("created_at", end)
      .order("created_at")
      .order("id")
      .range(first, last),
  );
  const ist = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" });
  const body = toCsv(
    [
      "Number",
      "Raised on",
      "Type",
      "Category",
      "Where",
      "Resident",
      "Priority",
      "What",
      "Status",
      "Worker",
      "Minutes to respond",
      "Minutes to fix",
    ],
    rows.map((row) => {
      const fix = minutesBetween(row.created_at!, row.resolved_at);
      return [
        complaintNumber(row.number ?? 0),
        ist.format(new Date(row.created_at!)),
        row.kind === "scheduled" ? "Scheduled" : "Reported",
        row.category_name,
        whereLabel(row),
        row.resident_name,
        PRIORITY_LABELS[row.priority as Priority],
        row.title,
        STATUS_LABELS[row.status as ComplaintStatus],
        row.worker_name,
        minutesBetween(row.created_at!, row.first_response_at),
        fix === null ? null : Math.max(0, fix - Math.round((row.held_seconds ?? 0) / 60)),
      ];
    }),
  );
  return new NextResponse(body, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="complaints-${from}-to-${to}.csv"`,
      "Cache-Control": "no-store",
    },
  });
}
