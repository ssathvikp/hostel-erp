"use server";

import { revalidatePath } from "next/cache";

import { AuthorizationError } from "@/lib/auth/roles";
import { requireRole } from "@/lib/auth/session";
import { formHostel } from "@/lib/hostels/form";
import { unexpectedFailure } from "@/lib/request-context";
import { createClient } from "@/lib/supabase/server";
import {
  formFailure,
  formSuccess,
  formValues,
  settlementSchema,
  uuid,
  validateFormData,
  type FormState,
} from "@/lib/validation";

const FIELDS = [
  "deduction_amount_1",
  "deduction_reason_1",
  "deduction_amount_2",
  "deduction_reason_2",
  "deduction_amount_3",
  "deduction_reason_3",
  "rebill",
  "use_deposit",
  "refund_mode",
  "refund_reference",
] as const;

const RULE_MESSAGES: Record<string, string> = {
  allocation_not_found: "This stay could not be found. Refresh the page.",
  allocation_open: "Vacate the bed before settling the move-out.",
  allocation_transferred: "The resident moved to another bed. Settle when they leave.",
  already_settled: "This stay is already settled. Refresh the page to see the statement.",
  refund_mode: "Choose how the refund is paid.",
  deposit_exceeds_held: "The deductions are more than the deposit held.",
  deduction_invalid: "Each deduction needs an amount and a reason.",
};

/** Settles a closed stay (ClickUp E13-T8). Owners only. */
export async function settleMoveOut(_previous: FormState, formData: FormData): Promise<FormState> {
  const values = formValues(formData, FIELDS);
  try {
    await requireRole(["owner"]);
  } catch (error) {
    if (error instanceof AuthorizationError) return formFailure(error.message, values);
    throw error;
  }
  const parsed = validateFormData(settlementSchema, formData);
  if (!parsed.ok) return formFailure(undefined, values, parsed.fieldErrors);
  const hostel = await formHostel(formData);
  if ("error" in hostel) return formFailure(hostel.error, values);

  const supabase = await createClient();
  const { error } = await supabase.rpc("settle_move_out", {
    p_allocation_id: parsed.data.allocation_id,
    p_deductions: parsed.data.deductions,
    p_rebill: parsed.data.rebill,
    p_use_deposit: parsed.data.use_deposit,
    p_refund_mode: parsed.data.refund_mode ?? undefined,
    p_refund_reference: parsed.data.refund_reference ?? undefined,
  });
  if (error) {
    const message = error.code === "P0001" && error.hint ? RULE_MESSAGES[error.hint] : undefined;
    if (message) return formFailure(message, values);
    if (error.code === "42501")
      return formFailure("Only the hostel owner can settle a move-out.", values);
    return unexpectedFailure("settleMoveOut", error, values);
  }

  const resident = uuid("Resident").safeParse(formData.get("resident_id"));
  if (resident.success) revalidatePath(`/residents/${resident.data}`, "layout");
  revalidatePath("/fees");
  revalidatePath("/dashboard");
  return formSuccess("Move-out settled.");
}
