"use server";

import type { PostgrestError } from "@supabase/supabase-js";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { AuthorizationError } from "@/lib/auth/roles";
import { requireRole } from "@/lib/auth/session";
import { getHostelContext } from "@/lib/hostels/active";
import { detectIdProofType } from "@/lib/residents/file-type";
import { protectIdProof } from "@/lib/residents/id-proof";
import { logUnexpected, unexpectedFailure } from "@/lib/request-context";
import { createClient } from "@/lib/supabase/server";
import {
  formFailure,
  formSuccess,
  formValues,
  residentSchema,
  residentStatusSchema,
  residentUpdateSchema,
  uuid,
  validateFormData,
  type FormState,
} from "@/lib/validation";
import type { ResidentStatus } from "@/types";

import { ID_PROOF_MAX_BYTES, RESIDENT_STATUS_LABELS } from "./options";

const NO_HOSTEL = "Finish setting up your hostel first.";
const NOT_FOUND = "This resident could not be found.";
const BUCKET = "id-proofs";

/** Everything the registration form echoes back. The ID number is never echoed. */
const CREATE_FIELDS = [
  "full_name",
  "phone",
  "alt_phone",
  "email",
  "gender",
  "dob",
  "id_proof_type",
  "guardian_name",
  "guardian_phone",
  "permanent_address",
  "joining_date",
  "notes",
] as const;
const UPDATE_FIELDS = [
  "phone",
  "alt_phone",
  "email",
  "guardian_name",
  "guardian_phone",
  "permanent_address",
  "notes",
] as const;

const RULE_MESSAGES: Record<string, string> = {
  resident_status_transition:
    "That status change is not allowed from the resident's current status.",
  resident_has_allocation:
    "This resident still holds a bed. Vacate the bed first, then mark the resident as vacated.",
};

/** A form state that can point at an existing record instead of creating a duplicate. */
export interface ResidentFormState extends FormState {
  existing?: { id: string; name: string; match: "phone" | "id_proof" };
}

function authorizationFailure(error: unknown, values?: Record<string, string>): FormState {
  if (error instanceof AuthorizationError) return formFailure(error.message, values);
  throw error;
}

async function activeHostelId(): Promise<string | null> {
  return (await getHostelContext()).active?.id ?? null;
}

function ruleMessage(error: PostgrestError): string | null {
  return error.code === "P0001" && error.hint ? (RULE_MESSAGES[error.hint] ?? null) : null;
}

/** A rule the user can act on, or a logged failure with the generic message. */
async function failure(action: string, error: PostgrestError, values?: Record<string, string>) {
  const message = ruleMessage(error);
  return message ? formFailure(message, values) : unexpectedFailure(action, error, values);
}

/** Which unique key a duplicate insert or update hit, if any. */
function duplicateKind(error: PostgrestError): "phone" | "id_proof" | null {
  if (error.code !== "23505") return null;
  if (error.message.includes("residents_hostel_phone_key")) return "phone";
  if (error.message.includes("residents_hostel_id_proof_key")) return "id_proof";
  return null;
}

// ---------------------------------------------------------------------------
// Registration (E5-T2, E5-T3)
// ---------------------------------------------------------------------------

export async function registerResident(
  _previous: ResidentFormState,
  formData: FormData,
): Promise<ResidentFormState> {
  const values = formValues(formData, CREATE_FIELDS);
  try {
    await requireRole(["owner", "staff"]);
  } catch (error) {
    return authorizationFailure(error, values);
  }

  const parsed = validateFormData(residentSchema, formData);
  if (!parsed.ok) return formFailure(undefined, values, parsed.fieldErrors);

  const hostelId = await activeHostelId();
  if (!hostelId) return formFailure(NO_HOSTEL, values);

  // The full ID number goes no further than this line.
  const { id_proof_number, id_proof_type, ...resident } = parsed.data;
  const fingerprint = protectIdProof(id_proof_type, id_proof_number);

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("residents")
    .insert({ ...resident, ...fingerprint, hostel_id: hostelId })
    .select("id")
    .single();

  if (error) {
    const kind = duplicateKind(error);
    if (kind) {
      // Offer the existing record instead of inserting a second one.
      let lookup = supabase.from("residents").select("id, full_name").eq("hostel_id", hostelId);
      lookup =
        kind === "phone"
          ? lookup.eq("phone", resident.phone)
          : lookup
              .eq("id_proof_type", fingerprint.id_proof_type)
              .eq("id_proof_hash", fingerprint.id_proof_hash);
      const { data: existing } = await lookup.maybeSingle();
      const message =
        kind === "phone"
          ? "A resident with this phone number is already registered."
          : "A resident with this ID proof is already registered.";
      return {
        ...formFailure(undefined, values, {
          [kind === "phone" ? "phone" : "id_proof_number"]: [message],
        }),
        existing: existing ? { id: existing.id, name: existing.full_name, match: kind } : undefined,
      };
    }
    return unexpectedFailure("registerResident", error, values);
  }

  revalidatePath("/residents");
  redirect(`/residents/${data.id}?registered=1`);
}

// ---------------------------------------------------------------------------
// Editing (E5-T2)
// ---------------------------------------------------------------------------

