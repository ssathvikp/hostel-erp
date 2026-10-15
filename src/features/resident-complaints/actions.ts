"use server";

import { randomUUID } from "node:crypto";

import type { PostgrestError } from "@supabase/supabase-js";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { after } from "next/server";
import { z } from "zod";

import { checkComplaintFile } from "@/lib/complaints/file-type";
import { deliverOutboxQuietly } from "@/lib/outbox/deliver";
import { logUnexpected, unexpectedFailure } from "@/lib/request-context";
import { smsProvider } from "@/lib/sms/provider";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  formFailure,
  formSuccess,
  formValues,
  indianMobile,
  uuid,
  validateFormData,
  type FormState,
} from "@/lib/validation";

import { RESIDENT_COOKIE, isResidentToken, isRoomToken, isStatusToken } from "./tokens";

/**
 * What a resident does from their room's QR code (E15-T3) and status link
 * (E15-T4). There is no account: the room token says where, the one-time
 * code proves who, and the database checks both again on every call. Every
 * refusal that could reveal whether a number lives in a room reads exactly
 * like success.
 */

const NOT_AVAILABLE =
  "Reporting from your room is not available right now. Please tell the warden or the hostel office.";
const CODE_SENT =
  "If this number belongs to a resident of this room, we have sent a code to it by SMS. It expires in 10 minutes.";
const CODE_WRONG = "That code is not right or has expired. Check it, or ask for a new one.";
const BUCKET = "complaint-files";
const MAX_PHOTOS = 5;

const RULE_MESSAGES: Record<string, string> = {
  resident_session: "Your session has ended. Scan the code in your room again.",
  complaint_description: "Describe the problem in a few words.",
  complaint_category: "Choose what the problem is about.",
  resident_complaint_limit:
    "You have reported several problems today. For anything else, please tell the hostel office.",
  resident_status: "This link no longer works.",
  complaint_not_resolved: "This complaint is not waiting for your answer.",
  reason_required: "Tell us what is still wrong.",
  rating_range: "Rate from 1 to 5.",
};

async function failure(action: string, error: PostgrestError, values?: Record<string, string>) {
  const message = error.code === "P0001" && error.hint ? RULE_MESSAGES[error.hint] : undefined;
  return message ? formFailure(message, values) : unexpectedFailure(action, error, values);
}

// ---------------------------------------------------------------------------
// Proving who you are
// ---------------------------------------------------------------------------

const phoneSchema = z.object({ token: z.string(), phone: indianMobile });

export type CodeState = FormState & { phone?: string };

export async function requestResidentCode(
  _previous: CodeState,
  formData: FormData,
): Promise<CodeState> {
  const values = formValues(formData, ["phone"]);
  const parsed = validateFormData(phoneSchema, formData);
  if (!parsed.ok) return formFailure(undefined, values, parsed.fieldErrors);
  if (!isRoomToken(parsed.data.token)) return formFailure(NOT_AVAILABLE, values);
  const sms = smsProvider();
  if (!sms) return formFailure(NOT_AVAILABLE, values);

  const admin = createAdminClient();
  const { data, error } = await admin.rpc("resident_request_code", {
    p_token: parsed.data.token,
    p_phone: parsed.data.phone,
  });
  if (error) return unexpectedFailure("requestResidentCode", error, values);

  const issued = data as {
    code: string;
    phone: string;
    hostel_id: string;
    hostel_name: string;
  } | null;
  if (issued) {
    try {
      const { id } = await sms.send({
        to: issued.phone,
        kind: "resident_code",
        variables: [issued.code, issued.hostel_name.slice(0, 30)],
      });
      // Kept for the record without the code itself.
      await admin.from("sms_outbox").insert({
        hostel_id: issued.hostel_id,
        to_phone: issued.phone,
        kind: "resident_code",
        variables: ["******", issued.hostel_name.slice(0, 30)],
        preview: "One-time code",
        sent_at: new Date().toISOString(),
        attempts: 1,
        provider_id: id,
      });
    } catch (sendError) {
      await logUnexpected("requestResidentCode:send", sendError);
      return formFailure("The code could not be sent just now. Try again in a minute.", values);
    }
  }
  return { ...formSuccess(CODE_SENT), phone: parsed.data.phone };
}

const verifySchema = z.object({
  token: z.string(),
  phone: indianMobile,
  code: z
    .string()
    .trim()
    .regex(/^\d{6}$/, { error: "Enter the 6-digit code" }),
});

export async function verifyResidentCode(
  _previous: CodeState,
  formData: FormData,
): Promise<CodeState> {
  const values = formValues(formData, ["phone"]);
  const parsed = validateFormData(verifySchema, formData);
  if (!parsed.ok)
    return { ...formFailure(undefined, values, parsed.fieldErrors), phone: values.phone };
  if (!isRoomToken(parsed.data.token)) return formFailure(NOT_AVAILABLE, values);

  const { data: session, error } = await createAdminClient().rpc("resident_verify_code", {
    p_token: parsed.data.token,
    p_phone: parsed.data.phone,
    p_code: parsed.data.code,
  });
  if (error) return unexpectedFailure("verifyResidentCode", error, values);
  if (!session) return { ...formFailure(CODE_WRONG, values), phone: parsed.data.phone };

  (await cookies()).set(RESIDENT_COOKIE, session, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/r",
    maxAge: 2 * 60 * 60,
  });
  redirect(`/r/${parsed.data.token}`);
}

