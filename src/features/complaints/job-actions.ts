"use server";

import type { PostgrestError } from "@supabase/supabase-js";
import { revalidatePath } from "next/cache";
import { after } from "next/server";

import { checkComplaintFile } from "@/lib/complaints/file-type";
import { deliverOutboxQuietly } from "@/lib/outbox/deliver";
import { logUnexpected, unexpectedFailure } from "@/lib/request-context";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  formFailure,
  formSuccess,
  formValues,
  jobActionSchema,
  validateFormData,
  type FormState,
} from "@/lib/validation";

import { isJobToken } from "./job";

const DEAD_LINK = "This job link no longer works. Ask the hostel for a new one.";
const BUCKET = "complaint-files";

const RULE_MESSAGES: Record<string, string> = {
  job_link_dead: DEAD_LINK,
  reason_required: "Say why you cannot take this job.",
  payment_amount: "Enter your charge in rupees.",
  complaint_finished: "This job is already finished.",
  attachment_limit: "This job already has as many photos as it can take.",
};

async function failure(action: string, error: PostgrestError, values?: Record<string, string>) {
  const message = error.code === "P0001" && error.hint ? (RULE_MESSAGES[error.hint] ?? null) : null;
  if (message) return formFailure(message, values);
  if (error.code === "P0001") return formFailure(`${error.message}.`, values);
  return unexpectedFailure(action, error, values);
}

const SUCCESS: Record<string, string> = {
  accept: "Thank you. The hostel knows you have taken the job.",
  decline: "Thank you for letting us know. The job will go to someone else.",
  on_the_way: "The hostel knows you are on the way.",
  start: "Marked as started.",
  done: "Marked as done. The hostel will check with the resident.",
};

/**
 * What a worker does from their job link (E15-T8). Every call carries the
 * token, which the database checks; the worker never signs in.
 */
export async function actOnJob(_previous: FormState, formData: FormData): Promise<FormState> {
  const values = formValues(formData, ["note", "charge"]);
  const token = formData.get("token");
  if (!isJobToken(token)) return formFailure(DEAD_LINK);
  const parsed = validateFormData(jobActionSchema, formData);
  if (!parsed.ok) return formFailure(undefined, values, parsed.fieldErrors);

  const admin = createAdminClient();
  const { error } = await admin.rpc("job_act", {
    p_token: token,
    p_action: parsed.data.action,
    p_note: parsed.data.note ?? undefined,
    p_charge: parsed.data.action === "done" ? (parsed.data.charge ?? undefined) : undefined,
  });
  if (error) return failure("actOnJob", error, values);

  revalidatePath(`/job/${token}`);
  revalidatePath("/complaints", "layout");
  // The worker's step may have queued an SMS to the resident (E15-T4).
  after(deliverOutboxQuietly);
  return formSuccess(SUCCESS[parsed.data.action]);
}

/** A completion photo from the worker, checked by real file type and size (E15-T5). */
export async function uploadJobPhoto(_previous: FormState, formData: FormData): Promise<FormState> {
  const token = formData.get("token");
  if (!isJobToken(token)) return formFailure(DEAD_LINK);
  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) {
    return formFailure(undefined, undefined, { file: ["Choose a photo"] });
  }
  const bytes = new Uint8Array(await file.arrayBuffer());
  const checked = checkComplaintFile(bytes, { photosOnly: true });
  if (!checked.ok) return formFailure(undefined, undefined, { file: [checked.error] });

  const admin = createAdminClient();
  // The folder comes from the link itself, never from the form.
  const { data: job, error: viewError } = await admin.rpc("job_view", { p_token: token });
  if (viewError) return unexpectedFailure("uploadJobPhoto", viewError);
  if (!job) return formFailure(DEAD_LINK);
  const { hostel_id, complaint_id } = job as { hostel_id: string; complaint_id: string };

  const path = `${hostel_id}/${complaint_id}/${crypto.randomUUID()}.${checked.type.ext}`;
  const { error: uploadError } = await admin.storage
    .from(BUCKET)
    .upload(path, bytes, { contentType: checked.type.mime, upsert: false });
  if (uploadError) {
    await logUnexpected("uploadJobPhoto", uploadError);
    return formFailure("The photo could not be uploaded. Try again.");
  }
  const { error } = await admin.rpc("job_add_attachment", { p_token: token, p_path: path });
  if (error) {
    await admin.storage.from(BUCKET).remove([path]);
    return failure("uploadJobPhoto", error);
  }

  revalidatePath(`/job/${token}`);
  revalidatePath(`/complaints/${complaint_id}`);
  return formSuccess("Photo added.");
}