function residentIdFrom(formData: FormData): string | null {
  const parsed = uuid("Resident").safeParse(formData.get("resident_id"));
  return parsed.success ? parsed.data : null;
}

export async function updateResident(
  _previous: ResidentFormState,
  formData: FormData,
): Promise<ResidentFormState> {
  const values = formValues(formData, UPDATE_FIELDS);
  try {
    await requireRole(["owner", "staff"]);
  } catch (error) {
    return authorizationFailure(error, values);
  }

  const residentId = residentIdFrom(formData);
  if (!residentId) return formFailure(NOT_FOUND, values);

  const parsed = validateFormData(residentUpdateSchema, formData);
  if (!parsed.ok) return formFailure(undefined, values, parsed.fieldErrors);

  const hostelId = await activeHostelId();
  if (!hostelId) return formFailure(NO_HOSTEL, values);

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("residents")
    .update(parsed.data)
    .eq("id", residentId)
    .eq("hostel_id", hostelId)
    .select("id")
    .maybeSingle();

  if (error) {
    if (duplicateKind(error) === "phone") {
      const { data: existing } = await supabase
        .from("residents")
        .select("id, full_name")
        .eq("hostel_id", hostelId)
        .eq("phone", parsed.data.phone)
        .maybeSingle();
      return {
        ...formFailure(undefined, values, {
          phone: ["Another resident already uses this phone number."],
        }),
        existing: existing
          ? { id: existing.id, name: existing.full_name, match: "phone" }
          : undefined,
      };
    }
    return unexpectedFailure("updateResident", error, values);
  }
  if (!data) return formFailure(NOT_FOUND, values);

  revalidatePath("/residents");
  redirect(`/residents/${residentId}?updated=1`);
}

// ---------------------------------------------------------------------------
// Status lifecycle (E5-T6)
// ---------------------------------------------------------------------------

export async function changeResidentStatus(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  try {
    await requireRole(["owner", "staff"]);
  } catch (error) {
    return authorizationFailure(error);
  }

  const parsed = validateFormData(residentStatusSchema, formData);
  if (!parsed.ok) return formFailure(NOT_FOUND);

  const hostelId = await activeHostelId();
  if (!hostelId) return formFailure(NO_HOSTEL);

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("residents")
    .update({ status: parsed.data.status })
    .eq("id", parsed.data.resident_id)
    .eq("hostel_id", hostelId)
    .select("full_name, status")
    .maybeSingle();

  if (error) return failure("changeResidentStatus", error);
  if (!data) return formFailure(NOT_FOUND);

  revalidatePath("/residents");
  revalidatePath(`/residents/${parsed.data.resident_id}`);
  return formSuccess(
    `${data.full_name} is now ${RESIDENT_STATUS_LABELS[data.status as ResidentStatus].toLowerCase()}.`,
  );
}

// ---------------------------------------------------------------------------
// ID proof upload (E5-T7)
// ---------------------------------------------------------------------------

export async function uploadIdProof(_previous: FormState, formData: FormData): Promise<FormState> {
  try {
    await requireRole(["owner", "staff"]);
  } catch (error) {
    return authorizationFailure(error);
  }

  const residentId = residentIdFrom(formData);
  const hostelId = await activeHostelId();
  if (!residentId || !hostelId) return formFailure(NOT_FOUND);

  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) {
    return formFailure(undefined, undefined, { file: ["Choose a file to upload"] });
  }
  if (file.size > ID_PROOF_MAX_BYTES) {
    return formFailure(undefined, undefined, { file: ["The file must be 5 MB or smaller"] });
  }
  const bytes = new Uint8Array(await file.arrayBuffer());
  const type = detectIdProofType(bytes.subarray(0, 8));
  if (!type) {
    return formFailure(undefined, undefined, { file: ["Upload a PDF, JPG or PNG file"] });
  }

  const supabase = await createClient();
  const { data: resident, error: readError } = await supabase
    .from("residents")
    .select("id_proof_path")
    .eq("id", residentId)
    .eq("hostel_id", hostelId)
    .maybeSingle();
  if (readError) return unexpectedFailure("uploadIdProof", readError);
  if (!resident) return formFailure(NOT_FOUND);

  // Storage policies only accept <hostel>/<resident>/... for a resident of a
  // hostel the user belongs to.
  const path = `${hostelId}/${residentId}/${crypto.randomUUID()}.${type.ext}`;
  const { error: uploadError } = await supabase.storage
    .from(BUCKET)
    .upload(path, bytes, { contentType: type.mime, upsert: false });
  if (uploadError) {
    await logUnexpected("uploadIdProof", uploadError);
    return formFailure("The file could not be uploaded. Try again.");
  }

  const { error: updateError } = await supabase
    .from("residents")
    .update({ id_proof_path: path })
    .eq("id", residentId)
    .eq("hostel_id", hostelId);
  if (updateError) {
    await supabase.storage.from(BUCKET).remove([path]);
    return unexpectedFailure("uploadIdProof", updateError);
  }

  // The previous copy is replaced, not kept: one current document per resident.
  if (resident.id_proof_path) await supabase.storage.from(BUCKET).remove([resident.id_proof_path]);

  revalidatePath(`/residents/${residentId}`);
  return formSuccess("ID proof uploaded.");
}
