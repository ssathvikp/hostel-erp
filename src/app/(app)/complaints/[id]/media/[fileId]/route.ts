import { NextResponse, type NextRequest } from "next/server";

import { MEDIA_BUCKET, MEDIA_URL_SECONDS } from "@/features/complaints/media-server";
import { getSessionUser } from "@/lib/auth/session";
import { getHostelContext } from "@/lib/hostels/active";
import { createClient } from "@/lib/supabase/server";
import { uuid } from "@/lib/validation";

/**
 * Opens a complaint file through a short-lived signed URL. Storage signs it
 * only when the member's own session passes the bucket policies.
 */
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string; fileId: string }> },
) {
  const { id, fileId } = await params;
  const user = await getSessionUser();
  const hostelId = (await getHostelContext()).active?.id;
  if (
    !user ||
    !hostelId ||
    !uuid("Complaint").safeParse(id).success ||
    !uuid("File").safeParse(fileId).success
  ) {
    return new NextResponse("Not found", { status: 404 });
  }
  const supabase = await createClient();
  const { data: file } = await supabase
    .from("complaint_attachments")
    .select("path")
    .eq("id", fileId)
    .eq("complaint_id", id)
    .eq("hostel_id", hostelId)
    .maybeSingle();
  if (!file) return new NextResponse("Not found", { status: 404 });
  const { data, error } = await supabase.storage
    .from(MEDIA_BUCKET)
    .createSignedUrl(file.path, MEDIA_URL_SECONDS);
  if (error || !data) return new NextResponse("Not found", { status: 404 });
  const response = NextResponse.redirect(data.signedUrl);
  response.headers.set("Cache-Control", "no-store");
  return response;
}
