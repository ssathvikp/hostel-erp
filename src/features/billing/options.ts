import type { BadgeTone } from "@/components/ui";
import { formatPaise } from "@/lib/money";

import type { PlanOffer, SubscriptionStatus } from "./queries";

export const STATUS_LABELS: Record<SubscriptionStatus, string> = {
  trialing: "Free trial",
  active: "Active",
  past_due: "Payment failed",
  read_only: "Read-only",
  cancelled: "Cancelled",
};

export const STATUS_TONES: Record<SubscriptionStatus, BadgeTone> = {
  trialing: "info",
  active: "success",
  past_due: "warning",
  read_only: "danger",
  cancelled: "neutral",
};

export const FEATURE_LABELS: Record<string, string> = {
  complaints: "Complaints and maintenance",
  reports: "Reports and exports",
  online_payments: "Online rent collection",
};

export const SOURCE_LABELS: Record<string, string> = {
  signup: "Sign-up",
  migration: "Migration",
  gateway: "Payment gateway",
  admin: "Hostel ERP support",
  job: "Automatic",
  owner: "You",
  system: "System",
};

const limit = (value: number | null, noun: string) =>
  value === null ? `Unlimited ${noun}` : `Up to ${value.toLocaleString("en-IN")} ${noun}`;

/** "Up to 50 beds · 1 hostel · 2 staff accounts" */
export function planLimits(plan: Pick<PlanOffer, "max_beds" | "max_hostels" | "max_staff">) {
  return [
    limit(plan.max_beds, "beds"),
    plan.max_hostels === 1 ? "1 hostel" : limit(plan.max_hostels, "hostels"),
    limit(plan.max_staff, "staff accounts"),
  ];
}

/** How a plan is priced, in words, excluding GST. */
export function pricingNote(plan: PlanOffer): string {
  if (plan.pricing_basis === "per_bed") {
    return `${formatPaise(plan.monthly_price)} per bed a month (minimum ${plan.minimum_beds} beds)`;
  }
  if (plan.pricing_basis === "tiered") {
    return plan.tiers
      .map((tier) =>
        tier.up_to_beds === null
          ? `${formatPaise(tier.monthly_price)} a month above that`
          : `${formatPaise(tier.monthly_price)} a month up to ${tier.up_to_beds} beds`,
      )
      .join(", ");
  }
  return `${formatPaise(plan.monthly_price)} a month`;
}
