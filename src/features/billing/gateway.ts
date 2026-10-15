import "server-only";

import type { BillingGateway } from "@/lib/billing/config";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * The app's side of talking to Razorpay for subscription billing (E14-T5).
 * The database decides what may be bought and records what the gateway
 * confirms; these helpers only carry the gateway calls in between.
 */

export type BillingInterval = "month" | "year";

/** Monthly plans run for ten years and annual plans for ten renewals. */
const TOTAL_COUNT: Record<BillingInterval, number> = { month: 120, year: 10 };

interface GatewayPlanNeed {
  plan_id: string;
  plan_code: string;
  plan_name: string;
  interval: BillingInterval;
  amount_with_gst: number;
  gateway_plan_id: string | null;
}

/**
 * The Razorpay plan for this (plan, interval, amount), created and recorded
 * on first use. Two simultaneous first checkouts may both create one; the
 * first recorded wins and the other stays unused at the gateway.
 */
export async function ensureGatewayPlan(gateway: BillingGateway, need: GatewayPlanNeed) {
  if (need.gateway_plan_id) return need.gateway_plan_id;
  const created = await gateway.client.createPlan({
    period: need.interval === "year" ? "yearly" : "monthly",
    amount: need.amount_with_gst,
    name: `Hostel ERP ${need.plan_name}`,
    description: `${need.plan_name}, ${need.interval === "year" ? "annual" : "monthly"}, GST included`,
    notes: { plan_code: need.plan_code, interval: need.interval },
  });
  const admin = createAdminClient();
  const { error } = await admin.rpc("billing_record_gateway_plan", {
    p_plan_id: need.plan_id,
    p_interval: need.interval,
    p_amount: need.amount_with_gst,
    p_gateway_plan_id: created.id,
  });
  if (error) throw error;
  const { data } = await admin
    .from("gateway_plans")
    .select("gateway_plan_id")
    .eq("plan_id", need.plan_id)
    .eq("billing_interval", need.interval)
    .eq("amount", need.amount_with_gst)
    .single();
  return data?.gateway_plan_id ?? created.id;
}

export interface CheckoutNeed extends GatewayPlanNeed {
  subscription_id: string;
  offer_id: string | null;
  owner_email: string;
  owner_phone: string | null;
}

/** Creates the gateway subscription and returns the hosted page to send the owner to. */
export async function startGatewayCheckout(gateway: BillingGateway, need: CheckoutNeed) {
  const gatewayPlanId = await ensureGatewayPlan(gateway, need);
  const subscription = await gateway.client.createSubscription({
    planId: gatewayPlanId,
    totalCount: TOTAL_COUNT[need.interval],
    offerId: need.offer_id,
    notes: { subscription_ref: need.subscription_id, plan_code: need.plan_code },
    notifyEmail: need.owner_email,
    notifyPhone: need.owner_phone,
  });
  const { error } = await createAdminClient().rpc("billing_attach_checkout", {
    p_subscription_id: need.subscription_id,
    p_gateway_subscription_id: subscription.id,
    p_gateway_customer_id: subscription.customer_id ?? "",
    p_gateway_plan_id: gatewayPlanId,
  });
  if (error) throw error;
  if (!subscription.short_url) throw new Error("The gateway returned no checkout link");
  return subscription.short_url;
}

/**
 * After a renewal: if today's price (plan, pending plan or bed count
 * changed) needs a different gateway plan, schedule it for the next cycle.
 */
export async function syncRenewalPrice(gateway: BillingGateway, gatewaySubscriptionId: string) {
  const admin = createAdminClient();
  const { data, error } = await admin.rpc("billing_renewal_target", {
    p_gateway_subscription_id: gatewaySubscriptionId,
  });
  if (error) throw error;
  if (!data) return;
  const target = data as unknown as GatewayPlanNeed & {
    subscription_id: string;
    current_gateway_plan_id: string | null;
  };
  const gatewayPlanId = await ensureGatewayPlan(gateway, target);
  if (gatewayPlanId === target.current_gateway_plan_id) return;
  await gateway.client.updateSubscription(gatewaySubscriptionId, {
    planId: gatewayPlanId,
    when: "cycle_end",
  });
  const recorded = await admin.rpc("billing_set_gateway_plan", {
    p_subscription_id: target.subscription_id,
    p_gateway_plan_id: gatewayPlanId,
  });
  if (recorded.error) throw recorded.error;
}
