"use server";

import type { PostgrestError } from "@supabase/supabase-js";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { AuthorizationError } from "@/lib/auth/roles";
import { requireRole } from "@/lib/auth/session";
import { formHostel } from "@/lib/hostels/form";
import { unexpectedFailure } from "@/lib/request-context";
import { createClient } from "@/lib/supabase/server";
import {
  bedStatusSchema,
  bulkRoomSchema,
  formFailure,
  formSuccess,
  formValues,
  roomSchema,
  roomUpdateSchema,
  uuid,
  validateFormData,
  type FormState,
} from "@/lib/validation";
import type { SharingType } from "@/types";

import { planBulkRooms } from "./plan";

const ROOM_FIELDS = ["room_number", "floor", "sharing_type", "capacity"] as const;
const ROOM_UPDATE_FIELDS = ["floor", "sharing_type", "capacity"] as const;
const BULK_FIELDS = ["from_number", "to_number", "floor", "sharing_type", "capacity"] as const;
const BED_STATUS_FIELDS = ["status", "status_reason"] as const;

/**
 * Plain-language messages for the business rules the database enforces.
 * Triggers raise P0001 with one of these hints.
 */
const RULE_MESSAGES: Record<string, string> = {
  room_beds_occupied:
    "Some of the beds that would be removed are occupied. Vacate or move those residents first, then reduce the capacity.",
  room_archived: "This room is archived, so it can no longer be changed.",
  room_occupied: "This room still has residents. Vacate or move them before archiving the room.",
  bed_occupied: "This bed is occupied. Vacate it before marking it blocked or under maintenance.",
  bed_retired: "This bed is no longer in use, so its status cannot be changed.",
  bulk_range: "Choose a range of between 1 and 100 rooms.",
};

function ruleMessage(error: PostgrestError): string | null {
  return error.code === "P0001" && error.hint ? (RULE_MESSAGES[error.hint] ?? null) : null;
}

/** A rule the user can act on, or a logged failure with the generic message. */
async function failure(action: string, error: PostgrestError, values?: Record<string, string>) {
  const message = ruleMessage(error);
  return message ? formFailure(message, values) : unexpectedFailure(action, error, values);
}

function isDuplicateRoom(error: PostgrestError) {
  return error.code === "23505" && error.message.includes("rooms_hostel_room_number_key");
}

function authorizationFailure(error: unknown, values?: Record<string, string>): FormState {
  if (error instanceof AuthorizationError) {
    return formFailure(
      error.reason === "forbidden"
        ? "Only the hostel owner can change rooms. Ask the owner to make the change."
        : error.message,
      values,
    );
  }
  throw error;
}

/** The active hostel, taken from the session; never from the submitted form. */
// ---------------------------------------------------------------------------
// Create one room (E4-T2, E4-T3, E4-T4)
// ---------------------------------------------------------------------------

export async function createRoom(_previous: FormState, formData: FormData): Promise<FormState> {
  const values = formValues(formData, ROOM_FIELDS);
  try {
    await requireRole(["owner"]);
  } catch (error) {
    return authorizationFailure(error, values);
  }

  const parsed = validateFormData(roomSchema, formData);
  if (!parsed.ok) return formFailure(undefined, values, parsed.fieldErrors);

  const hostel = await formHostel(formData);
  if ("error" in hostel) return formFailure(hostel.error, values);
  const hostelId = hostel.id;

  // The insert trigger creates the beds in the same statement.
  const supabase = await createClient();
  const { error } = await supabase.from("rooms").insert({ ...parsed.data, hostel_id: hostelId });

  if (error) {
    if (isDuplicateRoom(error)) {
      return formFailure(undefined, values, {
        room_number: [`Room ${parsed.data.room_number} already exists in this hostel.`],
      });
    }
    return failure("createRoom", error, values);
  }

  revalidatePath("/rooms");
  const params = new URLSearchParams({
    q: parsed.data.room_number,
    created: parsed.data.room_number,
  });
  redirect(`/rooms?${params}`);
}

// ---------------------------------------------------------------------------
// Bulk generation (E4-T5)
// ---------------------------------------------------------------------------

export interface BulkRoomPreview {
  roomNumbers: string[];
  bedCount: number;
  capacity: number;
  floor: number;
  sharingType: SharingType;
  /** Room numbers in the range that already exist; creation is refused while any remain. */
  conflicts: string[];
}

export interface BulkRoomState extends FormState {
  preview?: BulkRoomPreview;
  created?: { rooms: number; beds: number };
}

/**
 * One form, two steps: `intent=preview` shows exactly what will be created,
 * `intent=create` creates it in a single all-or-nothing database call.
 */
export async function generateRooms(
  _previous: BulkRoomState,
  formData: FormData,
): Promise<BulkRoomState> {
  const values = formValues(formData, BULK_FIELDS);
  try {
    await requireRole(["owner"]);
  } catch (error) {
    return authorizationFailure(error, values);
  }

  const parsed = validateFormData(bulkRoomSchema, formData);
  if (!parsed.ok) return formFailure(undefined, values, parsed.fieldErrors);

  const hostel = await formHostel(formData);
  if ("error" in hostel) return formFailure(hostel.error, values);
  const hostelId = hostel.id;

  const input = parsed.data;
  const supabase = await createClient();

  if (formData.get("intent") === "create") {
    const { data, error } = await supabase
      .rpc("create_rooms_bulk", {
        p_hostel_id: hostelId,
        p_from: input.from_number,
        p_to: input.to_number,
        p_floor: input.floor,
        p_sharing_type: input.sharing_type,
        p_capacity: input.capacity,
      })
      .single();

    if (error) {
      if (isDuplicateRoom(error)) {
        return formFailure(
          "Some of these room numbers already exist, so nothing was created. Preview again to see which.",
          values,
        );
      }
      return failure("generateRooms", error, values);
    }

    revalidatePath("/rooms");
    return {
      ...formSuccess(),
      values,
      created: { rooms: data.rooms_created, beds: data.beds_created },
    };
  }

  const plan = planBulkRooms(input.from_number, input.to_number, input.capacity);
  const { data: existing, error } = await supabase
    .from("rooms")
    .select("room_number")
    .eq("hostel_id", hostelId)
    .in("room_number", plan.roomNumbers);
  if (error) return unexpectedFailure("generateRooms", error, values);

  const taken = new Set((existing ?? []).map((row) => row.room_number));
  return {
    id: crypto.randomUUID(),
    status: "idle",
    fieldErrors: {},
    values,
    preview: {
      ...plan,
      capacity: input.capacity,
      floor: input.floor,
      sharingType: input.sharing_type,
      conflicts: plan.roomNumbers.filter((number) => taken.has(number)),
    },
  };
}

