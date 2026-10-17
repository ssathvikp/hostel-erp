import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import type { Database } from "@/types/database";

export type StaffStatus = "active" | "invited" | "removed";

export interface StaffRow {
  /** Invitation id, when the person was invited through the app. */
  invitationId: string | null;
  /** Profile id, once an account exists. */
  profileId: string | null;
  fullName: string;
  /** Unknown for staff created before invitations existed. */
  email: string | null;
  status: StaffStatus;
  /** When they were invited, or when the account was created. */
  since: string;
}

const ORDER: Record<StaffStatus, number> = { active: 0, invited: 1, removed: 2 };

/**
 * Everyone who works or worked in a hostel: one row per person, newest
 * invitation first. Owners read invitations and staff profiles through RLS.
 */
export async function getStaff(
  supabase: SupabaseClient<Database>,
  hostelId: string,
): Promise<StaffRow[]> {
  const [invitations, profiles] = await Promise.all([
    supabase
      .from("staff_invitations")
      .select("id, email, full_name, profile_id, invited_at, accepted_at, revoked_at")
      .eq("hostel_id", hostelId)
      .order("invited_at", { ascending: false }),
    supabase
      .from("profiles")
      .select("id, full_name, deactivated_at, created_at")
      .eq("hostel_id", hostelId)
      .eq("role", "staff"),
  ]);
  if (invitations.error) throw invitations.error;
  if (profiles.error) throw profiles.error;

  const profileById = new Map(profiles.data.map((profile) => [profile.id, profile]));
  const seen = new Set<string>();
  const rows: StaffRow[] = [];

  for (const invitation of invitations.data) {
    // A re-invited person has several invitations; the newest one speaks.
    const key = invitation.profile_id ?? `email:${invitation.email}`;
    if (seen.has(key) || seen.has(`email:${invitation.email}`)) continue;
    seen.add(key);
    seen.add(`email:${invitation.email}`);

    const profile = invitation.profile_id ? profileById.get(invitation.profile_id) : undefined;
    const status: StaffStatus =
      invitation.revoked_at || profile?.deactivated_at
        ? "removed"
        : invitation.accepted_at
          ? "active"
          : "invited";
    rows.push({
      invitationId: invitation.id,
      profileId: invitation.profile_id,
      fullName: profile?.full_name ?? invitation.full_name,
      email: invitation.email,
      status,
      since: invitation.invited_at,
    });
  }

  // Staff set up before invitations (the demo seed, early hostels).
  for (const profile of profiles.data) {
    if (seen.has(profile.id)) continue;
    rows.push({
      invitationId: null,
      profileId: profile.id,
      fullName: profile.full_name,
      email: null,
      status: profile.deactivated_at ? "removed" : "active",
      since: profile.created_at,
    });
  }

  return rows.sort((a, b) => ORDER[a.status] - ORDER[b.status]);
}
