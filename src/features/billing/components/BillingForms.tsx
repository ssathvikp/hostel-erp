"use client";

import { useActionState, useEffect, useState } from "react";

import { Alert, Badge, Button, Input, Modal, Select, Textarea } from "@/components/ui";
import { cn } from "@/lib/cn";
import { formatPaise } from "@/lib/money";
import { annualSaving, GST_STATES, previewPlanChange, withGst } from "@/lib/billing/pricing";
import { initialFormState } from "@/lib/validation/result";

import { cancelPlan, changePlan, saveBillingProfile, startCheckout } from "../actions";
import { FEATURE_LABELS, planLimits, pricingNote } from "../options";
import type { BillingOverview, PlanOffer } from "../queries";

const day = new Intl.DateTimeFormat("en-IN", { dateStyle: "medium", timeZone: "Asia/Kolkata" });

type Interval = "month" | "year";

/** Monthly / annual toggle for the plan cards. */
function IntervalToggle({ value, onChange }: { value: Interval; onChange: (v: Interval) => void }) {
  return (
    <fieldset className="inline-flex rounded-md border border-slate-300 p-0.5">
      <legend className="sr-only">Billing period</legend>
      {(["month", "year"] as const).map((option) => (
        <label
          key={option}
          className={cn(
            "cursor-pointer rounded px-3 py-1 text-sm font-medium has-focus-visible:outline-2 has-focus-visible:outline-brand-600",
            value === option ? "bg-brand-600 text-white" : "text-slate-700 hover:bg-slate-100",
          )}
        >
          <input
            type="radio"
            name="billing-period"
            value={option}
            checked={value === option}
            onChange={() => onChange(option)}
            className="sr-only"
          />
          {option === "month" ? "Monthly" : "Annual"}
        </label>
      ))}
    </fieldset>
  );
}

function PlanCard({
  plan,
  interval,
  gstRateBps,
  current,
  children,
}: {
  plan: PlanOffer;
  interval: Interval;
  gstRateBps: number;
  current: boolean;
  children: React.ReactNode;
}) {
  const amount = interval === "month" ? plan.month_amount : plan.year_amount;
  const saving =
    plan.month_amount && plan.year_amount ? annualSaving(plan.month_amount, plan.year_amount) : 0;
  return (
    <li
      className={cn(
        "flex flex-col rounded-lg border bg-white p-4",
        current ? "border-brand-600 ring-1 ring-brand-600" : "border-slate-200",
      )}
    >
      <div className="flex items-start justify-between gap-2">
        <h3 className="text-base font-semibold text-slate-900">{plan.name}</h3>
        {current && <Badge tone="info">Your plan</Badge>}
      </div>
      {plan.description && <p className="mt-1 text-sm text-slate-600">{plan.description}</p>}
      <p className="mt-3 text-2xl font-semibold text-slate-900 tabular-nums">
        {amount === null ? "—" : formatPaise(amount)}
        <span className="text-sm font-normal text-slate-500">
          {interval === "month" ? " / month" : " / year"} + GST
        </span>
      </p>
      {amount !== null && (
        <p className="text-xs text-slate-500">
          {formatPaise(withGst(amount, gstRateBps))} including GST, for your current beds
          {interval === "year" && saving > 0 && ` · about ${saving} months free`}
        </p>
      )}
      <p className="mt-2 text-xs text-slate-500">{pricingNote(plan)}, excluding GST</p>
      <ul className="mt-3 space-y-1 text-sm text-slate-700">
        {planLimits(plan).map((line) => (
          <li key={line}>{line}</li>
        ))}
        {plan.features.map((feature) => (
          <li key={feature}>{FEATURE_LABELS[feature] ?? feature}</li>
        ))}
      </ul>
      <div className="mt-4 flex grow items-end">{children}</div>
    </li>
  );
}

