"use server";

import type { PostgrestError } from "@supabase/supabase-js";
import { revalidatePath } from "next/cache";

import { AuthorizationError } from "@/lib/auth/roles";
import { requireRole } from "@/lib/auth/session";
import { formHostel } from "@/lib/hostels/form";
import { unexpectedFailure } from "@/lib/request-context";
import { createClient } from "@/lib/supabase/server";
import {
  allocationSchema,
  formFailure,
  formSuccess,
  formValues,
  transferSchema,
  uuid,
  vacateSchema,
  validateFormData,
  type FormState,
} from "@/lib/validation";

const ALLOCATE_FIELDS = ["resident_id", "bed_id", "start_date", "rent_override"] as const;
const VACATE_FIELDS = ["move_out_date", "vacate_reason", "mark_vacated"] as const;
const TRANSFER_FIELDS = ["bed_id", "move_date", "rent_override"] as const;

/**
 * Plain-language messages for the rules the allocation functions enforce.
 * They raise P0001 with one of these hints. Overlaps are not listed: their
 * database message already names the resident and dates holding the bed.
 */
const RULE_MESSAGES: Record<string, string> = {
  bed_not_found: "That bed could not be found. Refresh the page and choose again.",
  resident_not_found: "This resident could not be found.",
  allocation_not_found: "This allocation could not be found. Refresh the page.",
  resident_has_bed:
    "This resident already has a bed. Use Transfer to move them, or vacate the current bed first.",
  resident_not_allocatable:
    "Vacated and blocked residents cannot be given a bed. Make the resident active first.",
  bed_out_of_service: "That bed is blocked or under maintenance. Choose another bed.",
  bed_retired: "That bed is no longer in use. Choose another bed.",
  allocation_future:
    "Allocations record moves that have happened. Choose today or an earlier date.",
  move_future: "The move-out date cannot be in the future.",
  allocation_closed: "This allocation is already closed. Refresh the page.",
  allocation_same_day:
    "The move must be after the resident's first night in this bed. Choose a later date.",
  transfer_same_bed: "The resident is already in this bed. Choose a different bed.",
  vacate_reason: "Choose why the resident is leaving.",
  allocation_overlap: "These dates overlap another allocation. Choose different dates.",
};

const OVERLAP_HINTS = new Set(["bed_overlap", "resident_overlap"]);

function ruleMessage(error: PostgrestError): string | null {
  if (error.code !== "P0001" || !error.hint) return null;
  if (OVERLAP_HINTS.has(error.hint)) return `${error.message}. Choose another bed or date.`;
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

/** Every screen that shows who sleeps where. */
function revalidateOccupancy(residentId: unknown) {
  const resident = uuid("Resident").safeParse(residentId);
  revalidatePath("/residents");
  if (resident.success) revalidatePath(`/residents/${resident.data}`);
  revalidatePath("/rooms", "layout");
  revalidatePath("/occupancy");
  revalidatePath("/dashboard");
}

// ---------------------------------------------------------------------------
// Allocate (E6-T2)
// ---------------------------------------------------------------------------

export async function allocateBed(_previous: FormState, formData: FormData): Promise<FormState> {
  const values = formValues(formData, ALLOCATE_FIELDS);
  try {
    await requireRole(["owner", "staff"]);
  } catch (error) {
    return authorizationFailure(error, values);
  }

  const parsed = validateFormData(allocationSchema, formData);
  if (!parsed.ok) return formFailure(undefined, values, parsed.fieldErrors);
  const hostel = await formHostel(formData);
  if ("error" in hostel) return formFailure(hostel.error, values);

  const supabase = await createClient();
  const { error } = await supabase.rpc("allocate_bed", {
    p_resident_id: parsed.data.resident_id,
    p_bed_id: parsed.data.bed_id,
    p_start_date: parsed.data.start_date,
    p_rent_override: parsed.data.rent_override ?? undefined,
  });
  if (error) return failure("allocateBed", error, values);

  revalidateOccupancy(parsed.data.resident_id);
  return formSuccess("Bed allocated.");
}

// ---------------------------------------------------------------------------
// Vacate (E6-T4)
// ---------------------------------------------------------------------------

export async function vacateBed(_previous: FormState, formData: FormData): Promise<FormState> {
  const values = formValues(formData, VACATE_FIELDS);
  try {
    await requireRole(["owner", "staff"]);
  } catch (error) {
    return authorizationFailure(error, values);
  }

  const parsed = validateFormData(vacateSchema, formData);
  if (!parsed.ok) return formFailure(undefined, values, parsed.fieldErrors);
  const hostel = await formHostel(formData);
  if ("error" in hostel) return formFailure(hostel.error, values);

  const supabase = await createClient();
  const { error } = await supabase.rpc("vacate_allocation", {
    p_allocation_id: parsed.data.allocation_id,
    p_move_out_date: parsed.data.move_out_date,
    p_reason: parsed.data.vacate_reason,
    p_mark_vacated: parsed.data.mark_vacated,
  });
  if (error) return failure("vacateBed", error, values);

  revalidateOccupancy(formData.get("resident_id"));
  return formSuccess(
    parsed.data.mark_vacated ? "Bed vacated and resident marked as vacated." : "Bed vacated.",
  );
}

// ---------------------------------------------------------------------------
// Transfer (E6-T4)
// ---------------------------------------------------------------------------

export async function transferBed(_previous: FormState, formData: FormData): Promise<FormState> {
  const values = formValues(formData, TRANSFER_FIELDS);
  try {
    await requireRole(["owner", "staff"]);
  } catch (error) {
    return authorizationFailure(error, values);
  }

  const parsed = validateFormData(transferSchema, formData);
  if (!parsed.ok) return formFailure(undefined, values, parsed.fieldErrors);
  const hostel = await formHostel(formData);
  if ("error" in hostel) return formFailure(hostel.error, values);

  const supabase = await createClient();
  const { error } = await supabase.rpc("transfer_allocation", {
    p_allocation_id: parsed.data.allocation_id,
    p_new_bed_id: parsed.data.bed_id,
    p_move_date: parsed.data.move_date,
    p_rent_override: parsed.data.rent_override ?? undefined,
  });
  if (error) return failure("transferBed", error, values);

  revalidateOccupancy(formData.get("resident_id"));
  return formSuccess("Resident moved to the new bed.");
}
