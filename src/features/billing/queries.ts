import "server-only";

import type { createClient } from "@/lib/supabase/server";

type Client = Awaited<ReturnType<typeof createClient>>;

/** Account billing state as the database derives it (EP-14). */

export type SubscriptionStatus = "trialing" | "active" | "past_due" | "read_only" | "cancelled";
export type BillingInterval = "month" | "year";
export type PricingBasis = "flat" | "per_bed" | "tiered";

export interface PlanTier {
  up_to_beds: number | null;
  monthly_price: number;
  annual_price: number;
}

export interface PlanOffer {
  id: string;
  code: string;
  name: string;
  description: string | null;
  pricing_basis: PricingBasis;
  monthly_price: number;
  annual_price: number;
  minimum_beds: number;
  tiers: PlanTier[];
  max_beds: number | null;
  max_hostels: number | null;
  max_staff: number | null;
  features: string[];
  /** This account's price per period at its current bed count, excluding GST. */
  month_amount: number | null;
  year_amount: number | null;
}

export interface AccountUsage {
  beds: number;
  hostels: number;
  staff: number;
}

export interface BillingOverview {
  subscription: {
    id: string;
    status: SubscriptionStatus;
    billing_interval: BillingInterval;
    trial_ends_at: string | null;
    current_period_start: string | null;
    current_period_end: string | null;
    amount: number;
    amount_with_gst: number;
    cancel_at_period_end: boolean;
    cancel_reason: string | null;
    past_due_since: string | null;
    complimentary: boolean;
    has_gateway: boolean;
    pending_plan: string | null;
    pending_interval: BillingInterval | null;
    checkout_started_at: string | null;
    can_write: boolean;
    grace_ends_at: string | null;
  };
  plan: PlanOffer;
  usage: AccountUsage;
  plans: PlanOffer[];
  gst_rate_bps: number;
  grace_days: number;
  profile: {
    legal_name: string;
    gstin: string | null;
    address: string;
    state_code: string;
    billing_email: string | null;
  } | null;
  invoices: {
    id: string;
    kind: "invoice" | "credit_note";
    number: string;
    issued_at: string;
    description: string;
    total: number;
  }[];
  history: {
    created_at: string;
    source: string;
    from_status: SubscriptionStatus | null;
    to_status: SubscriptionStatus;
    plan: string | null;
    reason: string | null;
  }[];
}

/** The signed-in owner's billing page data, or null before their first hostel. */
export async function getBillingOverview(supabase: Client): Promise<BillingOverview | null> {
  const { data, error } = await supabase.rpc("billing_overview");
  if (error) throw error;
  return (data as unknown as BillingOverview | null) ?? null;
}

export interface AccountState {
  status: SubscriptionStatus;
  can_write: boolean;
  plan_code: string;
  plan_name: string;
  trial_ends_at: string | null;
  current_period_end: string | null;
  cancel_at_period_end: boolean;
  grace_ends_at: string | null;
  complimentary: boolean;
}

/** Whether the account behind a hostel can work, for owners and staff alike. */
export async function getAccountState(
  supabase: Client,
  hostelId: string,
): Promise<AccountState | null> {
  const { data, error } = await supabase.rpc("hostel_account_state", { p_hostel_id: hostelId });
  if (error) throw error;
  return (data as unknown as AccountState | null) ?? null;
}

export interface PlatformInvoice {
  id: string;
  kind: "invoice" | "credit_note";
  number: string;
  issued_at: string;
  period_start: string | null;
  period_end: string | null;
  description: string;
  seller: {
    legal_name: string | null;
    address: string | null;
    gstin: string | null;
    state_code: string | null;
    email: string | null;
  };
  buyer: {
    legal_name: string | null;
    address: string | null;
    gstin: string | null;
    state_code: string | null;
    email: string | null;
  };
  sac_code: string;
  place_of_supply: string | null;
  gst_rate_bps: number;
  taxable_value: number;
  cgst: number;
  sgst: number;
  igst: number;
  total: number;
  original_number: string | null;
}

/** One of the owner's tax documents; RLS returns nothing for anyone else's. */
export async function getPlatformInvoice(
  supabase: Client,
  id: string,
): Promise<PlatformInvoice | null> {
  const { data, error } = await supabase
    .from("platform_invoices")
    .select(
      "id, kind, number, issued_at, period_start, period_end, description, seller, buyer, sac_code, place_of_supply, gst_rate_bps, taxable_value, cgst, sgst, igst, total, original:original_invoice_id(number)",
    )
    .eq("id", id)
    .maybeSingle();
  if (error) throw error;
  if (!data) return null;
  const { original, ...rest } = data as typeof data & { original: { number: string } | null };
  return {
    ...(rest as unknown as Omit<PlatformInvoice, "original_number">),
    original_number: original?.number ?? null,
  };
}
