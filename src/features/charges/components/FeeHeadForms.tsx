"use client";

import { useActionState, useState } from "react";

import { HostelField } from "@/components/shell/ActiveHostel";
import { Alert, Button, Checkbox, Input, Select, type SelectOption } from "@/components/ui";
import { SHARING_TYPE_OPTIONS } from "@/features/rooms/options";
import { initialFormState } from "@/lib/validation/result";

import { archiveFeeHead, createFeeHead, saveElectricityRate, setFeeHeadPrice } from "../actions";

/** Adds a named charge besides rent (ClickUp E13-T1). */
export function FeeHeadForm() {
  const [state, action, pending] = useActionState(createFeeHead, initialFormState);
  const [kind, setKind] = useState(state.values?.kind ?? "monthly");
  return (
    <form key={state.id} action={action} noValidate className="space-y-4">
      <HostelField />
      {state.formError && <Alert tone="error">{state.formError}</Alert>}
      {state.status === "success" && <Alert tone="success">{state.message}</Alert>}
      <div className="grid gap-4 sm:grid-cols-2">
        <Input
          id="head-name"
          name="name"
          label="Name"
          placeholder="Mess, Maintenance, Admission fee"
          maxLength={60}
          required
          defaultValue={state.values?.name ?? ""}
          error={state.fieldErrors.name?.[0]}
        />
        <Select
          id="head-kind"
          name="kind"
          label="Charged"
          options={[
            { value: "monthly", label: "Every month, with rent" },
            { value: "one_time", label: "Once, when added to a resident" },
          ]}
          value={kind}
          onChange={(event) => setKind(event.target.value)}
          error={state.fieldErrors.kind?.[0]}
        />
      </div>
      {kind === "one_time" && (
        <Checkbox
          id="head-first-stay"
          name="on_first_allocation"
          label="Charge automatically when a resident first gets a bed"
          hint="For an admission or joining fee."
          defaultChecked={state.values?.on_first_allocation === "on"}
        />
      )}
      <Button type="submit" loading={pending}>
        Add charge type
      </Button>
    </form>
  );
}

/** Sets a fee head's price for one sharing type, or for all, from a date. */
export function FeeHeadPriceForm({
  heads,
  defaultFrom,
}: {
  heads: readonly SelectOption[];
  defaultFrom: string;
}) {
  const [state, action, pending] = useActionState(setFeeHeadPrice, initialFormState);
  return (
    <form key={state.id} action={action} noValidate className="space-y-4">
      {state.formError && <Alert tone="error">{state.formError}</Alert>}
      {state.status === "success" && <Alert tone="success">{state.message}</Alert>}
      <div className="grid gap-4 sm:grid-cols-4">
        <Select
          id="price-head"
          name="head_id"
          label="Charge type"
          placeholder="Choose"
          options={heads}
          defaultValue={state.values?.head_id ?? ""}
          required
          error={state.fieldErrors.head_id?.[0]}
        />
        <Select
          id="price-sharing"
          name="sharing_type"
          label="Sharing type"
          options={[{ value: "", label: "All sharing types" }, ...SHARING_TYPE_OPTIONS]}
          defaultValue={state.values?.sharing_type ?? ""}
          error={state.fieldErrors.sharing_type?.[0]}
        />
        <Input
          id="price-amount"
          name="amount"
          label="Amount (₹)"
          inputMode="decimal"
          required
          defaultValue={state.values?.amount ?? ""}
          error={state.fieldErrors.amount?.[0]}
        />
        <Input
          id="price-from"
          name="effective_from"
          type="date"
          label="Applies from"
          required
          defaultValue={state.values?.effective_from || defaultFrom}
          error={state.fieldErrors.effective_from?.[0]}
        />
      </div>
      <Button type="submit" loading={pending}>
        Save price
      </Button>
    </form>
  );
}

export function ArchiveHeadButton({ id, name }: { id: string; name: string }) {
  const [state, action, pending] = useActionState(archiveFeeHead, initialFormState);
  return (
    <form action={action} className="inline">
      <HostelField />
      <input type="hidden" name="id" value={id} />
      <Button
        type="submit"
        size="sm"
        variant="secondary"
        loading={pending}
        aria-label={`Remove ${name}`}
      >
        Remove
      </Button>
      {state.formError && <span className="ml-2 text-xs text-red-700">{state.formError}</span>}
    </form>
  );
}

/** The price per meter unit; blank stops billing electricity separately (ClickUp E13-T3). */
export function ElectricityRateForm({ rate }: { rate: number | null }) {
  const [state, action, pending] = useActionState(saveElectricityRate, initialFormState);
  return (
    <form key={state.id} action={action} noValidate className="space-y-4">
      <HostelField />
      {state.formError && <Alert tone="error">{state.formError}</Alert>}
      {state.status === "success" && <Alert tone="success">{state.message}</Alert>}
      <Input
        id="electricity-rate"
        name="electricity_unit_rate"
        label="Price per unit (₹)"
        inputMode="decimal"
        className="max-w-40"
        hint="Leave blank if electricity is included in rent."
        defaultValue={
          state.values?.electricity_unit_rate ?? (rate === null ? "" : String(rate / 100))
        }
        error={state.fieldErrors.electricity_unit_rate?.[0]}
      />
      <Button type="submit" loading={pending}>
        Save price per unit
      </Button>
    </form>
  );
}
