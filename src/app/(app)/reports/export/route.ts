import { NextResponse, type NextRequest } from "next/server";

import { getHostelContext } from "@/lib/hostels/active";
import { logUnexpected } from "@/lib/request-context";
import { createClient } from "@/lib/supabase/server";

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;

function badRequest(message: string) {
  return new NextResponse(message, { status: 400, headers: { "Content-Type": "text/plain" } });
}

/**
 * CSV exports (E13-T12): `?kind=collections&from=YYYY-MM-DD&to=YYYY-MM-DD`
 * or `?kind=register&month=YYYY-MM`. The database builds the whole file in
 * one call, so it is never cut at the API's row limit.
 */
export async function GET(request: NextRequest) {
  const { active } = await getHostelContext();
  if (!active) return new NextResponse("Not found", { status: 404 });

  const params = request.nextUrl.searchParams;
  const kind = params.get("kind");
  const supabase = await createClient();
  let result: { data: unknown; error: { message: string } | null };
  let filename: string;

  if (kind === "collections") {
    const from = params.get("from") ?? "";
    const to = params.get("to") ?? "";
    if (!ISO_DATE.test(from) || !ISO_DATE.test(to) || from > to) {
      return badRequest("Choose a start date on or before the end date.");
    }
    result = await supabase.rpc("collections_csv", {
      p_hostel_id: active.id,
      p_from: from,
      p_to: to,
    });
    filename = `collections-${from}-to-${to}.csv`;
  } else if (kind === "register") {
    const month = params.get("month") ?? "";
    if (!MONTH.test(month)) return badRequest("Choose a month.");
    result = await supabase.rpc("fee_register_csv", {
      p_hostel_id: active.id,
      p_month: `${month}-01`,
    });
    filename = `fee-register-${month}.csv`;
  } else {
    return badRequest("Unknown export.");
  }

  if (result.error) {
    await logUnexpected("exportReport", result.error);
    return new NextResponse("The export could not be made. Try again.", { status: 500 });
  }
  // A byte-order mark so spreadsheet apps read ₹ and names in UTF-8.
  return new NextResponse(`\uFEFF${result.data as string}`, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control": "no-store",
    },
  });
}
