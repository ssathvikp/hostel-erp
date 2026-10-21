"use client";

import { useActionState, useState } from "react";

import { Alert, Button, Checkbox, Input, Select, Textarea } from "@/components/ui";
import { paiseToInput } from "@/lib/money";
import { initialFormState, type FormState } from "@/lib/validation/result";

import { savePlan, setSubscription } from "../actions";
import { PRICING_BASIS_OPTIONS, SUBSCRIPTION_STATUS_OPTIONS } from "../options";
import type { Plan, SubscriptionStatus } from "../queries";

function Status({ state }: { state: FormState }) {
  if (state.formError) return <Alert tone="error">{state.formError}</Alert>;
  if (state.status === "success") return <Alert tone="success">{state.message}</Alert>;
  return null;
}

/** An owner's plan and status, set by a platform admin (ClickUp EP-14 T2). */
export function SubscriptionForm({
  ownerId,
  plans,
  current,
}: {
  ownerId: string;
  plans: readonly Plan[];
  current: {
    planId: string;
    status: SubscriptionStatus;
    trialEndsAt: string | null;
    periodEnd: string | null;
  };
}) {
  const [state, action, pending] = useActionState(setSubscription, initialFormState);
  const values = state.values ?? {};
  const [status, setStatus] = useState(values.status ?? current.status);
  return (
    <form key={state.id} action={action} noValidate className="space-y-4">
      <input type="hidden" name="owner_id" value={ownerId} />
      <Status state={state} />
      <div className="grid gap-4 sm:grid-cols-2">
        <Select
          id="subscription-plan"
          name="plan_id"
          label="Plan"
          options={plans
            .filter((plan) => plan.active)
            .map((plan) => ({ value: plan.id, label: plan.name }))}
          defaultValue={values.plan_id ?? current.planId}
          error={state.fieldErrors.plan_id?.[0]}
        />
        <Select
          id="subscription-status"
          name="status"
          label="Status"
          options={SUBSCRIPTION_STATUS_OPTIONS}
          value={status}
          onChange={(event) => setStatus(event.target.value as SubscriptionStatus)}
          error={state.fieldErrors.status?.[0]}
        />
        {status === "trialing" && (
          <Input
            id="subscription-trial-end"
            name="trial_ends_at"
            type="date"
            label="Trial ends on"
            defaultValue={values.trial_ends_at ?? current.trialEndsAt ?? ""}
            error={state.fieldErrors.trial_ends_at?.[0]}
          />
        )}
        {status !== "trialing" && (
          <Input
            id="subscription-period-end"
            name="period_end"
            type="date"
            label="Paid until (optional)"
            defaultValue={values.period_end ?? current.periodEnd ?? ""}
            error={state.fieldErrors.period_end?.[0]}
          />
        )}
      </div>
      <Textarea
        id="subscription-reason"
        name="reason"
        label="Reason"
        rows={2}
        maxLength={500}
        required
        hint="Why it is changing. Kept in the audit log and the subscription history."
        defaultValue={values.reason ?? ""}
        error={state.fieldErrors.reason?.[0]}
      />
      <Button type="submit" loading={pending}>
        Save subscription
      </Button>
    </form>
  );
}

const rupees = (paise: number | null) => (paise === null ? "" : paiseToInput(paise));
const count = (value: number | null) => (value === null ? "" : String(value));

/** Adds or edits a plan (ClickUp EP-14 T1). Blank limits mean no limit. */
export function PlanEditForm({ plan }: { plan?: Plan }) {
  const [state, action, pending] = useActionState(savePlan, initialFormState);
  const values = state.status === "error" ? (state.values ?? {}) : {};
  const prefix = plan ? `plan-${plan.id}` : "plan-new";
  const fresh = !plan && state.status === "success";
  const value = (name: string, fallback: string) => (fresh ? "" : (values[name] ?? fallback));
  return (
    <form key={state.id} action={action} noValidate className="space-y-4">
      <Status state={state} />
      <div className="grid gap-4 sm:grid-cols-3">
        {plan ? (
          <input type="hidden" name="id" value={plan.id} />
        ) : (
          <Input
            id={`${prefix}-id`}
            name="id"
            label="Code"
            hint="Lowercase, e.g. growth_plus"
            defaultValue={value("id", "")}
            error={state.fieldErrors.id?.[0]}
          />
        )}
        <Input
          id={`${prefix}-name`}
          name="name"
          label="Name"
          defaultValue={value("name", plan?.name ?? "")}
          error={state.fieldErrors.name?.[0]}
        />
        <Select
          id={`${prefix}-basis`}
          name="pricing_basis"
          label="Pricing"
          options={PRICING_BASIS_OPTIONS}
          defaultValue={value("pricing_basis", plan?.pricingBasis ?? "flat")}
        />
        <Input
          id={`${prefix}-monthly`}
          name="monthly_price"
          label="Monthly price (₹)"
          inputMode="decimal"
          defaultValue={value("monthly_price", rupees(plan?.monthlyPrice ?? null))}
          error={state.fieldErrors.monthly_price?.[0]}
        />
        <Input
          id={`${prefix}-yearly`}
          name="yearly_price"
          label="Yearly price (₹, optional)"
          inputMode="decimal"
          defaultValue={value("yearly_price", rupees(plan?.yearlyPrice ?? null))}
          error={state.fieldErrors.yearly_price?.[0]}
        />
        <Input
          id={`${prefix}-beds`}
          name="max_beds"
          label="Beds (blank: no limit)"
          inputMode="numeric"
          defaultValue={value("max_beds", count(plan?.maxBeds ?? null))}
          error={state.fieldErrors.max_beds?.[0]}
        />
        <Input
          id={`${prefix}-hostels`}
          name="max_hostels"
          label="Hostels (blank: no limit)"
          inputMode="numeric"
          defaultValue={value("max_hostels", count(plan?.maxHostels ?? null))}
          error={state.fieldErrors.max_hostels?.[0]}
        />
        <Input
          id={`${prefix}-staff`}
          name="max_staff"
          label="Staff (blank: no limit)"
          inputMode="numeric"
          defaultValue={value("max_staff", count(plan?.maxStaff ?? null))}
          error={state.fieldErrors.max_staff?.[0]}
        />
      </div>
      <div className="flex flex-wrap gap-6">
        <Checkbox
          id={`${prefix}-gst`}
          name="gst_inclusive"
          label="Prices include GST"
          defaultChecked={!fresh && (plan?.gstInclusive ?? false)}
        />
        <Checkbox
          id={`${prefix}-public`}
          name="public"
          label="Offered to owners"
          defaultChecked={fresh ? true : (plan?.public ?? true)}
        />
        <Checkbox
          id={`${prefix}-active`}
          name="active"
          label="Active"
          defaultChecked={fresh ? true : (plan?.active ?? true)}
        />
      </div>
      <Textarea
        id={`${prefix}-reason`}
        name="reason"
        label="Reason"
        rows={2}
        required
        hint="Kept in the audit log. Price changes reach existing subscriptions only at renewal."
        defaultValue={fresh ? "" : (values.reason ?? "")}
        error={state.fieldErrors.reason?.[0]}
      />
      <Button type="submit" loading={pending}>
        {plan ? "Save plan" : "Add plan"}
      </Button>
    </form>
  );
}
