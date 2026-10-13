"use client";

import { useActionState } from "react";

import { Alert, Button, Input, Select } from "@/components/ui";
import { initialFormState, type FormState } from "@/lib/validation/result";
import type { ComplaintPriority } from "@/types";

import { addCategory, resetTarget, saveTarget, toggleCategory } from "../actions";
import { PRIORITY_LABELS, TRADE_OPTIONS } from "../options";

function Announce({ state }: { state: FormState }) {
  if (state.status === "success" && state.message) {
    return (
      <span role="status" className="sr-only">
        {state.message}
      </span>
    );
  }
  if (state.status === "error" && state.formError) {
    return <Alert tone="error">{state.formError}</Alert>;
  }
  return null;
}

export function AddCategoryForm() {
  const [state, action, pending] = useActionState(addCategory, initialFormState);
  return (
    <form
      key={state.id}
      action={action}
      noValidate
      className="grid gap-3 rounded-lg border border-slate-200 bg-white p-4 sm:grid-cols-[1fr_1fr_auto] sm:items-end"
    >
      <Input
        id="category-name"
        name="name"
        label="New category"
        placeholder="e.g. Water purifier"
        defaultValue={state.status === "error" ? (state.values?.name ?? "") : ""}
        maxLength={60}
        error={state.fieldErrors.name?.[0]}
      />
      <Select
        id="category-trade"
        name="trade"
        label="Goes to"
        placeholder="Choose a trade"
        options={TRADE_OPTIONS}
        defaultValue={state.status === "error" ? (state.values?.trade ?? "") : ""}
        error={state.fieldErrors.trade?.[0]}
      />
      <Button type="submit" variant="secondary" loading={pending}>
        Add
      </Button>
      <div className="sm:col-span-3">
        <Announce state={state} />
      </div>
    </form>
  );
}

/** Flips one boolean on a category: automatic routing, or the category itself. */
export function CategoryToggle({
  id,
  name,
  field,
  value,
}: {
  id: string;
  name: string;
  field: "auto_route" | "active";
  value: boolean;
}) {
  const [state, action, pending] = useActionState(toggleCategory, initialFormState);
  const label =
    field === "auto_route"
      ? value
        ? "Assign by hand"
        : "Route automatically"
      : value
        ? "Hide"
        : "Restore";
  return (
    <form action={action} className="inline">
      <input type="hidden" name="id" value={id} />
      <input type="hidden" name="field" value={field} />
      <input type="hidden" name="value" value={String(!value)} />
      <Button
        type="submit"
        size="sm"
        variant="ghost"
        loading={pending}
        aria-label={`${label}: ${name}`}
      >
        {label}
      </Button>
      <Announce state={state} />
    </form>
  );
}

/** Response and fix targets for one priority, in hours (E15-T10). */
export function TargetForm({
  priority,
  respondMinutes,
  resolveMinutes,
  custom,
}: {
  priority: ComplaintPriority;
  respondMinutes: number;
  resolveMinutes: number;
  custom: boolean;
}) {
  const [state, action, pending] = useActionState(saveTarget, initialFormState);
  const [resetState, resetAction, resetting] = useActionState(resetTarget, initialFormState);
  const formId = `target-${priority}`;
  return (
    <div className="rounded-lg border border-slate-200 bg-white p-4">
      <form
        key={state.id + resetState.id}
        id={formId}
        action={action}
        noValidate
        className="grid gap-3 sm:grid-cols-[8rem_1fr_1fr_auto] sm:items-end"
      >
        <input type="hidden" name="priority" value={priority} />
        <p className="text-sm font-semibold text-slate-900 sm:pb-2.5">
          {PRIORITY_LABELS[priority]}
          {!custom && <span className="block text-xs font-normal text-slate-500">Default</span>}
        </p>
        <Input
          id={`${formId}-respond`}
          name="respond_hours"
          label="Respond within (hours)"
          inputMode="decimal"
          defaultValue={state.values?.respond_hours ?? String(respondMinutes / 60)}
          error={state.fieldErrors.respond_hours?.[0]}
        />
        <Input
          id={`${formId}-resolve`}
          name="resolve_hours"
          label="Fix within (hours)"
          inputMode="decimal"
          defaultValue={state.values?.resolve_hours ?? String(resolveMinutes / 60)}
          error={state.fieldErrors.resolve_hours?.[0]}
        />
        <Button type="submit" variant="secondary" loading={pending}>
          Save
        </Button>
      </form>
      {custom && (
        <form action={resetAction} className="mt-2 text-right">
          <input type="hidden" name="priority" value={priority} />
          <Button type="submit" size="sm" variant="ghost" loading={resetting}>
            Use the default
          </Button>
        </form>
      )}
      <Announce state={state} />
      <Announce state={resetState} />
    </div>
  );
}
