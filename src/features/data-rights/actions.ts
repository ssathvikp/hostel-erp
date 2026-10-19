"use server";

import { revalidatePath } from "next/cache";

import { AuthorizationError } from "@/lib/auth/roles";
import { requireRole } from "@/lib/auth/session";
import { formHostel } from "@/lib/hostels/form";
import { logUnexpected, unexpectedFailure } from "@/lib/request-context";
import { createClient } from "@/lib/supabase/server";
import {
  formFailure,
  formSuccess,
  formValues,
  requiredText,
  uuid,
  validateFormData,
  type FormState,
} from "@/lib/validation";
import { z } from "zod";

const BUCKET = "id-proofs";

const ERASE_MESSAGES: Record<string, string> = {
  resident_not_found: "This resident could not be found. Refresh the page.",
  resident_erased: "This resident's details were already erased.",
  erase_reason_required: "Say why the details are being erased.",
  erase_not_vacated:
    "Only residents who have left can be erased. Vacate their bed and mark them vacated first.",
  erase_balance_due: "This resident still owes rent. Record or void what is due first.",
  erase_deposit_held: "A security deposit is still held. Record the refund or deduction first.",
  erase_pending_charges: "This resident has charges not yet billed. Bill or void them first.",
  erase_credit_held: "This resident has advance credit. Refund it or use it on an invoice first.",
};

/** Rules whose database message names the detail (here, the month to bill). */
const SELF_EXPLAINING: Record<string, (message: string) => string> = {
  erase_month_unbilled: (message) =>
    `${message}: generate that month's invoices in Fees, collect what is due, then erase.`,
};

function denied(error: unknown, values?: Record<string, string>): FormState {
  if (error instanceof AuthorizationError) return formFailure(error.message, values);
  throw error;
}

/** Records consent for a resident registered before consent was asked. */
export async function recordConsent(_previous: FormState, formData: FormData): Promise<FormState> {
  try {
    await requireRole(["owner", "staff"]);
  } catch (error) {
    return denied(error);
  }
  const id = uuid("Resident").safeParse(formData.get("resident_id"));
  const hostel = await formHostel(formData);
  if ("error" in hostel) return formFailure(hostel.error);
  const hostelId = hostel.id;
  if (!id.success) return formFailure("This resident could not be found.");

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("residents")
    .update({ consent_at: new Date().toISOString() })
    .eq("id", id.data)
    .eq("hostel_id", hostelId)
    .is("consent_at", null)
    .select("id");
  if (error) {
    if (error.hint === "resident_erased") return formFailure(ERASE_MESSAGES.resident_erased);
    return unexpectedFailure("recordConsent", error);
  }
  if (!data.length) return formFailure("Consent is already recorded. Refresh the page.");

  revalidatePath(`/residents/${id.data}`);
  return formSuccess("Consent recorded.");
}

const eraseSchema = z.object({
  resident_id: uuid("Resident"),
  reason: requiredText("Reason", 500),
});

/**
 * Erases a former resident's personal details at their request. The ID
 * proof file goes too. Money and stay records stay, under a pseudonym.
 */
export async function eraseResident(_previous: FormState, formData: FormData): Promise<FormState> {
  const values = formValues(formData, ["resident_id", "reason"]);
  try {
    await requireRole(["owner"]);
  } catch (error) {
    return denied(error, values);
  }
  const parsed = validateFormData(eraseSchema, formData);
  if (!parsed.ok) return formFailure(undefined, values, parsed.fieldErrors);

  const supabase = await createClient();
  const { data: before } = await supabase
    .from("residents")
    .select("id_proof_path")
    .eq("id", parsed.data.resident_id)
    .maybeSingle();

  const { error } = await supabase.rpc("erase_resident", {
    p_resident_id: parsed.data.resident_id,
    p_reason: parsed.data.reason,
  });
  if (error) {
    const message = error.hint
      ? (SELF_EXPLAINING[error.hint]?.(error.message) ?? ERASE_MESSAGES[error.hint])
      : undefined;
    return message
      ? formFailure(message, values)
      : unexpectedFailure("eraseResident", error, values);
  }

  if (before?.id_proof_path) {
    const { error: removeError } = await supabase.storage
      .from(BUCKET)
      .remove([before.id_proof_path]);
    // The record no longer points at it; log so the file can be removed by hand.
    if (removeError) await logUnexpected("eraseResident:removeIdProof", removeError);
  }

  revalidatePath("/residents", "layout");
  revalidatePath("/fees", "layout");
  return formSuccess("Personal details erased. Stays and payments are kept without them.");
}
