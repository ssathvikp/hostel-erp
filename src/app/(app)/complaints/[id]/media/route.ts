import { NextResponse, type NextRequest } from "next/server";

import { storeComplaintMedia } from "@/features/complaints/media-server";
import { getSessionUser } from "@/lib/auth/session";
import { getHostelContext } from "@/lib/hostels/active";
import { createClient } from "@/lib/supabase/server";
import { uuid } from "@/lib/validation";

/**
 * Adds a photo or video to a complaint (ClickUp EP-15 T5). A route rather
 * than a server action: videos are bigger than the action body limit.
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await getSessionUser();
  const hostelId = (await getHostelContext()).active?.id;
  if (!user || !hostelId || !uuid("Complaint").safeParse(id).success) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  const supabase = await createClient();
  const { data: complaint } = await supabase
    .from("complaints")
    .select("id")
    .eq("id", id)
    .eq("hostel_id", hostelId)
    .maybeSingle();
  if (!complaint) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const form = await request.formData();
  const result = await storeComplaintMedia(supabase, {
    hostelId,
    complaintId: id,
    file: form.get("file"),
    stage: form.get("stage") === "completion" ? "completion" : "report",
    viaJob: false,
  });
  return result.ok
    ? NextResponse.json({ ok: true })
    : NextResponse.json({ error: result.error }, { status: result.status });
}
