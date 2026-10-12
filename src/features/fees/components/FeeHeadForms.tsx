"use client";

import { useActionState } from "react";

import { Alert, Button, Checkbox, Input, Select } from "@/components/ui";
import { SHARING_TYPE_OPTIONS } from "@/features/rooms/options";
import { initialFormState } from "@/lib/validation/result";

import { createFeeHead, setFeeExemption, setFeeHeadRate, toggleFeeHead } from "../actions";
import { FEE_HEAD_BILLING_OPTIONS, FEE_HEAD_PRICING_OPTIONS } from "../options";

/** Adds a charge such as mess or maintenance (E13-T1). Its rate is set separately. */
export function NewFeeHeadForm() {
  const [state, action, pending] = useActionState(createFeeHead, initialFormState);
  return (
    <form key={state.id} action={action} noValidate className="space-y-4">
      {state.formError && <Alert tone="error">{state.formError}</Alert>}
      {state.status === "success" && <Alert tone="success">{state.message}</Alert>}
      <div className="grid gap-4 sm:grid-cols-3">
        <Input
          id="head-name"
          name="name"
          label="Name"
          maxLength={60}
          defaultValue={state.values?.name ?? ""}
          hint="For example Mess, Maintenance or Wi-Fi."
          required
          error={state.fieldErrors.name?.[0]}
        />
        <Select
          id="head-billing"
          name="billing"
          label="Billed"
          options={FEE_HEAD_BILLING_OPTIONS}
          defaultValue={state.values?.billing ?? "monthly"}
          required
          error={state.fieldErrors.billing?.[0]}
        />
        <Select
          id="head-pricing"
          name="pricing"
          label="Priced"
          options={FEE_HEAD_PRICING_OPTIONS}
          defaultValue={state.values?.pricing ?? "flat"}
          required
          error={state.fieldErrors.pricing?.[0]}
        />
      </div>
      <Checkbox
        id="head-first-stay"
        name="charge_on_first_stay"
        label="Charge automatically when a resident first gets a bed"
        hint="For one-time charges such as an admission fee."
        defaultChecked={state.values?.charge_on_first_stay === "on"}
        error={state.fieldErrors.charge_on_first_stay?.[0]}
      />
      <Button type="submit" variant="secondary" loading={pending}>
        Add charge
      </Button>
    </form>
  );
}

/** Sets a charge's amount from a date, like the rent rates above. */
export function FeeHeadRateForm({
  heads,
  defaultFrom,
}: {
  heads: readonly { id: string; name: string }[];
  defaultFrom: string;
}) {
  const [state, action, pending] = useActionState(setFeeHeadRate, initialFormState);
  return (
    <form key={state.id} action={action} noValidate className="space-y-4">
      {state.formError && <Alert tone="error">{state.formError}</Alert>}
      {state.status === "success" && <Alert tone="success">{state.message}</Alert>}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Select
          id="head-rate-head"
          name="fee_head_id"
          label="Charge"
          placeholder="Choose a charge"
          options={heads.map((head) => ({ value: head.id, label: head.name }))}
          defaultValue={state.values?.fee_head_id ?? ""}
          required
          error={state.fieldErrors.fee_head_id?.[0]}
        />
        <Select
          id="head-rate-sharing"
          name="sharing_type"
          label="Sharing type"
          placeholder="Not needed for a flat charge"
          options={SHARING_TYPE_OPTIONS}
          defaultValue={state.values?.sharing_type ?? ""}
          error={state.fieldErrors.sharing_type?.[0]}
        />
        <Input
          id="head-rate-amount"
          name="amount"
          label="Amount (₹)"
          inputMode="decimal"
          defaultValue={state.values?.amount ?? ""}
          hint="Per month, or per charge for a one-off."
          required
          error={state.fieldErrors.amount?.[0]}
        />
        <Input
          id="head-rate-from"
          name="effective_from"
          type="date"
          label="Applies from"
          defaultValue={state.values?.effective_from || defaultFrom}
          required
          error={state.fieldErrors.effective_from?.[0]}
        />
      </div>
      <Button type="submit" loading={pending}>
        Save charge rate
      </Button>
    </form>
  );
}

/** Stops billing a charge, or starts again. History is kept either way. */
export function FeeHeadToggle({ head }: { head: { id: string; name: string; active: boolean } }) {
  const [state, action, pending] = useActionState(toggleFeeHead, initialFormState);
  return (
    <form action={action} className="inline">
      <input type="hidden" name="fee_head_id" value={head.id} />
      <input type="hidden" name="active" value={head.active ? "false" : "true"} />
      <Button
        type="submit"
        variant="secondary"
        size="sm"
        loading={pending}
        aria-label={`${head.active ? "Stop billing" : "Bill"} ${head.name}`}
      >
        {head.active ? "Stop billing" : "Bill again"}
      </Button>
      {state.formError && <span className="ml-2 text-xs text-red-700">{state.formError}</span>}
    </form>
  );
}

/** Excuses a resident from a monthly charge (for example no mess), or bills them again. */
export function FeeExemptionToggle({
  residentId,
  head,
  exempt,
}: {
  residentId: string;
  head: { id: string; name: string };
  exempt: boolean;
}) {
  const [state, action, pending] = useActionState(setFeeExemption, initialFormState);
  return (
    <form action={action} className="inline">
      <input type="hidden" name="resident_id" value={residentId} />
      <input type="hidden" name="fee_head_id" value={head.id} />
      <input type="hidden" name="exempt" value={exempt ? "false" : "true"} />
      <Button
        type="submit"
        variant="secondary"
        size="sm"
        loading={pending}
        aria-label={`${exempt ? "Bill" : "Excuse"} this resident ${exempt ? "for" : "from"} ${head.name}`}
      >
        {exempt ? "Bill again" : "Excuse"}
      </Button>
      {state.formError && <span className="ml-2 text-xs text-red-700">{state.formError}</span>}
    </form>
  );
}
