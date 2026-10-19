"use server";

import type { PostgrestError } from "@supabase/supabase-js";
import { revalidatePath } from "next/cache";
import { z } from "zod";

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
  optional,
  rupees,
  validateFormData,
  voidSchema,
  type FormState,
} from "@/lib/validation";
import { SHARING_TYPES } from "@/types";

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
  resident_erased: "This resident's details were erased, so no new deposit entries can be added.",
  reference_other_resident: "That stay belongs to another resident. Refresh the page.",
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

/** The usual deposit per sharing type; blank removes it (ClickUp E13-T4). Owners only. */
export async function saveDepositRates(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  const values = formValues(
    formData,
    SHARING_TYPES.map((type) => `deposit_${type}`),
  );
  try {
    await requireRole(["owner"]);
  } catch (error) {
    return authorizationFailure(error, values);
  }
  const fields = Object.fromEntries(
    SHARING_TYPES.map((type) => [`deposit_${type}`, optional(rupees("Deposit"))]),
  );
  const parsed = validateFormData(z.object(fields), formData);
  if (!parsed.ok) return formFailure(undefined, values, parsed.fieldErrors);
  const hostel = await formHostel(formData);
  if ("error" in hostel) return formFailure(hostel.error, values);

  const supabase = await createClient();
  const rows = SHARING_TYPES.flatMap((type) => {
    const amount = parsed.data[`deposit_${type}`] as number | null;
    return amount ? [{ hostel_id: hostel.id, sharing_type: type, amount }] : [];
  });
  const cleared = SHARING_TYPES.filter((type) => !parsed.data[`deposit_${type}`]);
  if (rows.length > 0) {
    const { error } = await supabase
      .from("deposit_rates")
      .upsert(rows, { onConflict: "hostel_id,sharing_type" });
    if (error) return unexpectedFailure("saveDepositRates", error, values);
  }
  if (cleared.length > 0) {
    const { error } = await supabase
      .from("deposit_rates")
      .delete()
      .eq("hostel_id", hostel.id)
      .in("sharing_type", cleared);
    if (error) return unexpectedFailure("saveDepositRates", error, values);
  }
  revalidatePath("/settings/fees");
  revalidatePath("/residents", "layout");
  revalidatePath("/rooms", "layout");
  return formSuccess("Usual deposits saved.");
}
