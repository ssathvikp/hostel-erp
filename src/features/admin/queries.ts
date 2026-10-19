import "server-only";

import { notFound } from "next/navigation";

import { requireUser } from "@/lib/auth/session";
import type { SetupFacts } from "@/lib/hostels/activation";
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
