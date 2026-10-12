import "server-only";

import { fetchAllPages } from "@/lib/pagination";
import type { createClient } from "@/lib/supabase/server";
import type { BedStatus, SharingType } from "@/types";

type Supabase = Awaited<ReturnType<typeof createClient>>;

export interface OccupancyTotals {
  rooms: number;
  totalBeds: number;
  occupiedBeds: number;
  vacantBeds: number;
  outOfServiceBeds: number;
}

export interface OccupancyBed {
  id: string;
  label: string;
  status: BedStatus;
  reason: string | null;
  occupant: { id: string; name: string } | null;
}

export interface OccupancyRoom {
  id: string;
  number: string;
  sharingType: SharingType;
  beds: OccupancyBed[];
}

export interface OccupancyFloor extends OccupancyTotals {
  floor: number;
  roomList: OccupancyRoom[];
}

export interface OccupancySnapshot {
  hostel: OccupancyTotals;
  floors: OccupancyFloor[];
}

const ZERO: OccupancyTotals = {
  rooms: 0,
  totalBeds: 0,
  occupiedBeds: 0,
  vacantBeds: 0,
  outOfServiceBeds: 0,
};

/** Occupied beds as a whole percentage of all beds; 0 when there are none. */
export function occupancyPercent({ occupiedBeds, totalBeds }: OccupancyTotals): number {
  return totalBeds === 0 ? 0 : Math.round((occupiedBeds / totalBeds) * 100);
}

function totals(row: {
  rooms: number | null;
  total_beds: number | null;
  occupied_beds: number | null;
  vacant_beds: number | null;
  out_of_service_beds: number | null;
}): OccupancyTotals {
  return {
    rooms: row.rooms ?? 0,
    totalBeds: row.total_beds ?? 0,
    occupiedBeds: row.occupied_beds ?? 0,
    vacantBeds: row.vacant_beds ?? 0,
    outOfServiceBeds: row.out_of_service_beds ?? 0,
  };
}

/** Hostel-wide figures (E6-T5), derived from live allocations. Zero for an empty hostel. */
export async function getHostelOccupancy(
  supabase: Supabase,
  hostelId: string,
): Promise<OccupancyTotals> {
  const { data, error } = await supabase
    .from("hostel_occupancy")
    .select("rooms, total_beds, occupied_beds, vacant_beds, out_of_service_beds")
    .eq("hostel_id", hostelId)
    .maybeSingle();
  if (error) throw error;
  return data ? totals(data) : ZERO;
}

/**
 * Floor, then room, then each bed with its live status and occupant (E6-T6).
 * Every count comes from the same derived views, so the figures on this page
 * agree with the room list and the dashboard.
 */
export async function getOccupancySnapshot(
  supabase: Supabase,
  hostelId: string,
): Promise<OccupancySnapshot> {
  // Rooms, beds and occupants can each pass the API's row cap in a large hostel.
  const [hostel, floorsResult, rooms, beds, occupants] = await Promise.all([
    getHostelOccupancy(supabase, hostelId),
    supabase
      .from("floor_occupancy")
      .select("floor, rooms, total_beds, occupied_beds, vacant_beds, out_of_service_beds")
      .eq("hostel_id", hostelId)
      .order("floor"),
    fetchAllPages((from, to) =>
      supabase
        .from("room_inventory")
        .select("id, floor, room_number, sharing_type")
        .eq("hostel_id", hostelId)
        .eq("status", "active")
        .order("floor")
        .order("room_sort")
        .order("id")
        .range(from, to),
    ),
    fetchAllPages((from, to) =>
      supabase
        .from("bed_states")
        .select("id, room_id, bed_label, status, status_reason")
        .eq("hostel_id", hostelId)
        .order("bed_label")
        .order("id")
        .range(from, to),
    ),
    fetchAllPages((from, to) =>
      supabase
        .from("resident_directory")
        .select("id, full_name, room_id, bed_label")
        .eq("hostel_id", hostelId)
        .not("bed_label", "is", null)
        .order("id")
        .range(from, to),
    ),
  ]);
  if (floorsResult.error) throw floorsResult.error;

  const occupantByBed = new Map(
    occupants.map((o) => [`${o.room_id}:${o.bed_label}`, { id: o.id!, name: o.full_name! }]),
  );
  const bedsByRoom = new Map<string, OccupancyBed[]>();
  for (const bed of beds) {
    const list = bedsByRoom.get(bed.room_id!) ?? [];
    list.push({
      id: bed.id!,
      label: bed.bed_label!,
      status: bed.status as BedStatus,
      reason: bed.status_reason,
      occupant: occupantByBed.get(`${bed.room_id}:${bed.bed_label}`) ?? null,
    });
    bedsByRoom.set(bed.room_id!, list);
  }

  const roomsByFloor = new Map<number, OccupancyRoom[]>();
  for (const room of rooms) {
    const list = roomsByFloor.get(room.floor!) ?? [];
    list.push({
      id: room.id!,
      number: room.room_number!,
      sharingType: room.sharing_type as SharingType,
      beds: bedsByRoom.get(room.id!) ?? [],
    });
    roomsByFloor.set(room.floor!, list);
  }

  return {
    hostel,
    floors: (floorsResult.data ?? []).map((row) => ({
      floor: row.floor!,
      ...totals(row),
      roomList: roomsByFloor.get(row.floor!) ?? [],
    })),
  };
}
