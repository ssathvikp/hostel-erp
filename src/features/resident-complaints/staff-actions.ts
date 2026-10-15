"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { requireRole } from "@/lib/auth/session";
import { AuthorizationError } from "@/lib/auth/roles";
import { getHostelContext } from "@/lib/hostels/active";
import { unexpectedFailure } from "@/lib/request-context";
import { createClient } from "@/lib/supabase/server";
import {
  formFailure,
  formSuccess,
  integer,
  uuid,
  validateFormData,
  type FormState,
} from "@/lib/validation";

/**
 * Staff-side settings for resident reporting (E15-T3): a room's QR code,
 * and whether residents may report at all.
 */

async function guard(roles: ("owner" | "staff")[]) {
  try {
    await requireRole(roles);
    return null;
  } catch (error) {
    if (error instanceof AuthorizationError) return formFailure(error.message);
    throw error;
  }
}

const roomCodeSchema = z.object({
  room_id: uuid("Room"),
  regenerate: z.enum(["true", "false"]).default("false"),
});

/** Makes the room's code, or (owners) a new one that retires the printed one. */
export async function makeRoomCode(_previous: FormState, formData: FormData): Promise<FormState> {
  const parsed = validateFormData(roomCodeSchema, formData);
  if (!parsed.ok) return formFailure("That room could not be found.");
  const regenerate = parsed.data.regenerate === "true";
  const denied = await guard(regenerate ? ["owner"] : ["owner", "staff"]);
  if (denied) return denied;

  const supabase = await createClient();
  const { error } = await supabase.rpc("room_report_token", {
    p_room_id: parsed.data.room_id,
    p_regenerate: regenerate,
  });
  if (error) return unexpectedFailure("makeRoomCode", error);
  revalidatePath(`/rooms/${parsed.data.room_id}`);
  return formSuccess(
    regenerate
      ? "New code made. The old printed code no longer works: print and put up the new one."
      : "QR code ready. Print it and put it up in the room.",
  );
}

const settingsSchema = z.object({
  enabled: z.enum(["on"]).optional(),
  confirm_days: integer("Days to confirm", 1, 14),
});

export async function saveResidentReporting(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  const denied = await guard(["owner"]);
  if (denied) return denied;
  const parsed = validateFormData(settingsSchema, formData);
  if (!parsed.ok) return formFailure(undefined, undefined, parsed.fieldErrors);
  const { active } = await getHostelContext();
  if (!active) return formFailure("Choose a hostel first.");

  const supabase = await createClient();
  const { error } = await supabase
    .from("hostels")
    .update({
      resident_complaints_enabled: parsed.data.enabled === "on",
      resident_confirm_days: parsed.data.confirm_days,
    })
    .eq("id", active.id);
  if (error) return unexpectedFailure("saveResidentReporting", error);
  revalidatePath("/settings/complaints");
  return formSuccess("Resident reporting settings saved.");
}
