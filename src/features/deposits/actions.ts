"use server";

import type { PostgrestError } from "@supabase/supabase-js";
import { revalidatePath } from "next/cache";

import { AuthorizationError } from "@/lib/auth/roles";
import { requireRole } from "@/lib/auth/session";
import { formHostel } from "@/lib/hostels/form";
import { formatPaise } from "@/lib/money";
import { unexpectedFailure } from "@/lib/request-context";
import { createClient } from "@/lib/supabase/server";
import {
  depositEntrySchema,
  formFailure,
  formSuccess,
  formValues,
  validateFormData,
  voidSchema,
  type FormState,
} from "@/lib/validation";

import { DEPOSIT_KIND_LABELS } from "./options";

const FOREIGN_KEY_VIOLATION = "23503";
const ENTRY_FIELDS = [
  "resident_id",
  "kind",
  "amount",
  "entry_date",
  "mode",
  "reference",
  "reason",
] as const;
const VOID_FIELDS = ["id", "void_reason"] as const;

/** The rules the deposit ledger enforces, raised as P0001 with a hint. */
const RULE_MESSAGES: Record<string, string> = {
  deposit_future: "The date cannot be in the future.",
  deposit_void: "This entry is already void. Refresh the page.",
  deposit_immutable: "Deposit entries cannot be edited. Void it and record it again.",
  deposit_in_use:
    "Refunds or deductions have been taken from this deposit. Void those first, then the collection.",
};

function ruleMessage(error: PostgrestError): string | null {
  if (error.code !== "P0001" || !error.hint) return null;
  return RULE_MESSAGES[error.hint] ?? null;
}

function authorizationFailure(error: unknown, values?: Record<string, string>): FormState {
  if (error instanceof AuthorizationError) return formFailure(error.message, values);
  throw error;
}

function revalidateDeposits() {
  revalidatePath("/residents", "layout");
  revalidatePath("/dashboard");
}

/** Records money collected, kept or refunded. Owners and staff. */
export async function recordDepositEntry(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  const values = formValues(formData, ENTRY_FIELDS);
  try {
    await requireRole(["owner", "staff"]);
  } catch (error) {
    return authorizationFailure(error, values);
  }

  const parsed = validateFormData(depositEntrySchema, formData);
  if (!parsed.ok) return formFailure(undefined, values, parsed.fieldErrors);
  const hostel = await formHostel(formData);
  if ("error" in hostel) return formFailure(hostel.error, values);
  const hostelId = hostel.id;

  const supabase = await createClient();
  const { error } = await supabase
    .from("deposit_entries")
    .insert({ hostel_id: hostelId, ...parsed.data });
  if (error) {
    if (error.code === FOREIGN_KEY_VIOLATION) {
      return formFailure("This resident could not be found. Refresh the page.", values);
    }
    if (error.hint === "deposit_exceeds_held") {
      return formFailure(undefined, values, { amount: [`${error.message}.`] });
    }
    const message = ruleMessage(error);
    return message
      ? formFailure(message, values)
      : unexpectedFailure("recordDepositEntry", error, values);
  }

  revalidateDeposits();
  return formSuccess(
    `${DEPOSIT_KIND_LABELS[parsed.data.kind]} ${formatPaise(parsed.data.amount)} recorded.`,
  );
}

/** Voids a mistaken entry with a reason. Owners only. */
export async function voidDepositEntry(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  const values = formValues(formData, VOID_FIELDS);
  try {
    await requireRole(["owner"]);
  } catch (error) {
    return authorizationFailure(error, values);
  }

  const parsed = validateFormData(voidSchema, formData);
  if (!parsed.ok) return formFailure(undefined, values, parsed.fieldErrors);
  const hostel = await formHostel(formData);
  if ("error" in hostel) return formFailure(hostel.error, values);
  const hostelId = hostel.id;

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("deposit_entries")
    .update({ void_reason: parsed.data.void_reason })
    .eq("id", parsed.data.id)
    .eq("hostel_id", hostelId)
    .select("id");
  if (error) {
    const message = ruleMessage(error);
    return message
      ? formFailure(message, values)
      : unexpectedFailure("voidDepositEntry", error, values);
  }
  if (!data?.length) return formFailure("This entry could not be found. Refresh the page.", values);

  revalidateDeposits();
  return formSuccess("Entry voided. It no longer counts towards the deposit.");
}