/** Choose a plan and go to the gateway's hosted checkout (E14-T5). */
export function PlanPicker({
  overview,
  gatewayReady,
}: {
  overview: BillingOverview;
  gatewayReady: boolean;
}) {
  const [interval, setInterval] = useState<Interval>(overview.subscription.billing_interval);
  const [state, formAction, pending] = useActionState(startCheckout, initialFormState);
  const [plan, setPlan] = useState<string | null>(null);

  return (
    <section aria-labelledby="choose-plan-heading" className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 id="choose-plan-heading" className="text-lg font-semibold text-slate-900">
            Choose a plan
          </h2>
          <p className="text-sm text-slate-600">
            Prices exclude GST at {overview.gst_rate_bps / 100}%. You pay on Razorpay&apos;s secure
            page by UPI AutoPay or card; we never see your card or UPI details.
          </p>
        </div>
        <IntervalToggle value={interval} onChange={setInterval} />
      </div>
      {!gatewayReady && (
        <Alert tone="warning">
          Online payment is not set up yet. Contact Hostel ERP support to activate a plan.
        </Alert>
      )}
      {state.formError && <Alert tone="error">{state.formError}</Alert>}
      <form key={state.id} action={formAction} className="space-y-4">
        <input type="hidden" name="interval" value={interval} />
        <ul className="grid gap-4 md:grid-cols-3">
          {overview.plans.map((offer) => (
            <PlanCard
              key={offer.id}
              plan={offer}
              interval={interval}
              gstRateBps={overview.gst_rate_bps}
              current={false}
            >
              <Button
                type="submit"
                name="plan"
                value={offer.code}
                className="w-full"
                disabled={!gatewayReady || pending}
                loading={pending && plan === offer.code}
                onClick={() => setPlan(offer.code)}
                aria-label={`Choose ${offer.name}, ${interval === "month" ? "monthly" : "annual"}`}
              >
                Choose {offer.name}
              </Button>
            </PlanCard>
          ))}
        </ul>
        <div className="max-w-xs">
          <Input
            id="coupon"
            name="coupon"
            label="Coupon code"
            autoComplete="off"
            maxLength={30}
            defaultValue={state.values?.coupon ?? ""}
            hint="Optional. Applied by the payment gateway."
            error={state.fieldErrors.coupon?.[0]}
          />
        </div>
      </form>
    </section>
  );
}

/** Switch plan or billing period on a paid subscription (E14-T8). */
export function ChangePlan({
  overview,
  gatewayReady,
}: {
  overview: BillingOverview;
  gatewayReady: boolean;
}) {
  const { subscription, plan: currentPlan } = overview;
  const [interval, setInterval] = useState<Interval>(subscription.billing_interval);
  const [target, setTarget] = useState<PlanOffer | null>(null);
  const [state, formAction, pending] = useActionState(changePlan, initialFormState);
  useEffect(() => {
    if (state.status === "success") setTarget(null);
  }, [state]);

  const amountOf = (offer: PlanOffer) =>
    (interval === "month" ? offer.month_amount : offer.year_amount) ?? 0;
  const preview = target
    ? previewPlanChange(
        {
          amount: subscription.amount,
          interval: subscription.billing_interval,
          periodStart: subscription.current_period_start,
          periodEnd: subscription.current_period_end,
        },
        { amount: amountOf(target), interval },
      )
    : null;

  return (
    <section aria-labelledby="change-plan-heading" className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 id="change-plan-heading" className="text-lg font-semibold text-slate-900">
            Change plan
          </h2>
          <p className="text-sm text-slate-600">
            Upgrades start now and you pay the difference for the rest of this period. Downgrades
            and switching between monthly and annual take effect at your next renewal.
          </p>
        </div>
        <IntervalToggle value={interval} onChange={setInterval} />
      </div>
      {state.status === "success" && <Alert tone="success">{state.message}</Alert>}
      <ul className="grid gap-4 md:grid-cols-3">
        {overview.plans.map((offer) => {
          const current =
            offer.code === currentPlan.code && interval === subscription.billing_interval;
          return (
            <PlanCard
              key={offer.id}
              plan={offer}
              interval={interval}
              gstRateBps={overview.gst_rate_bps}
              current={current}
            >
              {!current && (
                <Button
                  variant="secondary"
                  className="w-full"
                  disabled={!gatewayReady}
                  onClick={() => setTarget(offer)}
                >
                  Switch to {offer.name}
                </Button>
              )}
            </PlanCard>
          );
        })}
      </ul>
      <Modal
        open={target !== null}
        onClose={() => setTarget(null)}
        title={target ? `Switch to ${target.name}` : "Switch plan"}
        description={
          target && preview
            ? preview.effect === "now"
              ? `Starts now. For the rest of this period you pay about ${formatPaise(withGst(preview.proration, overview.gst_rate_bps))} including GST, then ${formatPaise(withGst(amountOf(target), overview.gst_rate_bps))} each ${interval === "month" ? "month" : "year"}.`
              : `Starts at your next renewal${subscription.current_period_end ? ` on ${day.format(new Date(subscription.current_period_end))}` : ""}, then ${formatPaise(withGst(amountOf(target), overview.gst_rate_bps))} each ${interval === "month" ? "month" : "year"} including GST.`
            : undefined
        }
        footer={
          <>
            <Button variant="secondary" onClick={() => setTarget(null)}>
              Keep my plan
            </Button>
            <Button type="submit" form="change-plan-form" loading={pending}>
              Confirm switch
            </Button>
          </>
        }
      >
        <form key={state.id} id="change-plan-form" action={formAction} className="space-y-3">
          {state.formError && <Alert tone="error">{state.formError}</Alert>}
          <input type="hidden" name="plan" value={target?.code ?? ""} />
          <input type="hidden" name="interval" value={interval} />
        </form>
      </Modal>
    </section>
  );
}

