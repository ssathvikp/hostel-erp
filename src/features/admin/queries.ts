import "server-only";

import { notFound, redirect } from "next/navigation";

import { requireUser } from "@/lib/auth/session";
import type { SetupFacts } from "@/lib/hostels/activation";
import { createClient } from "@/lib/supabase/server";

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
  /** Set-up progress, for the activation checks (plan E15-T2). */
  setup: SetupFacts;
  /** Active hostels this owner has, including this one. */
  ownerHostels: number;
  /** The owner who referred this one, if any (plan E14-T12). */
  referredByName: string | null;
  /** Owners who signed up with this owner's link, and how many of them pay. */
  referrals: number;
  payingReferrals: number;
}

/**
 * For every admin page. Layouts and pages render in parallel, so each page
 * checks the role itself before loading anything; anyone else gets a 404.
 * An admin who signed in with a password only is sent to the authenticator
 * step first (ClickUp E10-T1); the database refuses them regardless.
 */
export async function requirePlatformAdmin() {
  const user = await requireUser();
  if (user.role !== "platform_admin") notFound();
  const { data } = await (await createClient()).auth.mfa.getAuthenticatorAssuranceLevel();
  if (data?.currentLevel !== "aal2") redirect("/admin/mfa");
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
    setup: {
      beds: row.beds,
      ratesSet: row.rates_set,
      allocationsEver: row.allocations_ever,
      invoiced: row.first_invoice_on !== null,
      paymentRecorded: row.first_payment_on !== null,
    },
    ownerHostels: row.owner_hostels,
    referredByName: row.referred_by_name,
    referrals: row.referrals,
    payingReferrals: row.paying_referrals,
  }));
}

/** Platform-wide numbers with no names (ClickUp E10 "Platform metrics dashboard"). */
export interface AdminMetrics {
  trialDays: number;
  signupsByWeek: { weekStart: string; owners: number }[];
  owners: number;
  ownersSetUp: number;
  hostels: number;
  hostelsActive30Days: number;
  beds: number;
  occupiedBeds: number;
  residents: number;
  monthly: {
    month: string;
    invoices: number;
    invoiced: number;
    payments: number;
    collected: number;
  }[];
  plans: { trial: number; paid: number; free: number };
  trialsConverted: number;
  trialsLapsed: number;
  paying30DaysAgo: number;
  leftPaid30Days: number;
}

type RawMetrics = {
  trial_days: number;
  signups_by_week: { week_start: string; owners: number }[] | null;
  owners: number;
  owners_set_up: number;
  hostels: number;
  hostels_active_30_days: number;
  beds: number;
  occupied_beds: number;
  residents: number;
  monthly:
    | { month: string; invoices: number; invoiced: number; payments: number; collected: number }[]
    | null;
  plans: { trial: number; paid: number; free: number };
  trials_converted: number;
  trials_lapsed: number;
  paying_30_days_ago: number;
  left_paid_30_days: number;
};

export async function getAdminMetrics(supabase: Supabase): Promise<AdminMetrics> {
  const { data, error } = await supabase.rpc("admin_metrics");
  if (error) throw error;
  const raw = data as unknown as RawMetrics;
  return {
    trialDays: raw.trial_days,
    signupsByWeek: (raw.signups_by_week ?? []).map((week) => ({
      weekStart: week.week_start,
      owners: week.owners,
    })),
    owners: raw.owners,
    ownersSetUp: raw.owners_set_up,
    hostels: raw.hostels,
    hostelsActive30Days: raw.hostels_active_30_days,
    beds: raw.beds,
    occupiedBeds: raw.occupied_beds,
    residents: raw.residents,
    monthly: (raw.monthly ?? []).map((month) => ({
      month: month.month,
      invoices: month.invoices,
      invoiced: Number(month.invoiced),
      payments: month.payments,
      collected: Number(month.collected),
    })),
    plans: raw.plans,
    trialsConverted: raw.trials_converted,
    trialsLapsed: raw.trials_lapsed,
    paying30DaysAgo: raw.paying_30_days_ago,
    leftPaid30Days: raw.left_paid_30_days,
  };
}

// ---------------------------------------------------------------------------
// Owner directory (ClickUp E10-T4)
// ---------------------------------------------------------------------------

export interface AdminOwner {
  id: string;
  fullName: string;
  email: string;
  phone: string | null;
  createdAt: string;
  emailConfirmedAt: string | null;
  lastSignInAt: string | null;
  hostels: number;
  activeHostels: number;
  draftHostels: number;
  referredByName: string | null;
}

export const OWNER_PAGE_SIZE = 50;

