import type { Metadata } from "next";

import { PageHeader } from "@/components/shell/PageHeader";
import { Badge, EmptyState, Table, TBody, Td, Th, THead, Tr } from "@/components/ui";
import {
  BillingSettingsForm,
  CouponDialog,
  CouponToggle,
  PlanDialog,
} from "@/features/admin/components/BillingAdminForms";
import {
  getAdminCoupons,
  getAdminPlans,
  getBillingSettings,
} from "@/features/admin/billing-queries";
import { planLimits, pricingNote } from "@/features/billing/options";
import { requirePlatformAdmin } from "@/lib/auth/admin";
import { billingGateway } from "@/lib/billing/config";
import { formatPaise } from "@/lib/money";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Billing" };

const day = new Intl.DateTimeFormat("en-IN", { dateStyle: "medium", timeZone: "Asia/Kolkata" });

/**
 * What Hostel ERP sells and how it bills (E14-T1, T3, T6, T7, T10): plans
 * and prices, coupons, trial and grace lengths, GST and the seller's
 * details for tax invoices.
 */
export default async function AdminBillingPage() {
  await requirePlatformAdmin();
  const supabase = await createClient();
  const [plans, coupons, settings] = await Promise.all([
    getAdminPlans(supabase),
    getAdminCoupons(supabase),
    getBillingSettings(supabase),
  ]);
  const gatewayReady = billingGateway() !== null;

  return (
    <div className="space-y-10">
      <PageHeader
        title="Billing"
        description="Plans, coupons and settings for Hostel ERP's own subscriptions. Prices exclude GST."
      />
      {!gatewayReady && (
        <p className="rounded-md border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          The Razorpay keys are not set (RAZORPAY_KEY_ID, RAZORPAY_KEY_SECRET,
          RAZORPAY_WEBHOOK_SECRET), so owners cannot pay online yet. Apply plans by hand from an
          owner&apos;s page meanwhile. See docs/billing.md.
        </p>
      )}

      <section aria-labelledby="plans-heading" className="space-y-3">
        <div className="flex items-center justify-between gap-3">
          <h2 id="plans-heading" className="text-base font-semibold text-slate-900">
            Plans
          </h2>
          <PlanDialog />
        </div>
        <Table caption="Plans">
          <THead>
            <tr>
              <Th>Plan</Th>
              <Th>Price</Th>
              <Th>Limits</Th>
              <Th className="text-right">Accounts</Th>
              <Th>
                <span className="sr-only">Actions</span>
              </Th>
            </tr>
          </THead>
          <TBody>
            {plans.map((plan) => (
              <Tr key={plan.id}>
                <Td className="whitespace-normal">
                  <span className="font-medium">{plan.name}</span>{" "}
                  <span className="font-mono text-xs text-slate-500">{plan.code}</span>
                  <span className="mt-1 flex gap-1">
                    {!plan.is_active && <Badge>Retired</Badge>}
                    {plan.is_active && !plan.is_public && <Badge tone="info">Hidden</Badge>}
                  </span>
                </Td>
                <Td className="whitespace-normal text-sm">
                  {pricingNote({ ...plan, month_amount: null, year_amount: null })}
                  {plan.pricing_basis !== "tiered" && (
                    <span className="block text-xs text-slate-500">
                      {formatPaise(plan.annual_price)} a year
                      {plan.pricing_basis === "per_bed" && " per bed"}
                    </span>
                  )}
                </Td>
                <Td className="text-sm whitespace-normal">{planLimits(plan).join(" · ")}</Td>
                <Td className="text-right tabular-nums">{plan.subscribers}</Td>
                <Td className="text-right">
                  <PlanDialog plan={plan} />
                </Td>
              </Tr>
            ))}
          </TBody>
        </Table>
      </section>

      <section aria-labelledby="coupons-heading" className="space-y-3">
        <div className="flex items-center justify-between gap-3">
          <h2 id="coupons-heading" className="text-base font-semibold text-slate-900">
            Coupons
          </h2>
          <CouponDialog />
        </div>
        {coupons.length === 0 ? (
          <EmptyState title="No coupons yet" description="Launch discounts appear here." />
        ) : (
          <Table caption="Coupons">
            <THead>
              <tr>
                <Th>Code</Th>
                <Th>Discount</Th>
                <Th>Redeemed</Th>
                <Th>Valid until</Th>
                <Th>Gateway offer</Th>
                <Th>
                  <span className="sr-only">Actions</span>
                </Th>
              </tr>
            </THead>
            <TBody>
              {coupons.map((coupon) => (
                <Tr key={coupon.id} className={coupon.active ? undefined : "text-slate-400"}>
                  <Td className="font-mono">
                    {coupon.code}
                    {coupon.description && (
                      <span className="block font-sans text-xs text-slate-500">
                        {coupon.description}
                      </span>
                    )}
                  </Td>
                  <Td>
                    {coupon.percent_off !== null
                      ? `${coupon.percent_off}%`
                      : formatPaise(coupon.amount_off ?? 0)}{" "}
                    <span className="text-xs text-slate-500">
                      {coupon.duration === "once"
                        ? "first payment"
                        : coupon.duration === "forever"
                          ? "every payment"
                          : `${coupon.duration_cycles} payments`}
                    </span>
                  </Td>
                  <Td className="tabular-nums">
                    {coupon.redemptions}
                    {coupon.max_redemptions !== null && ` of ${coupon.max_redemptions}`}
                  </Td>
                  <Td>{coupon.redeem_by ? day.format(new Date(coupon.redeem_by)) : "—"}</Td>
                  <Td className="font-mono text-xs">
                    {coupon.gateway_offer_id ?? <Badge tone="warning">Missing</Badge>}
                  </Td>
                  <Td className="text-right">
                    <CouponToggle coupon={coupon} />
                  </Td>
                </Tr>
              ))}
            </TBody>
          </Table>
        )}
      </section>

      <section aria-labelledby="settings-heading" className="space-y-3">
        <h2 id="settings-heading" className="text-base font-semibold text-slate-900">
          Settings
        </h2>
        <BillingSettingsForm settings={settings} plans={plans} />
      </section>
    </div>
  );
}
