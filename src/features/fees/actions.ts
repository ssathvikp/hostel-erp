"use server";

import type { PostgrestError } from "@supabase/supabase-js";
import { revalidatePath } from "next/cache";

import { AuthorizationError } from "@/lib/auth/roles";
import { requireRole } from "@/lib/auth/session";
import { formHostel } from "@/lib/hostels/form";
import { formatMonth, formatPaise } from "@/lib/money";
import { unexpectedFailure } from "@/lib/request-context";
import { createClient } from "@/lib/supabase/server";
import {
  feeStructureSchema,
  formFailure,
  formSuccess,
  formValues,
  generateInvoicesSchema,
  lateFeeRuleSchema,
  paymentSchema,
  voidSchema,
  validateFormData,
  type FormState,
} from "@/lib/validation";

const NO_HOSTEL = "Finish setting up your hostel first.";
const FOREIGN_KEY_VIOLATION = "23503";

const RATE_FIELDS = ["sharing_type", "monthly_amount", "effective_from"] as const;
const GENERATE_FIELDS = ["period_month", "due_day"] as const;
const PAYMENT_FIELDS = ["invoice_id", "amount", "paid_at", "mode", "reference"] as const;
const VOID_FIELDS = ["id", "void_reason"] as const;
const LATE_FEE_FIELDS = [
  "late_fee_mode",
  "late_fee_amount",
  "late_fee_cap",
  "late_fee_grace_days",
] as const;

/**
 * Plain-language messages for the rules the fee tables and functions
 * enforce. They raise P0001 with one of these hints. Overpayment and a
 * later rate are not listed: their database message already names the
 * amount or date.
 */
const RULE_MESSAGES: Record<string, string> = {
  billing_month: "Choose a month to bill.",
  billing_month_future: "A future month cannot be billed yet.",
  due_day: "Choose a due day between 1 and 28.",
  hostel_not_found: NO_HOSTEL,
  invoice_not_found: "This invoice could not be found. Refresh the page.",
  invoice_void: "This invoice is void. Refresh the page.",
  invoice_has_payments:
    "This invoice has payments recorded against it. Void those payments first, then the invoice.",
  invoice_immutable: "Invoices cannot be edited. Void it and generate the month again.",
  invoice_has_late_fee:
    "This invoice has a late fee. Waive the late fee first, then void the invoice.",
  late_fees_off: "Late fees are switched off. Turn them on in Settings → Fees first.",
  not_owner: "Only the hostel owner can do this.",
  payment_future: "The payment date cannot be in the future.",
  payment_void: "This payment is already void. Refresh the page.",
  payment_immutable: "Payments cannot be edited. Void it and record it again.",
};

const SELF_EXPLAINING_HINTS = new Set(["overpayment", "fee_structure_later_exists"]);

function ruleMessage(error: PostgrestError): string | null {
  if (error.code !== "P0001" || !error.hint) return null;
  if (SELF_EXPLAINING_HINTS.has(error.hint)) return `${error.message}.`;
  return RULE_MESSAGES[error.hint] ?? null;
}

/** A rule the user can act on, or a logged failure with the generic message. */
async function failure(action: string, error: PostgrestError, values?: Record<string, string>) {
  const message = ruleMessage(error);
  return message ? formFailure(message, values) : unexpectedFailure(action, error, values);
}

function authorizationFailure(error: unknown, values?: Record<string, string>): FormState {
  if (error instanceof AuthorizationError) return formFailure(error.message, values);
  throw error;
}

/** Every screen that shows money. */
function revalidateFees() {
  revalidatePath("/fees", "layout");
  revalidatePath("/residents", "layout");
  revalidatePath("/dashboard");
}

// ---------------------------------------------------------------------------
// Rates (E7-T2)
// ---------------------------------------------------------------------------

