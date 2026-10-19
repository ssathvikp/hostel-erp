"use server";

import type { PostgrestError } from "@supabase/supabase-js";
import { revalidatePath } from "next/cache";
import { z } from "zod";

import { AuthorizationError } from "@/lib/auth/roles";
import { requireRole } from "@/lib/auth/session";
import { formHostel } from "@/lib/hostels/form";
import { formatMonth, formatPaise } from "@/lib/money";
import { unexpectedFailure } from "@/lib/request-context";
import { createClient } from "@/lib/supabase/server";
import {
  chargeSchema,
  discountSchema,
  electricityRateSchema,
  feeHeadPriceSchema,
  feeHeadSchema,
  formFailure,
  formSuccess,
  formValues,
  meterReadingSchema,
  billingMonth,
  requiredText,
  uuid,
  validateFormData,
  type FormState,
} from "@/lib/validation";
import type { ProfileRole } from "@/types";

/** Plain-language messages for the rules the database enforces (by error hint). */
const RULE_MESSAGES: Record<string, string> = {
  fee_head_not_found: "This charge type could not be found. Refresh the page.",
  charge_void: "This charge is already void. Refresh the page.",
  charge_invoiced: "This charge is already on an invoice. Void that invoice to change it.",
  charge_immutable: "Charges cannot be edited. Void it and add it again.",
  resident_erased: "This resident's details were erased; no new charges can be added.",
  discount_void: "This discount has already ended. Refresh the page.",
  no_pending_charges: "There are no pending charges to bill.",
  not_owner: "Only the hostel owner can do this.",
  electricity_off: "Set the price per unit in Settings → Fees first.",
  billing_month_future: "Choose this month or an earlier one.",
  reading_billed: "This reading has already been billed and cannot change.",
};
const SELF_EXPLAINING = new Set(["fee_head_price_later_exists", "reading_lower", "reading_higher"]);

function failure(action: string, error: PostgrestError, values?: Record<string, string>) {
  if (error.code === "23505") {
    return formFailure("That already exists. Refresh the page.", values);
  }
  if (error.hint && SELF_EXPLAINING.has(error.hint))
    return formFailure(`${error.message}.`, values);
  const message = error.hint ? RULE_MESSAGES[error.hint] : undefined;
  return message ? formFailure(message, values) : unexpectedFailure(action, error, values);
}

async function allow(roles: readonly ProfileRole[], values?: Record<string, string>) {
  try {
    await requireRole(roles);
    return null;
  } catch (error) {
    if (error instanceof AuthorizationError) return formFailure(error.message, values);
    throw error;
  }
}

function revalidateMoney() {
  revalidatePath("/fees", "layout");
  revalidatePath("/residents", "layout");
  revalidatePath("/settings/fees");
  revalidatePath("/dashboard");
}

// ---------------------------------------------------------------------------
// Fee heads (owners)
// ---------------------------------------------------------------------------

export async function createFeeHead(_previous: FormState, formData: FormData): Promise<FormState> {
  const values = formValues(formData, ["name", "kind", "on_first_allocation"]);
  const denied = await allow(["owner"], values);
  if (denied) return denied;
  const parsed = validateFormData(feeHeadSchema, formData);
  if (!parsed.ok) return formFailure(undefined, values, parsed.fieldErrors);
  const hostel = await formHostel(formData);
  if ("error" in hostel) return formFailure(hostel.error, values);

  const supabase = await createClient();
  const { error } = await supabase.from("fee_heads").insert({
    hostel_id: hostel.id,
    name: parsed.data.name,
    kind: parsed.data.kind,
    on_first_allocation: parsed.data.kind === "one_time" && parsed.data.on_first_allocation,
  });
  if (error?.code === "23505") {
    return formFailure(undefined, values, { name: ["There is already a charge with this name"] });
  }
  if (error) return failure("createFeeHead", error, values);
  revalidateMoney();
  return formSuccess(`${parsed.data.name} added. Set its price next.`);
}