// ---------------------------------------------------------------------------
// Raising a complaint
// ---------------------------------------------------------------------------

const raiseSchema = z.object({
  token: z.string(),
  category_id: uuid("Category"),
  description: z
    .string({ error: "Describe the problem" })
    .trim()
    .min(5, { error: "Describe the problem in a few words" })
    .max(1000, { error: "Keep it under 1000 characters" }),
});

export async function raiseResidentComplaint(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  const values = formValues(formData, ["category_id", "description"]);
  const parsed = validateFormData(raiseSchema, formData);
  if (!parsed.ok) return formFailure(undefined, values, parsed.fieldErrors);
  const session = (await cookies()).get(RESIDENT_COOKIE)?.value;
  if (!session || !isResidentToken(session) || !isRoomToken(parsed.data.token)) {
    return formFailure(RULE_MESSAGES.resident_session, values);
  }

  // Check the photos before anything is saved.
  const photos = formData
    .getAll("photos")
    .filter((file): file is File => file instanceof File && file.size > 0);
  if (photos.length > MAX_PHOTOS) {
    return formFailure(undefined, values, { photos: [`Add at most ${MAX_PHOTOS} photos`] });
  }
  const checked = [];
  for (const photo of photos) {
    const bytes = new Uint8Array(await photo.arrayBuffer());
    const result = checkComplaintFile(bytes, { photosOnly: true });
    if (!result.ok) return formFailure(undefined, values, { photos: [result.error] });
    checked.push({ bytes, type: result.type });
  }

  const admin = createAdminClient();
  const { data, error } = await admin.rpc("resident_raise_complaint", {
    p_session: session,
    p_category_id: parsed.data.category_id,
    p_description: parsed.data.description,
  });
  if (error) return failure("raiseResidentComplaint", error, values);
  const raised = data as { id: string; number: number; status_token: string };

  if (checked.length > 0) {
    const { data: complaint } = await admin
      .from("complaints")
      .select("hostel_id")
      .eq("id", raised.id)
      .single();
    for (const photo of checked) {
      const path = `${complaint!.hostel_id}/${raised.id}/${randomUUID()}.${photo.type.ext}`;
      const upload = await admin.storage
        .from(BUCKET)
        .upload(path, photo.bytes, { contentType: photo.type.mime, upsert: false });
      if (upload.error) {
        await logUnexpected("raiseResidentComplaint:upload", upload.error);
        continue;
      }
      const recorded = await admin.rpc("resident_add_attachment", {
        p_session: session,
        p_complaint_id: raised.id,
        p_path: path,
      });
      if (recorded.error) {
        await admin.storage.from(BUCKET).remove([path]);
        await logUnexpected("raiseResidentComplaint:attach", recorded.error);
      }
    }
  }

  after(deliverOutboxQuietly);
  redirect(`/c/${raised.status_token}?raised=${raised.number}`);
}

export async function endResidentSession(): Promise<void> {
  (await cookies()).delete({ name: RESIDENT_COOKIE, path: "/r" });
}

// ---------------------------------------------------------------------------
// Confirming a fix (E15-T4)
// ---------------------------------------------------------------------------

const respondSchema = z.object({
  token: z.string(),
  complaint_id: uuid("Complaint"),
  fixed: z.enum(["yes", "no"]),
  rating: z
    .string()
    .optional()
    .transform((value) => (value ? Number(value) : null))
    .refine((value) => value === null || (Number.isInteger(value) && value >= 1 && value <= 5), {
      error: "Rate from 1 to 5",
    }),
  comment: z.string().trim().max(500, { error: "Keep it under 500 characters" }).optional(),
});

export async function respondToFix(_previous: FormState, formData: FormData): Promise<FormState> {
  const values = formValues(formData, ["comment", "rating"]);
  const parsed = validateFormData(respondSchema, formData);
  if (!parsed.ok) return formFailure(undefined, values, parsed.fieldErrors);
  if (!isStatusToken(parsed.data.token)) return formFailure(RULE_MESSAGES.resident_status);
  const fixed = parsed.data.fixed === "yes";
  if (!fixed && (parsed.data.comment ?? "").length < 3) {
    return formFailure(undefined, values, { comment: ["Tell us what is still wrong"] });
  }

  const { error } = await createAdminClient().rpc("resident_respond", {
    p_token: parsed.data.token,
    p_complaint_id: parsed.data.complaint_id,
    p_fixed: fixed,
    p_rating: (parsed.data.rating ?? null) as number,
    p_comment: parsed.data.comment ?? "",
  });
  if (error) return failure("respondToFix", error, values);
  after(deliverOutboxQuietly);
  return formSuccess(
    fixed ? "Thank you. The complaint is closed." : "Sorry it is not fixed. We have reopened it.",
  );
}