export async function getAdminOwners(
  supabase: Supabase,
  { search, page = 1, ownerId }: { search?: string | null; page?: number; ownerId?: string },
): Promise<{ owners: AdminOwner[]; total: number }> {
  const { data, error } = await supabase.rpc("admin_owners", {
    p_search: search ?? undefined,
    p_limit: OWNER_PAGE_SIZE,
    p_offset: (page - 1) * OWNER_PAGE_SIZE,
    p_owner_id: ownerId,
  });
  if (error) throw error;
  return {
    owners: (data ?? []).map((row) => ({
      id: row.id,
      fullName: row.full_name,
      email: row.email,
      phone: row.phone,
      createdAt: row.created_at,
      emailConfirmedAt: row.email_confirmed_at,
      lastSignInAt: row.last_sign_in_at,
      hostels: row.hostels,
      activeHostels: row.active_hostels,
      draftHostels: row.draft_hostels,
      referredByName: row.referred_by_name,
    })),
    total: Number(data?.[0]?.total ?? 0),
  };
}

// ---------------------------------------------------------------------------
// Audit log (ClickUp E10-T3)
// ---------------------------------------------------------------------------

export interface AuditEntry {
  id: number;
  createdAt: string;
  actorEmail: string;
  action: string;
  hostelId: string | null;
  hostelName: string | null;
  targetEmail: string | null;
  reason: string | null;
  details: Record<string, unknown>;
}

export const AUDIT_PAGE_SIZE = 50;

export async function getAuditEntries(
  supabase: Supabase,
  filters: {
    hostelId?: string | null;
    actorId?: string | null;
    targetUserId?: string | null;
    from?: string | null;
    to?: string | null;
    page?: number;
    limit?: number;
  },
): Promise<{ entries: AuditEntry[]; total: number }> {
  const limit = filters.limit ?? AUDIT_PAGE_SIZE;
  const { data, error } = await supabase.rpc("admin_audit_entries", {
    p_hostel_id: filters.hostelId ?? undefined,
    p_actor_id: filters.actorId ?? undefined,
    p_from: filters.from ?? undefined,
    p_to: filters.to ?? undefined,
    p_limit: limit,
    p_offset: ((filters.page ?? 1) - 1) * limit,
    p_target_user_id: filters.targetUserId ?? undefined,
  });
  if (error) throw error;
  return {
    entries: (data ?? []).map((row) => ({
      id: row.id,
      createdAt: row.created_at,
      actorEmail: row.actor_email,
      action: row.action,
      hostelId: row.hostel_id,
      hostelName: row.hostel_name,
      targetEmail: row.target_email,
      reason: row.reason,
      details: (row.details ?? {}) as Record<string, unknown>,
    })),
    total: Number(data?.[0]?.total ?? 0),
  };
}

export async function getAdmins(supabase: Supabase) {
  const { data, error } = await supabase.rpc("admin_list_admins");
  if (error) throw error;
  return (data ?? []).map((row) => ({ id: row.id, fullName: row.full_name, email: row.email }));
}

// ---------------------------------------------------------------------------
// Support view (ClickUp E10-T5)
// ---------------------------------------------------------------------------

export interface SupportSnapshot {
  opened_at: string;
  expires_at: string;
  reason: string;
  rooms: {
    room_number: string;
    floor: number;
    sharing_type: string;
    status: string;
    beds: { label: string; status: string; occupant: string | null }[];
  }[];
  residents: {
    full_name: string;
    phone: string | null;
    status: string;
    joining_date: string;
    id_proof_type: string;
    id_proof: string | null;
    erased: boolean;
  }[];
  residents_total: number;
  fees: {
    outstanding: number;
    overdue: number;
    recent: {
      period_month: string;
      kind: string;
      resident_name: string;
      amount: number;
      paid: number;
      due_status: string | null;
    }[];
  };
}

/** The open support view, or null when the admin has not opened one in the last hour. */
export async function getSupportSnapshot(
  supabase: Supabase,
  hostelId: string,
): Promise<SupportSnapshot | null> {
  const { data, error } = await supabase.rpc("admin_support_snapshot", { p_hostel_id: hostelId });
  if (error?.hint === "support_view_closed") return null;
  if (error) throw error;
  return data as unknown as SupportSnapshot;
}

// ---------------------------------------------------------------------------
// Announcements (ClickUp E10-T11)
// ---------------------------------------------------------------------------

export async function getAdminAnnouncements(supabase: Supabase) {
  const { data, error } = await supabase.rpc("admin_announcements");
  if (error) throw error;
  return (data ?? []).map((row) => ({
    id: row.id,
    message: row.message,
    severity: row.severity as "info" | "warning",
    startsAt: row.starts_at,
    endsAt: row.ends_at,
    createdAt: row.created_at,
    dismissals: row.dismissals,
  }));
}
