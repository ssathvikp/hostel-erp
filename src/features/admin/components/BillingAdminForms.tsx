"use client";

import { useActionState, useEffect, useState } from "react";

import { Alert, Button, Checkbox, Input, Modal, Select, Textarea } from "@/components/ui";
import { GST_STATES } from "@/lib/billing/pricing";
import { paiseToInput } from "@/lib/money";
import { initialFormState, type FormState } from "@/lib/validation/result";

import {
  adjustAccount,
  createCoupon,
  saveBillingSettings,
  savePlan,
  setCouponActive,
} from "../billing-actions";
import type { AdminCoupon, AdminPlan, BillingSettings } from "../billing-queries";

type Action = (previous: FormState, formData: FormData) => Promise<FormState>;

/** A button that opens a form in a dialog and closes it on success. */
function FormDialog({
  action,
  label,
  title,
  description,
  confirmLabel,
  formId,
  variant = "secondary",
  children,
}: {
  action: Action;
  label: string;
  title: string;
  description?: string;
  confirmLabel: string;
  formId: string;
  variant?: "primary" | "secondary";
  children: (state: FormState) => React.ReactNode;
}) {
  const [state, formAction, pending] = useActionState(action, initialFormState);
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (state.status === "success") setOpen(false);
  }, [state]);
  return (
    <>
      <Button size="sm" variant={variant} onClick={() => setOpen(true)}>
        {label}
      </Button>
      {state.status === "success" && (
        <p role="status" className="text-sm text-emerald-700">
          {state.message}
        </p>
      )}
      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title={title}
        description={description}
        footer={
          <>
            <Button variant="secondary" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" form={formId} loading={pending}>
              {confirmLabel}
            </Button>
          </>
        }
      >
        <form key={state.id} id={formId} action={formAction} noValidate className="space-y-4">
          {state.formError && <Alert tone="error">{state.formError}</Alert>}
          {children(state)}
        </form>
      </Modal>
    </>
  );
}

function ReasonField({ id, state }: { id: string; state: FormState }) {
  return (
    <Textarea
      id={`${id}-reason`}
      name="reason"
      label="Reason"
      required
      rows={2}
      maxLength={500}
      defaultValue={state.values?.reason ?? ""}
      hint="Recorded in the audit log and the account's billing history."
      error={state.fieldErrors.reason?.[0]}
    />
  );
}

const planOptions = (plans: Pick<AdminPlan, "code" | "name">[]) =>
  plans.map((plan) => ({ value: plan.code, label: plan.name }));

// ---------------------------------------------------------------------------
// Account adjustments (E10-T7)
// ---------------------------------------------------------------------------

export function ExtendTrialButton({ accountId }: { accountId: string }) {
  const formId = `extend-trial-${accountId}`;
  return (
    <FormDialog
      action={adjustAccount}
      label="Extend trial"
      title="Extend the free trial"
      description="Adds days from today or from the current trial end, whichever is later. A trial that already ended reopens."
      confirmLabel="Extend trial"
      formId={formId}
    >
      {(state) => (
        <>
          <input type="hidden" name="action" value="extend_trial" />
          <input type="hidden" name="account_id" value={accountId} />
          <Input
            id={`${formId}-days`}
            name="days"
            type="number"
            inputMode="numeric"
            min={1}
            max={90}
            label="Days to add"
            required
            defaultValue={state.values?.days ?? "7"}
            error={state.fieldErrors.days?.[0]}
          />
          <ReasonField id={formId} state={state} />
        </>
      )}
    </FormDialog>
  );
}

