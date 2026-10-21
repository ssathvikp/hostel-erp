import { NextResponse, type NextRequest } from "next/server";

import { MEDIA_BUCKET, MEDIA_URL_SECONDS } from "@/features/complaints/media-server";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { uuid } from "@/lib/validation";

/** Opens one of the job's files for the worker holding a live job link. */
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ token: string; fileId: string }> },
) {
  const { token, fileId } = await params;
  if (!uuid("File").safeParse(fileId).success)
    return new NextResponse("Not found", { status: 404 });
  const supabase = await createClient();
  const { data } = await supabase.rpc("job_view", { p_token: token });
  const job = data as { complaint_id: string } | null;
  if (!job) return new NextResponse("Not found", { status: 404 });

  const admin = createAdminClient();
  const { data: file } = await admin
    .from("complaint_attachments")
    .select("path")
    .eq("id", fileId)
    .eq("complaint_id", job.complaint_id)
    .maybeSingle();
  if (!file) return new NextResponse("Not found", { status: 404 });
  const { data: signed } = await admin.storage
    .from(MEDIA_BUCKET)
    .createSignedUrl(file.path, MEDIA_URL_SECONDS);
  if (!signed) return new NextResponse("Not found", { status: 404 });
  const response = NextResponse.redirect(signed.signedUrl);
  response.headers.set("Cache-Control", "no-store");
  return response;
}