export async function setFeeStructure(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  const values = formValues(formData, RATE_FIELDS);
  try {
    await requireRole(["owner"]);
  } catch (error) {
    return authorizationFailure(error, values);
  }

  const parsed = validateFormData(feeStructureSchema, formData);
  if (!parsed.ok) return formFailure(undefined, values, parsed.fieldErrors);
  const hostel = await formHostel(formData);
  if ("error" in hostel) return formFailure(hostel.error, values);
  const hostelId = hostel.id;

  const supabase = await createClient();
  const { error } = await supabase.rpc("set_fee_structure", {
    p_hostel_id: hostelId,
    p_sharing_type: parsed.data.sharing_type,
    p_monthly_amount: parsed.data.monthly_amount,
    p_effective_from: parsed.data.effective_from,
  });
  if (error) return failure("setFeeStructure", error, values);

  revalidatePath("/settings/fees");
  revalidatePath("/fees");
  return formSuccess("Rate saved.");
}

// ---------------------------------------------------------------------------
// Monthly invoices (E7-T3)
// ---------------------------------------------------------------------------

interface GenerationSummary {
  created: number;
  total_amount: number;
  already_invoiced: number;
  unpriced: { resident_id: string; full_name: string }[];
}

function plural(count: number, one: string, many = `${one}s`) {
  return `${count} ${count === 1 ? one : many}`;
}

export async function generateInvoices(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  const values = formValues(formData, GENERATE_FIELDS);
  try {
    await requireRole(["owner"]);
  } catch (error) {
    return authorizationFailure(error, values);
  }

  const parsed = validateFormData(generateInvoicesSchema, formData);
  if (!parsed.ok) return formFailure(undefined, values, parsed.fieldErrors);
  const hostel = await formHostel(formData);
  if ("error" in hostel) return formFailure(hostel.error, values);
  const hostelId = hostel.id;

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("generate_invoices", {
    p_hostel_id: hostelId,
    p_period_month: parsed.data.period_month,
    p_due_day: parsed.data.due_day,
  });
  if (error) return failure("generateInvoices", error, values);

  const summary = data as unknown as GenerationSummary;
  const month = formatMonth(parsed.data.period_month);
  const parts = [
    summary.created > 0
      ? `Created ${plural(summary.created, "invoice")} for ${month} worth ${formatPaise(summary.total_amount)}.`
      : `No new invoices for ${month}.`,
  ];
  if (summary.already_invoiced > 0) {
    parts.push(
      `${plural(summary.already_invoiced, "resident")} already had an invoice for this month and ${summary.already_invoiced === 1 ? "was" : "were"} skipped.`,
    );
  }
  const warning =
    summary.unpriced.length > 0
      ? `Not billed because no rate applies to their room: ${summary.unpriced
          .map((resident) => resident.full_name)
          .join(", ")}. Set a rate for their sharing type in Settings → Fees, then generate again.`
      : undefined;

  revalidateFees();
  return formSuccess(parts.join(" "), warning);
}

export async function voidInvoice(_previous: FormState, formData: FormData): Promise<FormState> {
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
    .from("invoices")
    .update({ status: "void", void_reason: parsed.data.void_reason })
    .eq("id", parsed.data.id)
    .eq("hostel_id", hostelId)
    .select("id, kind");
  if (error) return failure("voidInvoice", error, values);
  if (!data?.length) return formFailure(RULE_MESSAGES.invoice_not_found, values);

  revalidateFees();
  return formSuccess(
    data[0].kind === "late_fee"
      ? "Late fee waived."
      : "Invoice voided. You can generate the month again for this resident.",
  );
}

// ---------------------------------------------------------------------------
// Payments (E7-T4)
// ---------------------------------------------------------------------------