export function ComplimentaryButton({
  accountId,
  plans,
}: {
  accountId: string;
  plans: Pick<AdminPlan, "code" | "name">[];
}) {
  const formId = `complimentary-${accountId}`;
  return (
    <FormDialog
      action={adjustAccount}
      label="Make complimentary"
      title="Apply a complimentary plan"
      description="The account gets the plan free, with no gateway charge. Leave the end date empty for no end; on the end date it becomes read-only unless they subscribe."
      confirmLabel="Apply"
      formId={formId}
    >
      {(state) => (
        <>
          <input type="hidden" name="action" value="complimentary" />
          <input type="hidden" name="account_id" value={accountId} />
          <Select
            id={`${formId}-plan`}
            name="plan"
            label="Plan"
            required
            placeholder="Choose a plan"
            options={planOptions(plans)}
            defaultValue={state.values?.plan ?? ""}
            error={state.fieldErrors.plan?.[0]}
          />
          <Input
            id={`${formId}-until`}
            name="until"
            type="date"
            label="Free until"
            defaultValue={state.values?.until ?? ""}
            error={state.fieldErrors.until?.[0]}
          />
          <ReasonField id={formId} state={state} />
        </>
      )}
    </FormDialog>
  );
}

export function CorrectPlanButton({
  accountId,
  plans,
  current,
}: {
  accountId: string;
  plans: Pick<AdminPlan, "code" | "name">[];
  current: { plan: string; interval: "month" | "year" };
}) {
  const formId = `correct-plan-${accountId}`;
  return (
    <FormDialog
      action={adjustAccount}
      label="Correct plan"
      title="Correct the recorded plan"
      description="Changes our record only. Nothing is charged or refunded, and the gateway subscription is not touched: change that in the Razorpay dashboard if it is also wrong."
      confirmLabel="Save correction"
      formId={formId}
    >
      {(state) => (
        <>
          <input type="hidden" name="action" value="correct_plan" />
          <input type="hidden" name="account_id" value={accountId} />
          <Select
            id={`${formId}-plan`}
            name="plan"
            label="Plan"
            required
            options={planOptions(plans)}
            defaultValue={state.values?.plan ?? current.plan}
            error={state.fieldErrors.plan?.[0]}
          />
          <Select
            id={`${formId}-interval`}
            name="interval"
            label="Billing"
            required
            options={[
              { value: "month", label: "Monthly" },
              { value: "year", label: "Annual" },
            ]}
            defaultValue={state.values?.interval ?? current.interval}
            error={state.fieldErrors.interval?.[0]}
          />
          <ReasonField id={formId} state={state} />
        </>
      )}
    </FormDialog>
  );
}

// ---------------------------------------------------------------------------
// Plans (E14-T1)
// ---------------------------------------------------------------------------

const FEATURES = [
  { value: "complaints", label: "Complaints and maintenance" },
  { value: "reports", label: "Reports and exports" },
  { value: "online_payments", label: "Online rent collection" },
];