export async function setFeeHeadPrice(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  const values = formValues(formData, ["head_id", "sharing_type", "amount", "effective_from"]);
  const denied = await allow(["owner"], values);
  if (denied) return denied;
  const parsed = validateFormData(feeHeadPriceSchema, formData);
  if (!parsed.ok) return formFailure(undefined, values, parsed.fieldErrors);

  const supabase = await createClient();
  const { error } = await supabase.rpc("set_fee_head_price", {
    p_head_id: parsed.data.head_id,
    p_amount: parsed.data.amount,
    p_effective_from: parsed.data.effective_from,
    p_sharing_type: parsed.data.sharing_type ?? undefined,
  });
  if (error) return failure("setFeeHeadPrice", error, values);
  revalidateMoney();
  return formSuccess("Price saved.");
}

export async function archiveFeeHead(_previous: FormState, formData: FormData): Promise<FormState> {
  const denied = await allow(["owner"]);
  if (denied) return denied;
  const parsed = validateFormData(z.object({ id: uuid("Charge") }), formData);
  if (!parsed.ok) return formFailure("This charge type could not be found.");
  const hostel = await formHostel(formData);
  if ("error" in hostel) return formFailure(hostel.error);

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("fee_heads")
    .update({ archived_at: new Date().toISOString() })
    .eq("id", parsed.data.id)
    .eq("hostel_id", hostel.id)
    .select("id");
  if (error) return failure("archiveFeeHead", error);
  if (!data?.length) return formFailure(RULE_MESSAGES.fee_head_not_found);
  revalidateMoney();
  return formSuccess("Removed. Invoices already issued keep it.");
}

export async function saveElectricityRate(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  const values = formValues(formData, ["electricity_unit_rate"]);
  const denied = await allow(["owner"], values);
  if (denied) return denied;
  const parsed = validateFormData(electricityRateSchema, formData);
  if (!parsed.ok) return formFailure(undefined, values, parsed.fieldErrors);
  const hostel = await formHostel(formData);
  if ("error" in hostel) return formFailure(hostel.error, values);

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("hostels")
    .update({ electricity_unit_rate: parsed.data.electricity_unit_rate })
    .eq("id", hostel.id)
    .select("id");
  if (error) return failure("saveElectricityRate", error, values);
  if (!data?.length) return formFailure(RULE_MESSAGES.not_owner, values);
  revalidatePath("/settings/fees");
  revalidatePath("/fees/electricity");
  return formSuccess(
    parsed.data.electricity_unit_rate
      ? `Electricity is billed at ${formatPaise(parsed.data.electricity_unit_rate)} a unit.`
      : "Electricity is no longer billed separately.",
  );
}

// ---------------------------------------------------------------------------
// Charges (members add; owners void and bill now)
// ---------------------------------------------------------------------------

export async function addCharge(_previous: FormState, formData: FormData): Promise<FormState> {
  const values = formValues(formData, [
    "resident_id",
    "head_id",
    "description",
    "amount",
    "charge_date",
  ]);
  const denied = await allow(["owner", "staff"], values);
  if (denied) return denied;
  const parsed = validateFormData(chargeSchema, formData);
  if (!parsed.ok) return formFailure(undefined, values, parsed.fieldErrors);
  const hostel = await formHostel(formData);
  if ("error" in hostel) return formFailure(hostel.error, values);

  const supabase = await createClient();
  const { error } = await supabase.from("resident_charges").insert({
    hostel_id: hostel.id,
    resident_id: parsed.data.resident_id,
    head_id: parsed.data.head_id,
    description: parsed.data.description,
    amount: parsed.data.amount,
    charge_date: parsed.data.charge_date,
  });
  if (error?.code === "23503") return formFailure("This resident could not be found.", values);
  if (error) return failure("addCharge", error, values);
  revalidateMoney();
  return formSuccess(
    `${formatPaise(parsed.data.amount)} added. It goes on the next invoice, or bill it now.`,
  );
}