export async function recordPayment(_previous: FormState, formData: FormData): Promise<FormState> {
  const values = formValues(formData, PAYMENT_FIELDS);
  try {
    await requireRole(["owner", "staff"]);
  } catch (error) {
    return authorizationFailure(error, values);
  }

  const parsed = validateFormData(paymentSchema, formData);
  if (!parsed.ok) return formFailure(undefined, values, parsed.fieldErrors);
  const hostel = await formHostel(formData);
  if ("error" in hostel) return formFailure(hostel.error, values);
  const hostelId = hostel.id;

  const supabase = await createClient();
  const { error } = await supabase.from("payments").insert({ hostel_id: hostelId, ...parsed.data });
  if (error) {
    // The invoice belongs to another of the owner's hostels.
    if (error.code === FOREIGN_KEY_VIOLATION) {
      return formFailure(RULE_MESSAGES.invoice_not_found, values);
    }
    if (error.hint === "overpayment") {
      const { data } = await supabase
        .from("invoice_balances")
        .select("balance")
        .eq("id", parsed.data.invoice_id)
        .maybeSingle();
      if (data?.balance != null) {
        return formFailure(undefined, values, {
          amount: [
            data.balance > 0
              ? `Only ${formatPaise(data.balance)} is still due on this invoice.`
              : "This invoice is already paid in full.",
          ],
        });
      }
    }
    return failure("recordPayment", error, values);
  }

  revalidateFees();
  return formSuccess(`Payment of ${formatPaise(parsed.data.amount)} recorded.`);
}

export async function voidPayment(_previous: FormState, formData: FormData): Promise<FormState> {
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
    .from("payments")
    .update({ void_reason: parsed.data.void_reason })
    .eq("id", parsed.data.id)
    .eq("hostel_id", hostelId)
    .select("id");
  if (error) return failure("voidPayment", error, values);
  if (!data?.length)
    return formFailure("This payment could not be found. Refresh the page.", values);

  revalidateFees();
  return formSuccess("Payment voided. It no longer counts towards any total.");
}

// ---------------------------------------------------------------------------
// Late fees (ClickUp E13-T6)
// ---------------------------------------------------------------------------

export async function saveLateFeeRule(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  const values = formValues(formData, LATE_FEE_FIELDS);
  try {
    await requireRole(["owner"]);
  } catch (error) {
    return authorizationFailure(error, values);
  }

  const parsed = validateFormData(lateFeeRuleSchema, formData);
  if (!parsed.ok) return formFailure(undefined, values, parsed.fieldErrors);
  const hostel = await formHostel(formData);
  if ("error" in hostel) return formFailure(hostel.error, values);

  const rule = parsed.data;
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("hostels")
    .update({
      late_fee_mode: rule.late_fee_mode,
      late_fee_amount: rule.late_fee_mode === "off" ? null : rule.late_fee_amount,
      late_fee_cap: rule.late_fee_mode === "per_day" ? rule.late_fee_cap : null,
      late_fee_grace_days: rule.late_fee_grace_days,
    })
    .eq("id", hostel.id)
    .select("id");
  if (error) return failure("saveLateFeeRule", error, values);
  if (!data?.length) return formFailure(RULE_MESSAGES.not_owner, values);

  revalidatePath("/settings/fees");
  revalidatePath("/fees");
  return formSuccess(
    rule.late_fee_mode === "off" ? "Late fees switched off." : "Late fee rule saved.",
  );
}

interface LateFeeSummary {
  applied: number;
  total_amount: number;
  waiting: number;
}

export async function applyLateFees(_previous: FormState, formData: FormData): Promise<FormState> {
  try {
    await requireRole(["owner"]);
  } catch (error) {
    return authorizationFailure(error);
  }
  const hostel = await formHostel(formData);
  if ("error" in hostel) return formFailure(hostel.error);

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("apply_late_fees", { p_hostel_id: hostel.id });
  if (error) return failure("applyLateFees", error);

  const summary = data as unknown as LateFeeSummary;
  const parts = [
    summary.applied > 0
      ? `Added ${plural(summary.applied, "late fee")} worth ${formatPaise(summary.total_amount)}.`
      : "No new late fees.",
  ];
  if (summary.waiting > 0) {
    parts.push(
      `${plural(summary.waiting, "invoice")} still ${summary.waiting === 1 ? "is" : "are"} unpaid; ${summary.waiting === 1 ? "its" : "their"} per-day fee is added once paid or once it reaches the cap.`,
    );
  }

  revalidateFees();
  return formSuccess(parts.join(" "));
}