export function PlanDialog({ plan }: { plan?: AdminPlan }) {
  const formId = `plan-${plan?.code ?? "new"}`;
  const tiersText = (plan?.tiers ?? [])
    .map(
      (tier) =>
        `${tier.up_to_beds ?? ""}, ${paiseToInput(tier.monthly_price)}, ${paiseToInput(tier.annual_price)}`,
    )
    .join("\n");
  return (
    <FormDialog
      action={savePlan}
      label={plan ? "Edit" : "Add plan"}
      variant={plan ? "secondary" : "primary"}
      title={plan ? `Edit ${plan.name}` : "Add a plan"}
      description="Prices exclude GST. A price change reaches running subscriptions only when they renew."
      confirmLabel="Save plan"
      formId={formId}
    >
      {(state) => {
        const v = (name: string, fallback: string) => state.values?.[name] ?? fallback;
        return (
          <>
            <div className="grid gap-4 sm:grid-cols-2">
              <Input
                id={`${formId}-code`}
                name="code"
                label="Code"
                required
                readOnly={Boolean(plan)}
                defaultValue={v("code", plan?.code ?? "")}
                hint={plan ? "Codes cannot change." : "For example growth_2027."}
                error={state.fieldErrors.code?.[0]}
              />
              <Input
                id={`${formId}-name`}
                name="name"
                label="Name"
                required
                maxLength={60}
                defaultValue={v("name", plan?.name ?? "")}
                error={state.fieldErrors.name?.[0]}
              />
            </div>
            <Input
              id={`${formId}-description`}
              name="description"
              label="Description"
              maxLength={300}
              defaultValue={v("description", plan?.description ?? "")}
              error={state.fieldErrors.description?.[0]}
            />
            <Select
              id={`${formId}-basis`}
              name="pricing_basis"
              label="Priced"
              required
              options={[
                { value: "flat", label: "Flat price" },
                { value: "per_bed", label: "Per bed" },
                { value: "tiered", label: "Tiered by beds" },
              ]}
              defaultValue={v("pricing_basis", plan?.pricing_basis ?? "flat")}
              error={state.fieldErrors.pricing_basis?.[0]}
            />
            <div className="grid gap-4 sm:grid-cols-3">
              <Input
                id={`${formId}-monthly`}
                name="monthly_price"
                inputMode="decimal"
                label="Monthly ₹ (flat or per bed)"
                required
                defaultValue={v("monthly_price", plan ? paiseToInput(plan.monthly_price) : "0")}
                error={state.fieldErrors.monthly_price?.[0]}
              />
              <Input
                id={`${formId}-annual`}
                name="annual_price"
                inputMode="decimal"
                label="Annual ₹ (flat or per bed)"
                required
                defaultValue={v("annual_price", plan ? paiseToInput(plan.annual_price) : "0")}
                error={state.fieldErrors.annual_price?.[0]}
              />
              <Input
                id={`${formId}-minimum`}
                name="minimum_beds"
                type="number"
                min={1}
                label="Minimum beds billed"
                required
                defaultValue={v("minimum_beds", String(plan?.minimum_beds ?? 1))}
                error={state.fieldErrors.minimum_beds?.[0]}
              />
            </div>
            <Textarea
              id={`${formId}-tiers`}
              name="tiers"
              label="Tiers (tiered plans only)"
              rows={3}
              defaultValue={v("tiers", tiersText)}
              hint="One per line: up to beds, monthly ₹, annual ₹. Leave beds empty on the last line for no limit."
              error={state.fieldErrors.tiers?.[0]}
            />
            <div className="grid gap-4 sm:grid-cols-3">
              <Input
                id={`${formId}-beds`}
                name="max_beds"
                type="number"
                min={1}
                label="Bed limit"
                defaultValue={v("max_beds", plan?.max_beds?.toString() ?? "")}
                hint="Empty for no limit."
                error={state.fieldErrors.max_beds?.[0]}
              />
              <Input
                id={`${formId}-hostels`}
                name="max_hostels"
                type="number"
                min={1}
                label="Hostel limit"
                defaultValue={v("max_hostels", plan?.max_hostels?.toString() ?? "")}
                error={state.fieldErrors.max_hostels?.[0]}
              />
              <Input
                id={`${formId}-staff`}
                name="max_staff"
                type="number"
                min={0}
                label="Staff limit"
                defaultValue={v("max_staff", plan?.max_staff?.toString() ?? "")}
                error={state.fieldErrors.max_staff?.[0]}
              />
            </div>
            <fieldset className="space-y-2">
              <legend className="text-sm font-medium text-slate-800">Features</legend>
              {FEATURES.map((feature) => (
                <Checkbox
                  key={feature.value}
                  id={`${formId}-feature-${feature.value}`}
                  name="features"
                  value={feature.value}
                  label={feature.label}
                  defaultChecked={plan ? plan.features.includes(feature.value) : true}
                />
              ))}
            </fieldset>
            <div className="flex flex-wrap gap-6">
              <Checkbox
                id={`${formId}-public`}
                name="is_public"
                label="Offered on the billing page"
                defaultChecked={plan?.is_public ?? true}
              />
              <Checkbox
                id={`${formId}-active`}
                name="is_active"
                label="Active"
                defaultChecked={plan?.is_active ?? true}
              />
            </div>
            <Input
              id={`${formId}-order`}
              name="sort_order"
              type="number"
              min={0}
              label="Order on the billing page"
              required
              defaultValue={v("sort_order", String(plan?.sort_order ?? 50))}
              error={state.fieldErrors.sort_order?.[0]}
            />
          </>
        );
      }}
    </FormDialog>
  );
}

// ---------------------------------------------------------------------------
// Coupons (E14-T10)
// ---------------------------------------------------------------------------

