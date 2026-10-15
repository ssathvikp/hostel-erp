import "server-only";

import type { PlanOffer, SubscriptionStatus } from "@/features/billing/queries";
import type { createClient } from "@/lib/supabase/server";

type Supabase = Awaited<ReturnType<typeof createClient>>;

/** Admin reads for billing (E10-T7, E14-T1, T10, T12). Admin-only functions and policies. */

export interface AccountBilling {
  status: SubscriptionStatus;
  plan_code: string;
  plan_name: string;
  billing_interval: "month" | "year";
  amount: number;
  trial_ends_at: string | null;
  current_period_end: string | null;
  next_billing_at: string | null;
  cancel_at_period_end: boolean;
  complimentary: boolean;
  can_write: boolean;
  gateway_subscription_id: string | null;
  pending_plan: string | null;
  usage: { beds: number; hostels: number; staff: number };
  history: {
    created_at: string;
    source: string;
    from_status: SubscriptionStatus | null;
    to_status: SubscriptionStatus;
    reason: string | null;
    plan: string | null;
  }[];
}

/** Billing per account id, for the owner directory and owner page. */
export async function getAccountsBilling(
  supabase: Supabase,
  ids: string[],
): Promise<Record<string, AccountBilling>> {
  if (ids.length === 0) return {};
  const { data, error } = await supabase.rpc("admin_account_billing", { p_account_ids: ids });
  if (error) throw error;
  return (data ?? {}) as unknown as Record<string, AccountBilling>;
}

export type AdminPlan = Omit<PlanOffer, "month_amount" | "year_amount"> & {
  is_public: boolean;
  is_active: boolean;
  sort_order: number;
  subscribers: number;
};

/** Every plan, hidden and retired ones included, with how many accounts use it. */
export async function getAdminPlans(supabase: Supabase): Promise<AdminPlan[]> {
  const [{ data: plans, error }, { data: subs, error: subsError }] = await Promise.all([
    supabase
      .from("plans")
      .select(
        "id, code, name, description, pricing_basis, monthly_price, annual_price, minimum_beds, tiers, max_beds, max_hostels, max_staff, features, is_public, is_active, sort_order",
      )
      .order("sort_order")
      .order("name"),
    supabase.from("subscriptions").select("plan_id"),
  ]);
  if (error) throw error;
  if (subsError) throw subsError;
  const counts = new Map<string, number>();
  for (const row of subs ?? []) counts.set(row.plan_id, (counts.get(row.plan_id) ?? 0) + 1);
  return (plans ?? []).map((plan) => ({
    ...(plan as unknown as Omit<AdminPlan, "subscribers">),
    subscribers: counts.get(plan.id) ?? 0,
  }));
}

export interface AdminCoupon {
  id: string;
  code: string;
  description: string | null;
  percent_off: number | null;
  amount_off: number | null;
  duration: "once" | "repeating" | "forever";
  duration_cycles: number | null;
  max_redemptions: number | null;
  redeem_by: string | null;
  gateway_offer_id: string | null;
  active: boolean;
  created_at: string;
  redemptions: number;
}

export async function getAdminCoupons(supabase: Supabase): Promise<AdminCoupon[]> {
  const { data, error } = await supabase.rpc("admin_coupons");
  if (error) throw error;
  return (data ?? []) as unknown as AdminCoupon[];
}

export interface BillingSettings {
  trial_days: number;
  trial_plan_code: string;
  grace_days: number;
  gst_rate_bps: number;
  sac_code: string;
  seller_legal_name: string | null;
  seller_address: string | null;
  seller_gstin: string | null;
  seller_state_code: string | null;
  seller_email: string | null;
  terms_version: string;
}

export async function getBillingSettings(supabase: Supabase): Promise<BillingSettings> {
  const { data, error } = await supabase
    .from("billing_settings")
    .select(
      "trial_days, trial_plan_code, grace_days, gst_rate_bps, sac_code, seller_legal_name, seller_address, seller_gstin, seller_state_code, seller_email, terms_version",
    )
    .single();
  if (error) throw error;
  return data;
}

export interface RevenueMetrics {
  mrr: number;
  arr: number;
  paying: number;
  by_status: Record<SubscriptionStatus, number>;
  complimentary: number;
  trial_conversion: number | null;
  trials_finished_90_days: number;
  monthly_churn: number | null;
  churned_30_days: number;
  past_due: { count: number; amount: number };
  invoiced_by_month: { month: string; invoiced: number }[];
}

export async function getRevenueMetrics(supabase: Supabase): Promise<RevenueMetrics> {
  const { data, error } = await supabase.rpc("admin_revenue_metrics");
  if (error) throw error;
  return data as unknown as RevenueMetrics;
}
