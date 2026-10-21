import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import { logUnexpected } from "@/lib/request-context";
import { createAdminClient } from "@/lib/supabase/admin";
import type { Database } from "@/types/database";

import { detectComplaintMedia, PHOTO_MAX_BYTES, VIDEO_MAX_BYTES } from "./media";

export const MEDIA_BUCKET = "complaint-media";
/** Signed URLs for complaint files: long enough to open, not to share. */
export const MEDIA_URL_SECONDS = 120;

const LIMIT_MESSAGE = "Up to 5 photos and 1 video can be added.";

/**
 * Stores one complaint photo or video (ClickUp EP-15 T5) under
 * <hostel>/<complaint>/ and records it. The file's real type is read from its
 * bytes. `client` is the member's own client (Storage and the table check
 * access) or, for a job link already checked, the service-role client.
 */
export async function storeComplaintMedia(
  client: SupabaseClient<Database>,
  input: {
    hostelId: string;
    complaintId: string;
    file: FormDataEntryValue | null;
    stage: "report" | "completion";
    viaJob: boolean;
  },
): Promise<{ ok: true } | { ok: false; error: string; status: number }> {
  const { file } = input;
  if (!(file instanceof File) || file.size === 0) {
    return { ok: false, error: "Choose a photo or video.", status: 400 };
  }
  const bytes = new Uint8Array(await file.arrayBuffer());
  const type = detectComplaintMedia(bytes.subarray(0, 16));
  if (!type)
    return {
      ok: false,
      error: "Add a JPG, PNG or WebP photo, or an MP4 or WebM video.",
      status: 400,
    };
  if (bytes.length > (type.video ? VIDEO_MAX_BYTES : PHOTO_MAX_BYTES)) {
    return {
      ok: false,
      error: type.video ? "Videos must be 20 MB or smaller." : "Photos must be 5 MB or smaller.",
      status: 400,
    };
  }

  const path = `${input.hostelId}/${input.complaintId}/${crypto.randomUUID()}.${type.ext}`;
  const upload = await client.storage
    .from(MEDIA_BUCKET)
    .upload(path, bytes, { contentType: type.mime, upsert: false });
  if (upload.error) {
    await logUnexpected("storeComplaintMedia", upload.error);
    return { ok: false, error: "The file could not be uploaded. Try again.", status: 500 };
  }
  const { error } = await client.from("complaint_attachments").insert({
    hostel_id: input.hostelId,
    complaint_id: input.complaintId,
    path,
    mime_type: type.mime,
    size_bytes: bytes.length,
    stage: input.stage,
    ...(input.viaJob ? { via_job: true } : {}),
  });
  if (error) {
    // Members cannot delete files, so the orphan is removed with the service role.
    await createAdminClient().storage.from(MEDIA_BUCKET).remove([path]);
    if (error.hint === "attachment_limit") return { ok: false, error: LIMIT_MESSAGE, status: 409 };
    await logUnexpected("storeComplaintMedia", error);
    return { ok: false, error: "The file could not be saved. Try again.", status: 500 };
  }
  return { ok: true };
}
