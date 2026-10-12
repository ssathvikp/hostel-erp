"use server";

import type { PostgrestError } from "@supabase/supabase-js";
import { revalidatePath } from "next/cache";

import { AuthorizationError } from "@/lib/auth/roles";
import { requireRole } from "@/lib/auth/session";
import { getHostelContext } from "@/lib/hostels/active";
import { formatMonth, formatPaise } from "@/lib/money";
import { unexpectedFailure } from "@/lib/request-context";
import { createClient } from "@/lib/supabase/server";
import {
  feeExemptionSchema,
  feeHeadRateSchema,
  feeHeadSchema,
  feeHeadToggleSchema,
  feeStructureSchema,
  formFailure,
  formSuccess,
  formValues,
  generateInvoicesSchema,
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
  payment_future: "The payment date cannot be in the future.",
  payment_void: "This payment is already void. Refresh the page.",
  payment_immutable: "Payments cannot be edited. Void it and record it again.",
  fee_head_not_found: "This charge could not be found. Refresh the page.",
  fee_head_sharing_required: "This charge is priced per sharing type. Choose one.",
};

const SELF_EXPLAINING_HINTS = new Set([
  "overpayment",
  "fee_structure_later_exists",
  "fee_head_later_exists",
]);

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

async function activeHostelId(): Promise<string | null> {
  return (await getHostelContext()).active?.id ?? null;
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
  const hostelId = await activeHostelId();
  if (!hostelId) return formFailure(NO_HOSTEL, values);

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
// Fee heads (E13-T1)
// ---------------------------------------------------------------------------

const FEE_HEAD_FIELDS = ["name", "billing", "pricing"] as const;
const FEE_HEAD_RATE_FIELDS = ["fee_head_id", "sharing_type", "amount", "effective_from"] as const;

export async function createFeeHead(_previous: FormState, formData: FormData): Promise<FormState> {
  const values = formValues(formData, FEE_HEAD_FIELDS);
  try {
    await requireRole(["owner"]);
  } catch (error) {
    return authorizationFailure(error, values);
  }

  const parsed = validateFormData(feeHeadSchema, formData);
  if (!parsed.ok) return formFailure(undefined, values, parsed.fieldErrors);
  const hostelId = await activeHostelId();
  if (!hostelId) return formFailure(NO_HOSTEL, values);

  const supabase = await createClient();
  const { error } = await supabase
    .from("fee_heads")
    .insert({ ...parsed.data, hostel_id: hostelId });
  if (error) {
    if (error.code === "23505") {
      return formFailure(undefined, values, {
        name: [`There is already a charge called "${parsed.data.name}".`],
      });
    }
    return failure("createFeeHead", error, values);
  }

  revalidatePath("/settings/fees");
  return formSuccess(`${parsed.data.name} added. Set its rate below.`);
}

export async function setFeeHeadRate(_previous: FormState, formData: FormData): Promise<FormState> {
  const values = formValues(formData, FEE_HEAD_RATE_FIELDS);
  try {
    await requireRole(["owner"]);
  } catch (error) {
    return authorizationFailure(error, values);
  }

  const parsed = validateFormData(feeHeadRateSchema, formData);
  if (!parsed.ok) return formFailure(undefined, values, parsed.fieldErrors);
  if (!(await activeHostelId())) return formFailure(NO_HOSTEL, values);

  const supabase = await createClient();
  const { error } = await supabase.rpc("set_fee_head_rate", {
    p_fee_head_id: parsed.data.fee_head_id,
    p_amount: parsed.data.amount,
    p_effective_from: parsed.data.effective_from,
    p_sharing_type: parsed.data.sharing_type ?? undefined,
  });
  if (error) return failure("setFeeHeadRate", error, values);

  revalidatePath("/settings/fees");
  return formSuccess("Charge rate saved.");
}

/** Stops (or resumes) billing a head; its history stays. */
export async function toggleFeeHead(_previous: FormState, formData: FormData): Promise<FormState> {
  try {
    await requireRole(["owner"]);
  } catch (error) {
    return authorizationFailure(error);
  }
  const parsed = validateFormData(feeHeadToggleSchema, formData);
  if (!parsed.ok) return formFailure(RULE_MESSAGES.fee_head_not_found);
  const hostelId = await activeHostelId();
  if (!hostelId) return formFailure(NO_HOSTEL);

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("fee_heads")
    .update({ active: parsed.data.active })
    .eq("id", parsed.data.fee_head_id)
    .eq("hostel_id", hostelId)
    .select("name");
  if (error) return failure("toggleFeeHead", error);
  if (!data?.length) return formFailure(RULE_MESSAGES.fee_head_not_found);

  revalidatePath("/settings/fees");
  return formSuccess(
    parsed.data.active
      ? `${data[0].name} is billed again.`
      : `${data[0].name} is no longer billed.`,
  );
}

/** Excuses a resident from a monthly charge, or bills them for it again. */
export async function setFeeExemption(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  try {
    await requireRole(["owner"]);
  } catch (error) {
    return authorizationFailure(error);
  }
  const parsed = validateFormData(feeExemptionSchema, formData);
  if (!parsed.ok) return formFailure(RULE_MESSAGES.fee_head_not_found);
  const hostelId = await activeHostelId();
  if (!hostelId) return formFailure(NO_HOSTEL);

  const { resident_id, fee_head_id, exempt } = parsed.data;
  const supabase = await createClient();
  const { error } = exempt
    ? await supabase
        .from("resident_fee_exemptions")
        .upsert(
          { hostel_id: hostelId, resident_id, fee_head_id },
          { onConflict: "resident_id,fee_head_id", ignoreDuplicates: true },
        )
    : await supabase
        .from("resident_fee_exemptions")
        .delete()
        .eq("hostel_id", hostelId)
        .eq("resident_id", resident_id)
        .eq("fee_head_id", fee_head_id);
  if (error) return failure("setFeeExemption", error);

  revalidatePath(`/residents/${resident_id}`);
  return formSuccess(exempt ? "Excused from this charge." : "Billed for this charge again.");
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
  const hostelId = await activeHostelId();
  if (!hostelId) return formFailure(NO_HOSTEL, values);

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
  const hostelId = await activeHostelId();
  if (!hostelId) return formFailure(NO_HOSTEL, values);

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("invoices")
    .update({ status: "void", void_reason: parsed.data.void_reason })
    .eq("id", parsed.data.id)
    .eq("hostel_id", hostelId)
    .select("id");
  if (error) return failure("voidInvoice", error, values);
  if (!data?.length) return formFailure(RULE_MESSAGES.invoice_not_found, values);

  revalidateFees();
  return formSuccess("Invoice voided. You can generate the month again for this resident.");
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
  const hostelId = await activeHostelId();
  if (!hostelId) return formFailure(NO_HOSTEL, values);

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
  const hostelId = await activeHostelId();
  if (!hostelId) return formFailure(NO_HOSTEL, values);

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