/** Cancel at the end of the paid period, with a reason (E14-T8). */
export function CancelPlan({ periodEnd }: { periodEnd: string | null }) {
  const [open, setOpen] = useState(false);
  const [state, formAction, pending] = useActionState(cancelPlan, initialFormState);
  useEffect(() => {
    if (state.status === "success") setOpen(false);
  }, [state]);
  return (
    <>
      <Button variant="secondary" onClick={() => setOpen(true)}>
        Cancel plan
      </Button>
      {state.status === "success" && <Alert tone="success">{state.message}</Alert>}
      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title="Cancel your plan"
        description={`You keep full access until ${periodEnd ? day.format(new Date(periodEnd)) : "the end of this period"}. After that your account becomes read-only: nothing is deleted, and you can choose a plan again at any time.`}
        footer={
          <>
            <Button variant="secondary" onClick={() => setOpen(false)}>
              Keep my plan
            </Button>
            <Button type="submit" form="cancel-plan-form" variant="danger" loading={pending}>
              Cancel plan
            </Button>
          </>
        }
      >
        <form
          key={state.id}
          id="cancel-plan-form"
          action={formAction}
          noValidate
          className="space-y-4"
        >
          {state.formError && <Alert tone="error">{state.formError}</Alert>}
          <Textarea
            id="cancel-reason"
            name="reason"
            label="Why are you cancelling?"
            required
            rows={3}
            maxLength={500}
            defaultValue={state.values?.reason ?? ""}
            hint="It helps us improve Hostel ERP."
            error={state.fieldErrors.reason?.[0]}
          />
        </form>
      </Modal>
    </>
  );
}

/** Business name, GSTIN and address for B2B tax invoices (E14-T6). */
export function BillingProfileForm({ profile }: { profile: BillingOverview["profile"] }) {
  const [state, formAction, pending] = useActionState(saveBillingProfile, initialFormState);
  const value = (name: keyof NonNullable<BillingOverview["profile"]>) =>
    state.values?.[name] ?? profile?.[name] ?? "";
  return (
    <form key={state.id} action={formAction} noValidate className="space-y-4">
      {state.formError && <Alert tone="error">{state.formError}</Alert>}
      {state.status === "success" && <Alert tone="success">{state.message}</Alert>}
      <div className="grid gap-4 sm:grid-cols-2">
        <Input
          id="legal_name"
          label="Business name"
          required
          maxLength={120}
          defaultValue={value("legal_name")}
          error={state.fieldErrors.legal_name?.[0]}
        />
        <Input
          id="gstin"
          label="GSTIN"
          maxLength={15}
          autoComplete="off"
          className="uppercase"
          defaultValue={value("gstin")}
          hint="Optional. Add it to claim input tax credit."
          error={state.fieldErrors.gstin?.[0]}
        />
        <Textarea
          id="address"
          label="Billing address"
          required
          rows={2}
          maxLength={300}
          defaultValue={value("address")}
          error={state.fieldErrors.address?.[0]}
        />
        <div className="space-y-4">
          <Select
            id="state_code"
            label="State"
            required
            placeholder="Choose a state"
            options={GST_STATES.map((s) => ({ value: s.code, label: s.name }))}
            defaultValue={value("state_code")}
            error={state.fieldErrors.state_code?.[0]}
          />
          <Input
            id="billing_email"
            type="email"
            label="Invoice email"
            maxLength={200}
            defaultValue={value("billing_email")}
            hint="Optional. Defaults to your sign-in email."
            error={state.fieldErrors.billing_email?.[0]}
          />
        </div>
      </div>
      <Button type="submit" loading={pending}>
        Save billing details
      </Button>
    </form>
  );
}