// ---------------------------------------------------------------------------
// Edit, archive and delete (E4-T7)
// ---------------------------------------------------------------------------

function roomIdFrom(formData: FormData): string | null {
  const parsed = uuid("Room").safeParse(formData.get("room_id"));
  return parsed.success ? parsed.data : null;
}

export async function updateRoom(_previous: FormState, formData: FormData): Promise<FormState> {
  const values = formValues(formData, ROOM_UPDATE_FIELDS);
  try {
    await requireRole(["owner"]);
  } catch (error) {
    return authorizationFailure(error, values);
  }

  const roomId = roomIdFrom(formData);
  if (!roomId) return formFailure("This room could not be found.", values);

  const parsed = validateFormData(roomUpdateSchema, formData);
  if (!parsed.ok) return formFailure(undefined, values, parsed.fieldErrors);

  const hostel = await formHostel(formData);
  if ("error" in hostel) return formFailure(hostel.error, values);
  const hostelId = hostel.id;

  // A capacity change adds or retires beds in the same statement.
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("rooms")
    .update(parsed.data)
    .eq("id", roomId)
    .eq("hostel_id", hostelId)
    .select("id")
    .maybeSingle();

  if (error) return failure("updateRoom", error, values);
  if (!data) return formFailure("This room could not be found.", values);

  revalidatePath("/rooms");
  redirect(`/rooms/${roomId}?updated=1`);
}

export async function archiveRoom(_previous: FormState, formData: FormData): Promise<FormState> {
  try {
    await requireRole(["owner"]);
  } catch (error) {
    return authorizationFailure(error);
  }

  const roomId = roomIdFrom(formData);
  const hostel = await formHostel(formData);
  if ("error" in hostel) return formFailure(hostel.error);
  const hostelId = hostel.id;
  if (!roomId) return formFailure("This room could not be found.");

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("rooms")
    .update({ status: "archived" })
    .eq("id", roomId)
    .eq("hostel_id", hostelId)
    .select("room_number")
    .maybeSingle();

  if (error) return failure("archiveRoom", error);
  if (!data) return formFailure("This room could not be found.");

  revalidatePath("/rooms");
  redirect(`/rooms?archived=${encodeURIComponent(data.room_number)}`);
}

export async function deleteRoom(_previous: FormState, formData: FormData): Promise<FormState> {
  try {
    await requireRole(["owner"]);
  } catch (error) {
    return authorizationFailure(error);
  }

  const roomId = roomIdFrom(formData);
  const hostel = await formHostel(formData);
  if ("error" in hostel) return formFailure(hostel.error);
  const hostelId = hostel.id;
  if (!roomId) return formFailure("This room could not be found.");

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("rooms")
    .delete()
    .eq("id", roomId)
    .eq("hostel_id", hostelId)
    .select("room_number")
    .maybeSingle();

  if (error) {
    // Allocations reference beds ON DELETE RESTRICT: the room has history.
    if (error.code === "23503") {
      return formFailure(
        "This room has resident history, so it cannot be deleted. Archive it instead to keep that history.",
      );
    }
    return unexpectedFailure("deleteRoom", error);
  }
  if (!data) return formFailure("This room could not be found.");

  revalidatePath("/rooms");
  redirect(`/rooms?deleted=${encodeURIComponent(data.room_number)}`);
}

// ---------------------------------------------------------------------------
// Bed status (E4-T8)
// ---------------------------------------------------------------------------

/** Owners and staff can take a bed out of service and bring it back. */
export async function setBedStatus(_previous: FormState, formData: FormData): Promise<FormState> {
  const values = formValues(formData, BED_STATUS_FIELDS);
  try {
    await requireRole(["owner", "staff"]);
  } catch (error) {
    return authorizationFailure(error, values);
  }

  const parsed = validateFormData(bedStatusSchema, formData);
  if (!parsed.ok) return formFailure(undefined, values, parsed.fieldErrors);

  const hostel = await formHostel(formData);
  if ("error" in hostel) return formFailure(hostel.error, values);
  const hostelId = hostel.id;

  const { bed_id, ...change } = parsed.data;
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("beds")
    .update(change)
    .eq("id", bed_id)
    .eq("hostel_id", hostelId)
    .select("bed_label, room_id")
    .maybeSingle();

  if (error) return failure("setBedStatus", error, values);
  if (!data) return formFailure("This bed could not be found.", values);

  revalidatePath(`/rooms/${data.room_id}`);
  revalidatePath("/rooms");
  return formSuccess(
    change.status === "available"
      ? `Bed ${data.bed_label} is available again.`
      : `Bed ${data.bed_label} is now ${change.status === "blocked" ? "blocked" : "under maintenance"}.`,
  );
}
