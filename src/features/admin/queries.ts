import "server-only";

import { notFound } from "next/navigation";

import { requireUser } from "@/lib/auth/session";
import type { createClient } from "@/lib/supabase/server";

type Supabase = Awaited<ReturnType<typeof createClient>>;

export interface AdminHostel {
  id: string;
  name: string;
  city: string | null;
  status: string;
  plan: string;
  trialEndsAt: string | null;
  suspensionReason: string | null;
  createdAt: string;
  ownerName: string;
  ownerEmail: string;
  staff: number;
  rooms: number;
  beds: number;
  occupiedBeds: number;
  residents: number;
  invoicesThisMonth: number;
  collectedThisMonth: number;
  lastActivityAt: string | null;
}

/**
 * For every admin page. Layouts and pages render in parallel, so each page
 * checks the role itself before loading anything; anyone else gets a 404.
 */
export async function requirePlatformAdmin() {
  const user = await requireUser();
  if (user.role !== "platform_admin") notFound();
  return user;
}

/** Every hostel on the platform with usage counts (EP-10). Admins only. */
export async function getAdminHostels(supabase: Supabase): Promise<AdminHostel[]> {
  const { data, error } = await supabase.rpc("admin_hostels");
  if (error) throw error;
  return (data ?? []).map((row) => ({
    id: row.id,
    name: row.name,
    city: row.city,
    status: row.status,
    plan: row.plan,
    trialEndsAt: row.trial_ends_at,
    suspensionReason: row.suspension_reason,
    createdAt: row.created_at,
    ownerName: row.owner_name,
    ownerEmail: row.owner_email,
    staff: row.staff,
    rooms: row.rooms,
    beds: row.beds,
    occupiedBeds: row.occupied_beds,
    residents: row.residents,
    invoicesThisMonth: row.invoices_this_month,
    collectedThisMonth: Number(row.collected_this_month),
    lastActivityAt: row.last_activity_at,
  }));
}
