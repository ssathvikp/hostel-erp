import { NextResponse } from "next/server";

import { getSessionUser } from "@/lib/auth/session";
import { getHostelContext } from "@/lib/hostels/active";
import { logUnexpected } from "@/lib/request-context";
import { createClient } from "@/lib/supabase/server";

/**
 * Everything stored about the active hostel, as one JSON file (E10-T10).
 * Owners only; the database checks ownership again and records the export.
 */
export async function GET() {
  const user = await getSessionUser();
  const { active } = await getHostelContext();
  if (!user || user.role !== "owner" || !active) {
    return new NextResponse("Not found", { status: 404 });
  }

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("export_hostel_data", { p_hostel_id: active.id });
  if (error) {
    await logUnexpected("exportHostelData", error);
    return new NextResponse("The export could not be made. Try again.", { status: 500 });
  }
  const day = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" }).format(new Date());
  const slug = active.name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
  return new NextResponse(JSON.stringify(data, null, 2), {
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Content-Disposition": `attachment; filename="${slug || "hostel"}-data-${day}.json"`,
      "Cache-Control": "no-store",
    },
  });
}