export async function voidCharge(_previous: FormState, formData: FormData): Promise<FormState> {
  const values = formValues(formData, ["id", "void_reason"]);
  const denied = await allow(["owner"], values);
  if (denied) return denied;
  const parsed = validateFormData(
    z.object({ id: uuid("Charge"), void_reason: requiredText("Reason", 500) }),
    formData,
  );
  if (!parsed.ok) return formFailure(undefined, values, parsed.fieldErrors);
  const hostel = await formHostel(formData);
  if ("error" in hostel) return formFailure(hostel.error, values);

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("resident_charges")
    .update({ void_reason: parsed.data.void_reason })
    .eq("id", parsed.data.id)
    .eq("hostel_id", hostel.id)
    .select("id");
  if (error) return failure("voidCharge", error, values);
  if (!data?.length)
    return formFailure("This charge could not be found. Refresh the page.", values);
  revalidateMoney();
  return formSuccess("Charge voided. It will not be billed.");
}

export async function billChargesNow(_previous: FormState, formData: FormData): Promise<FormState> {
  const denied = await allow(["owner"]);
  if (denied) return denied;
  const parsed = validateFormData(z.object({ resident_id: uuid("Resident") }), formData);
  if (!parsed.ok) return formFailure("This resident could not be found.");

  const supabase = await createClient();
  const { error } = await supabase.rpc("bill_charges_now", {
    p_resident_id: parsed.data.resident_id,
  });
  if (error) return failure("billChargesNow", error);
  revalidateMoney();
  return formSuccess("Invoice issued for the pending charges, due today.");
}

// ---------------------------------------------------------------------------
// Discounts and opt-outs (owners)
// ---------------------------------------------------------------------------

export async function addDiscount(_previous: FormState, formData: FormData): Promise<FormState> {
  const values = formValues(formData, [
    "resident_id",
    "head_id",
    "kind",
    "value",
    "from_month",
    "to_month",
    "reason",
  ]);
  const denied = await allow(["owner"], values);
  if (denied) return denied;
  const parsed = validateFormData(discountSchema, formData);
  if (!parsed.ok) return formFailure(undefined, values, parsed.fieldErrors);
  const hostel = await formHostel(formData);
  if ("error" in hostel) return formFailure(hostel.error, values);

  const supabase = await createClient();
  const { error } = await supabase.from("resident_discounts").insert({
    hostel_id: hostel.id,
    resident_id: parsed.data.resident_id,
    head_id: parsed.data.head_id,
    kind: parsed.data.kind,
    value: parsed.data.value,
    from_month: parsed.data.from_month,
    to_month: parsed.data.to_month,
    reason: parsed.data.reason,
  });
  if (error) return failure("addDiscount", error, values);
  revalidateMoney();
  return formSuccess(
    `Discount added from ${formatMonth(parsed.data.from_month)}. It applies to invoices generated from now on.`,
  );
}

export async function endDiscount(_previous: FormState, formData: FormData): Promise<FormState> {
  const values = formValues(formData, ["id", "void_reason"]);
  const denied = await allow(["owner"], values);
  if (denied) return denied;
  const parsed = validateFormData(
    z.object({ id: uuid("Discount"), void_reason: requiredText("Reason", 500) }),
    formData,
  );
  if (!parsed.ok) return formFailure(undefined, values, parsed.fieldErrors);
  const hostel = await formHostel(formData);
  if ("error" in hostel) return formFailure(hostel.error, values);

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("resident_discounts")
    .update({ void_reason: parsed.data.void_reason })
    .eq("id", parsed.data.id)
    .eq("hostel_id", hostel.id)
    .select("id");
  if (error) return failure("endDiscount", error, values);
  if (!data?.length) return formFailure("This discount could not be found.", values);
  revalidateMoney();
  return formSuccess("Discount ended. Invoices already issued keep it.");
}