export function CouponDialog() {
  const formId = "coupon-new";
  return (
    <FormDialog
      action={createCoupon}
      label="Add coupon"
      variant="primary"
      title="Add a coupon"
      description="Create the matching offer in the Razorpay dashboard first and paste its id: owners can redeem a coupon online only through a gateway offer, so the gateway's charge and our invoice agree. The discount terms cannot change once created."
      confirmLabel="Create coupon"
      formId={formId}
    >
      {(state) => {
        const v = (name: string, fallback = "") => state.values?.[name] ?? fallback;
        return (
          <>
            <div className="grid gap-4 sm:grid-cols-2">
              <Input
                id={`${formId}-code`}
                name="code"
                label="Code"
                required
                className="uppercase"
                defaultValue={v("code")}
                error={state.fieldErrors.code?.[0]}
              />
              <Input
                id={`${formId}-offer`}
                name="gateway_offer_id"
                label="Razorpay offer id"
                defaultValue={v("gateway_offer_id")}
                hint="offer_…"
                error={state.fieldErrors.gateway_offer_id?.[0]}
              />
            </div>
            <Input
              id={`${formId}-description`}
              name="description"
              label="Description"
              maxLength={200}
              defaultValue={v("description")}
              error={state.fieldErrors.description?.[0]}
            />
            <div className="grid gap-4 sm:grid-cols-3">
              <Select
                id={`${formId}-kind`}
                name="kind"
                label="Discount"
                options={[
                  { value: "percent", label: "Percentage" },
                  { value: "amount", label: "Fixed amount" },
                ]}
                defaultValue={v("kind", "percent")}
              />
              <Input
                id={`${formId}-percent`}
                name="percent_off"
                type="number"
                min={1}
                max={100}
                label="Percent off"
                defaultValue={v("percent_off")}
                error={state.fieldErrors.percent_off?.[0]}
              />
              <Input
                id={`${formId}-amount`}
                name="amount_off"
                inputMode="decimal"
                label="Amount off ₹"
                defaultValue={v("amount_off")}
                error={state.fieldErrors.amount_off?.[0]}
              />
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <Select
                id={`${formId}-duration`}
                name="duration"
                label="Applies to"
                options={[
                  { value: "once", label: "The first payment" },
                  { value: "repeating", label: "Several billing periods" },
                  { value: "forever", label: "Every payment" },
                ]}
                defaultValue={v("duration", "once")}
              />
              <Input
                id={`${formId}-cycles`}
                name="duration_cycles"
                type="number"
                min={1}
                max={36}
                label="Billing periods"
                defaultValue={v("duration_cycles")}
                hint="For 'several billing periods'."
                error={state.fieldErrors.duration_cycles?.[0]}
              />
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <Input
                id={`${formId}-max`}
                name="max_redemptions"
                type="number"
                min={1}
                label="Redemption limit"
                defaultValue={v("max_redemptions")}
                hint="Empty for no limit."
                error={state.fieldErrors.max_redemptions?.[0]}
              />
              <Input
                id={`${formId}-until`}
                name="redeem_by"
                type="date"
                label="Valid until"
                defaultValue={v("redeem_by")}
                error={state.fieldErrors.redeem_by?.[0]}
              />
            </div>
          </>
        );
      }}
    </FormDialog>
  );
}

export function CouponToggle({ coupon }: { coupon: AdminCoupon }) {
  const [state, formAction, pending] = useActionState(setCouponActive, initialFormState);
  return (
    <form action={formAction} className="inline">
      <input type="hidden" name="id" value={coupon.id} />
      <input type="hidden" name="active" value={coupon.active ? "false" : "true"} />
      <Button size="sm" variant="secondary" type="submit" loading={pending}>
        {coupon.active ? "Turn off" : "Turn on"}
        <span className="sr-only"> coupon {coupon.code}</span>
      </Button>
      {state.formError && (
        <span role="alert" className="ml-2 text-sm text-red-700">
          {state.formError}
        </span>
      )}
    </form>
  );
}

// ---------------------------------------------------------------------------
// Settings (E14-T3, T6, T7)
// ---------------------------------------------------------------------------

