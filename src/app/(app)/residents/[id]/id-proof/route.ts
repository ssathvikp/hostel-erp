import { NextResponse, type NextRequest } from "next/server";

import { getSessionUser } from "@/lib/auth/session";
import { getHostelContext } from "@/lib/hostels/active";
import { createClient } from "@/lib/supabase/server";
import { uuid } from "@/lib/validation";

/** Signed URLs for ID proofs expire quickly: long enough to open, not to share. */
const SIGNED_URL_SECONDS = 60;

/**
 * Opens a resident's ID proof through a short-lived signed URL (E5-T7). The
 * bucket is private; Storage only signs the URL when the user's own session
 * passes the bucket policies, so another hostel gets a 404 here.
 */
export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await getSessionUser();
  const hostelId = (await getHostelContext()).active?.id;
  if (!user || !hostelId || !uuid("Resident").safeParse(id).success) {
    return new NextResponse("Not found", { status: 404 });
  }

  const supabase = await createClient();
  const { data: resident } = await supabase
    .from("residents")
    .select("id_proof_path")
    .eq("id", id)
    .eq("hostel_id", hostelId)
    .maybeSingle();
  if (!resident?.id_proof_path) return new NextResponse("Not found", { status: 404 });

  const { data, error } = await supabase.storage
    .from("id-proofs")
    .createSignedUrl(resident.id_proof_path, SIGNED_URL_SECONDS);
  if (error || !data) return new NextResponse("Not found", { status: 404 });

  const response = NextResponse.redirect(data.signedUrl);
  response.headers.set("Cache-Control", "no-store");
  return response;
}
