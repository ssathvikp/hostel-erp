import { NextResponse, type NextRequest } from "next/server";

import { storeComplaintMedia } from "@/features/complaints/media-server";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

/**
 * A worker adds photos of the fix through their job link (ClickUp EP-15 T8).
 * The link is checked first; only then is the file stored, with the service
 * role, under that one job.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ token: string }> },
) {
  const { token } = await params;
  const supabase = await createClient();
  const { data } = await supabase.rpc("job_view", { p_token: token });
  const job = data as { complaint_id: string; hostel_id: string } | null;
  if (!job) return NextResponse.json({ error: "This job link no longer works." }, { status: 404 });

  const form = await request.formData();
  const result = await storeComplaintMedia(createAdminClient(), {
    hostelId: job.hostel_id,
    complaintId: job.complaint_id,
    file: form.get("file"),
    stage: "completion",
    viaJob: true,
  });
  return result.ok
    ? NextResponse.json({ ok: true })
    : NextResponse.json({ error: result.error }, { status: result.status });
}
