"use client";

import { useActionState } from "react";

import { HostelField } from "@/components/shell/ActiveHostel";
import { Alert, Button, Checkbox, Input, Select, type SelectOption } from "@/components/ui";
import { initialFormState } from "@/lib/validation/result";

import { addCharge, addDiscount, billChargesNow, saveOptOuts } from "../actions";

/** Adds a charge to a resident, billed on their next invoice (ClickUp E13-T2). */
export function ChargeForm({
  residentId,
  heads,
  today,
}: {
  residentId: string;
  /** One-time charge types, to pick from. */
  heads: readonly SelectOption[];
  today: string;
}) {
  const [state, action, pending] = useActionState(addCharge, initialFormState);
  return (
    <form key={state.id} action={action} noValidate className="space-y-4">
      <HostelField />
      <input type="hidden" name="resident_id" value={residentId} />
      {state.formError && <Alert tone="error">{state.formError}</Alert>}
      {state.status === "success" && <Alert tone="success">{state.message}</Alert>}
      <div className="grid gap-4 sm:grid-cols-2">
        {heads.length > 0 && (
          <Select
            id="charge-head"
            name="head_id"
            label="Type"
            options={[{ value: "", label: "Other" }, ...heads]}
            defaultValue={state.values?.head_id ?? ""}
            error={state.fieldErrors.head_id?.[0]}
          />
        )}
        <Input
          id="charge-description"
          name="description"
          label="Description"
          placeholder="Broken chair, extra mattress"
          maxLength={200}
          required
          defaultValue={state.values?.description ?? ""}
          error={state.fieldErrors.description?.[0]}
        />
        <Input
          id="charge-amount"
          name="amount"
          label="Amount (₹)"
          inputMode="decimal"
          required
          defaultValue={state.values?.amount ?? ""}
          error={state.fieldErrors.amount?.[0]}
        />
        <Input
          id="charge-date"
          name="charge_date"
          type="date"
          label="Date"
          required
          defaultValue={state.values?.charge_date || today}
          error={state.fieldErrors.charge_date?.[0]}
        />
      </div>
      <Button type="submit" loading={pending}>
        Add charge
      </Button>
    </form>
  );
}

export function BillNowButton({ residentId }: { residentId: string }) {
  const [state, action, pending] = useActionState(billChargesNow, initialFormState);
  return (
    <form action={action} className="space-y-2">
      <input type="hidden" name="resident_id" value={residentId} />
      {state.formError && <Alert tone="error">{state.formError}</Alert>}
      {state.status === "success" && <Alert tone="success">{state.message}</Alert>}
      <Button type="submit" variant="secondary" loading={pending}>
        Bill pending charges now
      </Button>
    </form>
  );
}

/** Gives a resident a discount on rent or a charge type (ClickUp E13-T5). */
export function DiscountForm({
  residentId,
  heads,
  currentMonth,
}: {
  residentId: string;
  /** Monthly charge types a discount can apply to, besides rent. */
  heads: readonly SelectOption[];
  /** `YYYY-MM`. */
  currentMonth: string;
}) {
  const [state, action, pending] = useActionState(addDiscount, initialFormState);
  return (
    <form key={state.id} action={action} noValidate className="space-y-4">
      <HostelField />
      <input type="hidden" name="resident_id" value={residentId} />
      {state.formError && <Alert tone="error">{state.formError}</Alert>}
      {state.status === "success" && <Alert tone="success">{state.message}</Alert>}
      <div className="grid gap-4 sm:grid-cols-3">
        <Select
          id="discount-head"
          name="head_id"
          label="On"
          options={[{ value: "", label: "Rent" }, ...heads]}
          defaultValue={state.values?.head_id ?? ""}
          error={state.fieldErrors.head_id?.[0]}
        />
        <Select
          id="discount-kind"
          name="kind"
          label="Kind"
          options={[
            { value: "percent", label: "Percentage" },
            { value: "fixed", label: "Fixed amount (₹)" },
          ]}
          defaultValue={state.values?.kind ?? "percent"}
          error={state.fieldErrors.kind?.[0]}
        />
        <Input
          id="discount-value"
          name="value"
          label="Discount"
          inputMode="decimal"
          required
          hint="10 means 10% or ₹10, by kind."
          defaultValue={state.values?.value ?? ""}
          error={state.fieldErrors.value?.[0]}
        />
        <Input
          id="discount-from"
          name="from_month"
          type="month"
          label="From"
          required
          defaultValue={state.values?.from_month || currentMonth}
          error={state.fieldErrors.from_month?.[0]}
        />
        <Input
          id="discount-to"
          name="to_month"
          type="month"
          label="Until"
          hint="Leave blank for every month."
          defaultValue={state.values?.to_month ?? ""}
          error={state.fieldErrors.to_month?.[0]}
        />
        <Input
          id="discount-reason"
          name="reason"
          label="Reason"
          maxLength={500}
          required
          defaultValue={state.values?.reason ?? ""}
          error={state.fieldErrors.reason?.[0]}
        />
      </div>
      <Button type="submit" loading={pending}>
        Add discount
      </Button>
    </form>
  );
}

/** Which monthly charge types the current stay pays (ClickUp E13-T1). */
export function OptOutForm({
  allocationId,
  heads,
  optedOut,
}: {
  allocationId: string;
  heads: readonly SelectOption[];
  optedOut: readonly string[];
}) {
  const [state, action, pending] = useActionState(saveOptOuts, initialFormState);
  return (
    <form key={state.id} action={action} className="space-y-3">
      <HostelField />
      <input type="hidden" name="allocation_id" value={allocationId} />
      {state.formError && <Alert tone="error">{state.formError}</Alert>}
      {state.status === "success" && <Alert tone="success">{state.message}</Alert>}
      <fieldset className="space-y-2">
        <legend className="mb-1 text-sm font-medium text-slate-700">
          Monthly charges this stay pays
        </legend>
        {heads.map((head) => (
          <div key={head.value}>
            <input type="hidden" name="offered" value={head.value} />
            <Checkbox
              id={`charged-${head.value}`}
              name="charged"
              value={head.value}
              label={head.label}
              defaultChecked={!optedOut.includes(head.value)}
            />
          </div>
        ))}
      </fieldset>
      <Button type="submit" size="sm" variant="secondary" loading={pending}>
        Save
      </Button>
    </form>
  );
}