/** Which monthly heads the current stay pays: checked heads are charged. */
export async function saveOptOuts(_previous: FormState, formData: FormData): Promise<FormState> {
  const denied = await allow(["owner"]);
  if (denied) return denied;
  const parsed = validateFormData(z.object({ allocation_id: uuid("Stay") }), formData);
  if (!parsed.ok) return formFailure("This stay could not be found.");
  const hostel = await formHostel(formData);
  if ("error" in hostel) return formFailure(hostel.error);
  const offered = formData.getAll("offered").map(String);
  const charged = new Set(formData.getAll("charged").map(String));
  const optOut = offered.filter((id) => !charged.has(id));

  const supabase = await createClient();
  const { error: removeError } = await supabase
    .from("allocation_fee_opt_outs")
    .delete()
    .eq("allocation_id", parsed.data.allocation_id)
    .eq("hostel_id", hostel.id);
  if (removeError) return failure("saveOptOuts", removeError);
  if (optOut.length > 0) {
    const { error } = await supabase.from("allocation_fee_opt_outs").insert(
      optOut.map((headId) => ({
        hostel_id: hostel.id,
        allocation_id: parsed.data.allocation_id,
        head_id: headId,
      })),
    );
    if (error) return failure("saveOptOuts", error);
  }
  revalidateMoney();
  return formSuccess("Saved. It applies to invoices generated from now on.");
}

// ---------------------------------------------------------------------------
// Electricity (members record readings; owners bill)
// ---------------------------------------------------------------------------

export async function saveMeterReading(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  const values = formValues(formData, ["room_id", "reading_month", "reading"]);
  const denied = await allow(["owner", "staff"], values);
  if (denied) return denied;
  const parsed = validateFormData(meterReadingSchema, formData);
  if (!parsed.ok) return formFailure(undefined, values, parsed.fieldErrors);
  const hostel = await formHostel(formData);
  if ("error" in hostel) return formFailure(hostel.error, values);

  const supabase = await createClient();
  const { data: existing } = await supabase
    .from("room_meter_readings")
    .select("id")
    .eq("room_id", parsed.data.room_id)
    .eq("reading_month", parsed.data.reading_month)
    .maybeSingle();
  const { error } = existing
    ? await supabase
        .from("room_meter_readings")
        .update({ reading: parsed.data.reading })
        .eq("id", existing.id)
    : await supabase.from("room_meter_readings").insert({
        hostel_id: hostel.id,
        room_id: parsed.data.room_id,
        reading_month: parsed.data.reading_month,
        reading: parsed.data.reading,
      });
  if (error) return failure("saveMeterReading", error, values);
  revalidatePath("/fees/electricity");
  return formSuccess("Reading saved.");
}

interface ElectricitySummary {
  rooms_billed: number;
  charges: number;
  total_amount: number;
  already_billed: number;
  missing_readings: { room_number: string }[];
  first_readings: { room_number: string }[];
}

export async function billElectricity(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  const values = formValues(formData, ["period_month"]);
  const denied = await allow(["owner"], values);
  if (denied) return denied;
  const parsed = validateFormData(z.object({ period_month: billingMonth }), formData);
  if (!parsed.ok) return formFailure(undefined, values, parsed.fieldErrors);
  const hostel = await formHostel(formData);
  if ("error" in hostel) return formFailure(hostel.error, values);

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("bill_electricity", {
    p_hostel_id: hostel.id,
    p_period_month: parsed.data.period_month,
  });
  if (error) return failure("billElectricity", error, values);
  const summary = data as unknown as ElectricitySummary;
  const month = formatMonth(parsed.data.period_month);
  const parts = [
    summary.rooms_billed > 0
      ? `Billed ${summary.rooms_billed} ${summary.rooms_billed === 1 ? "room" : "rooms"} for ${month}: ${summary.charges} ${summary.charges === 1 ? "charge" : "charges"} worth ${formatPaise(summary.total_amount)}, added to the residents' next invoices.`
      : `Nothing new to bill for ${month}.`,
  ];
  if (summary.first_readings.length > 0) {
    parts.push(
      `First reading for room ${summary.first_readings.map((room) => room.room_number).join(", ")}: billing starts next month.`,
    );
  }
  revalidateMoney();
  const warning =
    summary.missing_readings.length > 0
      ? `No reading yet for occupied room ${summary.missing_readings.map((room) => room.room_number).join(", ")}. Enter it, then bill again; nothing was charged for those rooms.`
      : undefined;
  return formSuccess(parts.join(" "), warning);
}
