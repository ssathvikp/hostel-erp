import "server-only";

import type { createClient } from "@/lib/supabase/server";

type Supabase = Awaited<ReturnType<typeof createClient>>;

export type SubscriptionStatus = "trialing" | "active" | "past_due" | "read_only" | "cancelled";

export interface AccountStatus {
  planId: string;
  planName: string;
  status: SubscriptionStatus;
  /** What counts today: a trial past its end is read-only. */
  effectiveStatus: SubscriptionStatus;
  trialEndsAt: string | null;
  currentPeriodEnd: string | null;
  priceMonthly: number;
  canWrite: boolean;
  usage: { beds: number; hostels: number; staff: number };
  limits: { beds: number | null; hostels: number | null; staff: number | null };
}

/** The owner's subscription as this hostel's members see it (ClickUp EP-14). */
export async function getAccountStatus(
  supabase: Supabase,
  hostelId: string,
): Promise<AccountStatus | null> {
  const { data, error } = await supabase.rpc("account_status", { p_hostel_id: hostelId });
  if (error) throw error;
  const raw = data as Record<string, unknown> | null;
  if (!raw || !raw.plan_id) return null;
  return {
    planId: String(raw.plan_id),
    planName: String(raw.plan_name),
    status: raw.status as SubscriptionStatus,
    effectiveStatus: raw.effective_status as SubscriptionStatus,
    trialEndsAt: (raw.trial_ends_at as string | null) ?? null,
    currentPeriodEnd: (raw.current_period_end as string | null) ?? null,
    priceMonthly: Number(raw.price_monthly ?? 0),
    canWrite: Boolean(raw.can_write),
    usage: raw.usage as AccountStatus["usage"],
    limits: raw.limits as AccountStatus["limits"],
  };
}

export interface Plan {
  id: string;
  name: string;
  monthlyPrice: number;
  yearlyPrice: number | null;
  pricingBasis: "flat" | "per_bed" | "tiered";
  maxBeds: number | null;
  maxHostels: number | null;
  maxStaff: number | null;
  gstInclusive: boolean;
  public: boolean;
  active: boolean;
}

export async function getPlans(supabase: Supabase): Promise<Plan[]> {
  const { data, error } = await supabase.from("plans").select("*").order("position");
  if (error) throw error;
  return data.map((row) => ({
    id: row.id,
    name: row.name,
    monthlyPrice: row.monthly_price,
    yearlyPrice: row.yearly_price,
    pricingBasis: row.pricing_basis as Plan["pricingBasis"],
    maxBeds: row.max_beds,
    maxHostels: row.max_hostels,
    maxStaff: row.max_staff,
    gstInclusive: row.gst_inclusive,
    public: row.public,
    active: row.active,
  }));
}

export interface AdminSubscription {
  planId: string;
  status: SubscriptionStatus;
  effectiveStatus: SubscriptionStatus;
  trialEndsAt: string | null;
  currentPeriodEnd: string | null;
  priceMonthly: number;
  usage: { beds: number; hostels: number; staff: number };
  events: {
    fromStatus: string | null;
    toStatus: string;
    fromPlan: string | null;
    toPlan: string;
    reason: string | null;
    createdAt: string;
  }[];
}

/** One owner's subscription and its history, for platform admins. */
export async function getAdminSubscription(
  supabase: Supabase,
  ownerId: string,
): Promise<AdminSubscription | null> {
  const { data, error } = await supabase.rpc("admin_subscription", { p_owner_id: ownerId });
  if (error) throw error;
  const raw = data as Record<string, unknown> | null;
  if (!raw) return null;
  return {
    planId: String(raw.plan_id),
    status: raw.status as SubscriptionStatus,
    effectiveStatus: raw.effective_status as SubscriptionStatus,
    trialEndsAt: (raw.trial_ends_at as string | null) ?? null,
    currentPeriodEnd: (raw.current_period_end as string | null) ?? null,
    priceMonthly: Number(raw.price_monthly ?? 0),
    usage: raw.usage as AdminSubscription["usage"],
    events: ((raw.events as Record<string, unknown>[]) ?? []).map((event) => ({
      fromStatus: (event.from_status as string | null) ?? null,
      toStatus: String(event.to_status),
      fromPlan: (event.from_plan as string | null) ?? null,
      toPlan: String(event.to_plan),
      reason: (event.reason as string | null) ?? null,
      createdAt: String(event.created_at),
    })),
  };
}

export interface Revenue {
  mrr: number;
  arr: number;
  byStatus: Record<string, number>;
  byPlan: Record<string, number>;
  trialToPaid: number | null;
  trialsConverted: number;
  trialsStarted: number;
  churnThisMonth: number | null;
  cancelledThisMonth: number;
  pastDue: number;
}

export async function getRevenue(supabase: Supabase): Promise<Revenue> {
  const { data, error } = await supabase.rpc("admin_revenue");
  if (error) throw error;
  const raw = data as Record<string, unknown>;
  return {
    mrr: Number(raw.mrr ?? 0),
    arr: Number(raw.arr ?? 0),
    byStatus: (raw.by_status as Record<string, number>) ?? {},
    byPlan: (raw.by_plan as Record<string, number>) ?? {},
    trialToPaid: raw.trial_to_paid === null ? null : Number(raw.trial_to_paid),
    trialsConverted: Number(raw.trials_converted ?? 0),
    trialsStarted: Number(raw.trials_started ?? 0),
    churnThisMonth: raw.churn_this_month === null ? null : Number(raw.churn_this_month),
    cancelledThisMonth: Number(raw.cancelled_this_month ?? 0),
    pastDue: Number(raw.past_due ?? 0),
  };
}