export function BillingSettingsForm({
  settings,
  plans,
}: {
  settings: BillingSettings;
  plans: Pick<AdminPlan, "code" | "name">[];
}) {
  const [state, formAction, pending] = useActionState(saveBillingSettings, initialFormState);
  const v = (name: keyof BillingSettings | "gst_rate", fallback: string) =>
    state.values?.[name] ?? fallback;
  return (
    <form key={state.id} action={formAction} noValidate className="space-y-4">
      {state.formError && <Alert tone="error">{state.formError}</Alert>}
      {state.status === "success" && <Alert tone="success">{state.message}</Alert>}
      <div className="grid gap-4 sm:grid-cols-3">
        <Input
          id="trial_days"
          type="number"
          min={1}
          max={90}
          label="Trial length (days)"
          required
          defaultValue={v("trial_days", String(settings.trial_days))}
          error={state.fieldErrors.trial_days?.[0]}
        />
        <Select
          id="trial_plan_code"
          label="Trial plan"
          required
          options={planOptions(plans)}
          defaultValue={v("trial_plan_code", settings.trial_plan_code)}
          error={state.fieldErrors.trial_plan_code?.[0]}
        />
        <Input
          id="grace_days"
          type="number"
          min={0}
          max={60}
          label="Grace after a failed payment (days)"
          required
          defaultValue={v("grace_days", String(settings.grace_days))}
          error={state.fieldErrors.grace_days?.[0]}
        />
      </div>
      <div className="grid gap-4 sm:grid-cols-3">
        <Input
          id="gst_rate"
          inputMode="decimal"
          label="GST rate (%)"
          required
          defaultValue={v("gst_rate", String(settings.gst_rate_bps / 100))}
          error={state.fieldErrors.gst_rate?.[0]}
        />
        <Input
          id="sac_code"
          inputMode="numeric"
          label="SAC code"
          required
          defaultValue={v("sac_code", settings.sac_code)}
          hint="Confirm with your chartered accountant."
          error={state.fieldErrors.sac_code?.[0]}
        />
        <Input
          id="terms_version"
          type="date"
          label="Terms version"
          required
          defaultValue={v("terms_version", settings.terms_version)}
          hint="Must match TERMS_VERSION in src/lib/legal.ts."
          error={state.fieldErrors.terms_version?.[0]}
        />
      </div>
      <fieldset className="space-y-4 rounded-lg border border-slate-200 p-4">
        <legend className="px-1 text-sm font-medium text-slate-800">
          Seller details on tax invoices
        </legend>
        <div className="grid gap-4 sm:grid-cols-2">
          <Input
            id="seller_legal_name"
            label="Legal name"
            maxLength={120}
            defaultValue={v("seller_legal_name", settings.seller_legal_name ?? "")}
            error={state.fieldErrors.seller_legal_name?.[0]}
          />
          <Input
            id="seller_gstin"
            label="GSTIN"
            maxLength={15}
            className="uppercase"
            defaultValue={v("seller_gstin", settings.seller_gstin ?? "")}
            error={state.fieldErrors.seller_gstin?.[0]}
          />
          <Textarea
            id="seller_address"
            label="Registered address"
            rows={2}
            maxLength={300}
            defaultValue={v("seller_address", settings.seller_address ?? "")}
            error={state.fieldErrors.seller_address?.[0]}
          />
          <div className="space-y-4">
            <Select
              id="seller_state_code"
              label="State"
              placeholder="Choose a state"
              options={GST_STATES.map((s) => ({ value: s.code, label: s.name }))}
              defaultValue={v("seller_state_code", settings.seller_state_code ?? "")}
              error={state.fieldErrors.seller_state_code?.[0]}
            />
            <Input
              id="seller_email"
              type="email"
              label="Billing email"
              defaultValue={v("seller_email", settings.seller_email ?? "")}
              error={state.fieldErrors.seller_email?.[0]}
            />
          </div>
        </div>
      </fieldset>
      <Button type="submit" loading={pending}>
        Save settings
      </Button>
    </form>
  );
}
