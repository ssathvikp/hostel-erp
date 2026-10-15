import "server-only";

import { cookies } from "next/headers";

import { createAdminClient } from "@/lib/supabase/admin";
import type { ComplaintStatus } from "@/types";

import { RESIDENT_COOKIE, isResidentToken, isRoomToken, isStatusToken } from "./tokens";

/**
 * Reads for the resident pages (E15-T3, T4). Residents have no account, so
 * these use the service role; the database checks the token on every call.
 */

export interface ResidentRoom {
  hostel_name: string;
  room_number: string;
  enabled: boolean;
}

export async function getResidentRoom(token: string): Promise<ResidentRoom | null> {
  if (!isRoomToken(token)) return null;
  const { data, error } = await createAdminClient().rpc("resident_room", { p_token: token });
  if (error) throw error;
  return (data as unknown as ResidentRoom | null) ?? null;
}

export interface ResidentForm {
  resident_name: string;
  hostel_name: string;
  room_number: string;
  categories: { id: string; name: string }[];
}

/** The complaint form for the signed-in resident, or null without a live session. */
export async function getResidentForm(): Promise<ResidentForm | null> {
  const session = (await cookies()).get(RESIDENT_COOKIE)?.value;
  if (!isResidentToken(session)) return null;
  const { data, error } = await createAdminClient().rpc("resident_form", { p_session: session });
  if (error) throw error;
  return (data as unknown as ResidentForm | null) ?? null;
}

export interface ResidentComplaint {
  id: string;
  number: number;
  category: string;
  description: string | null;
  status: ComplaintStatus;
  created_at: string;
  resolved_at: string | null;
  closed_at: string | null;
  confirmed_at: string | null;
  rating: number | null;
  worker: string | null;
  steps: { at: string; kind: string; to: ComplaintStatus | null }[];
}

export interface ResidentStatus {
  resident_name: string;
  hostel_name: string;
  complaints: ResidentComplaint[];
}

export async function getResidentStatus(token: string): Promise<ResidentStatus | null> {
  if (!isStatusToken(token)) return null;
  const { data, error } = await createAdminClient().rpc("resident_status", { p_token: token });
  if (error) throw error;
  return (data as unknown as ResidentStatus | null) ?? null;
}
