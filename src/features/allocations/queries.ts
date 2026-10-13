import "server-only";

import { floorLabel, SHARING_TYPE_LABELS } from "@/features/rooms/options";
import { fetchAllPages } from "@/lib/pagination";
import { createClient } from "@/lib/supabase/server";
import type { SharingType } from "@/types";

import type { AllocationEventAction } from "./options";

type Supabase = Awaited<ReturnType<typeof createClient>>;

export interface BedChoice {
  id: string;
  label: string;
  roomId: string;
}

export interface ResidentChoice {
  id: string;
  label: string;
}

export interface AllocationEvent {
  id: number;
  action: AllocationEventAction;
  effectiveDate: string;
  recordedAt: string;
  actorName: string | null;
  residentId: string;
  residentName: string;
  bedLabel: string;
  roomNumber: string;
}

/**
 * Beds that can be allocated right now: in service, unoccupied, in an active
 * room. Choosing from this list is the only way to pick a bed (E6-T2).
 */
export async function getVacantBeds(supabase: Supabase, hostelId: string): Promise<BedChoice[]> {
  const [beds, rooms] = await Promise.all([
    fetchAllPages((from, to) =>
      supabase
        .from("bed_states")
        .select("id, room_id, bed_label")
        .eq("hostel_id", hostelId)
        .eq("status", "available")
        .order("id")
        .range(from, to),
    ),
    fetchAllPages((from, to) =>
      supabase
        .from("room_inventory")
        .select("id, room_number, room_sort, floor, sharing_type")
        .eq("hostel_id", hostelId)
        .eq("status", "active")
        .order("id")
        .range(from, to),
    ),
  ]);

  const roomById = new Map(rooms.map((room) => [room.id!, room]));
  return beds
    .flatMap((bed) => {
      const room = roomById.get(bed.room_id!);
      return room ? [{ bed, room }] : [];
    })
    .sort(
      (a, b) =>
        a.room.floor! - b.room.floor! ||
        a.room.room_sort!.localeCompare(b.room.room_sort!) ||
        a.bed.bed_label!.localeCompare(b.bed.bed_label!),
    )
    .map(({ bed, room }) => ({
      id: bed.id!,
      roomId: room.id!,
      label: `Bed ${bed.bed_label} · ${SHARING_TYPE_LABELS[room.sharing_type as SharingType]} · ${floorLabel(room.floor!)}`,
    }));
}

/** Active and on-notice residents who do not hold a bed today. */
export async function getUnallocatedResidents(
  supabase: Supabase,
  hostelId: string,
): Promise<ResidentChoice[]> {
  const data = await fetchAllPages((from, to) =>
    supabase
      .from("resident_directory")
      .select("id, full_name, phone")
      .eq("hostel_id", hostelId)
      .in("status", ["active", "notice"])
      .is("bed_label", null)
      .order("full_name")
      .order("id")
      .range(from, to),
  );
  return data.map((resident) => ({
    id: resident.id!,
    label: `${resident.full_name} · ${resident.phone}`,
  }));
}

/** The immutable allocation log (E6-T7) for one resident or one room, newest first. */
export async function getAllocationEvents(
  supabase: Supabase,
  hostelId: string,
  filter: { residentId: string } | { roomId: string },
  limit = 50,
): Promise<AllocationEvent[]> {
  let query = supabase
    .from("allocation_events")
    .select(
      "id, action, effective_date, created_at, actor_name, resident_id, residents(full_name), beds!allocation_events_bed_fkey(bed_label), rooms(room_number)",
    )
    .eq("hostel_id", hostelId);
  query =
    "residentId" in filter
      ? query.eq("resident_id", filter.residentId)
      : query.eq("room_id", filter.roomId);
  const { data, error } = await query.order("id", { ascending: false }).limit(limit);
  if (error) throw error;

  return (data ?? []).map((event) => ({
    id: event.id,
    action: event.action as AllocationEventAction,
    effectiveDate: event.effective_date,
    recordedAt: event.created_at,
    actorName: event.actor_name,
    residentId: event.resident_id,
    residentName: event.residents?.full_name ?? "",
    bedLabel: event.beds?.bed_label ?? "",
    roomNumber: event.rooms?.room_number ?? "",
  }));
}
