import "server-only";

import type { createClient } from "@/lib/supabase/server";
import type { HostelStatus } from "@/types";

type Supabase = Awaited<ReturnType<typeof createClient>>;

/**
 * Typed reads for the admin area. Every one goes through an admin database
 * function, which refuses anyone but a platform admin at aal2 (E10-T2).
 * Their JSON shapes are fixed by those functions.
 */

export interface Paged<T> {
  total: number;
  rows: T[];
}

export interface OwnerRow {
  id: string;
  email: string;
  full_name: string;
  created_at: string;
  email_confirmed_at: string | null;
  last_sign_in_at: string | null;
  hostels: number;
}

export async function getOwners(supabase: Supabase, search: string, page: number) {
  const { data, error } = await supabase.rpc("admin_customers", {
    p_search: search || undefined,
    p_page: page,
  });
  if (error) throw error;
  return data as unknown as Paged<OwnerRow>;
}

export interface HostelRow {
  id: string;
  name: string;
  status: HostelStatus;
  city: string | null;
  phone: string | null;
  created_at: string;
  owner_id: string;
  owner_email: string;
  beds: number;
  active_residents: number;
  invoices_this_month: number;
  last_activity: string | null;
}

export async function getHostels(
  supabase: Supabase,
  search: string,
  status: HostelStatus | null,
  page: number,
) {
  const { data, error } = await supabase.rpc("admin_hostels", {
    p_search: search || undefined,
    p_status: status ?? undefined,
    p_page: page,
  });
  if (error) throw error;
  return data as unknown as Paged<HostelRow>;
}

export interface AuditRow {
  id: number;
  created_at: string;
  actor_email: string;
  action: string;
  hostel_id: string | null;
  hostel_name: string | null;
  account_id: string | null;
  account_email: string | null;
  reason: string | null;
  details: Record<string, unknown>;
  request_id: string | null;
}

export interface AccountDetail {
  id: string;
  email: string;
  full_name: string;
  phone: string | null;
  created_at: string;
  email_confirmed_at: string | null;
  last_sign_in_at: string | null;
  sessions: number;
  hostels: {
    id: string;
    name: string;
    status: HostelStatus;
    city: string | null;
    created_at: string;
  }[];
  activity: {
    created_at: string;
    actor_email: string;
    action: string;
    reason: string | null;
    hostel_name: string | null;
  }[];
}

/** One owner. Opening it is recorded in the audit log. */
export async function getAccount(supabase: Supabase, accountId: string) {
  const { data, error } = await supabase.rpc("admin_account", { p_account_id: accountId });
  if (error) throw error;
  return (data as unknown as AccountDetail | null) ?? null;
}

export interface SupportView {
  hostel: {
    id: string;
    name: string;
    status: HostelStatus;
    type: string;
    phone: string | null;
    email: string | null;
    address: string;
    floors: number | null;
    created_at: string;
    owner_id: string;
    owner_email: string;
  };
  occupancy: { beds: number; occupied: number; available: number; out_of_service: number };
  rooms: {
    room_number: string;
    floor: number;
    sharing_type: string;
    total_beds: number;
    occupied_beds: number;
    available_beds: number;
    status: string;
  }[];
  residents: {
    full_name: string;
    phone: string;
    status: string;
    joining_date: string;
    bed_label: string | null;
    id_proof: string;
  }[];
  fees: {
    month: string;
    invoiced: number;
    collected: number;
    invoices: {
      resident_name: string;
      period_month: string;
      amount: number;
      balance: number;
      status: string;
    }[];
  };
}

export interface PlatformMetrics {
  owners: number;
  hostels: { total: number; draft: number; active: number; suspended: number };
  onboarding_rate: number | null;
  active_last_30_days: number;
  beds: number;
  occupied_beds: number;
  residents: number;
  signups_by_week: { week: string; count: number }[];
  money_by_month: {
    month: string;
    invoices: number;
    invoiced: number;
    payments: number;
    collected: number;
  }[];
}

export async function getPlatformMetrics(supabase: Supabase) {
  const { data, error } = await supabase.rpc("admin_platform_metrics");
  if (error) throw error;
  return data as unknown as PlatformMetrics;
}

export const AUDIT_ACTION_LABELS: Record<string, string> = {
  view_account: "Opened account",
  view_hostel: "Viewed hostel (support)",
  suspend_hostel: "Suspended hostel",
  restore_hostel: "Restored hostel",
  resend_confirmation: "Resent confirmation email",
  password_reset: "Sent password reset",
  sign_out_everywhere: "Signed out everywhere",
  create_announcement: "Created announcement",
  end_announcement: "Ended announcement",
  complete_closure: "Completed account closure",
};
