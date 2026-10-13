"use client";

import { useActionState, useEffect, useState } from "react";

import { Alert, Button, Checkbox, Input, Modal, Select, Textarea } from "@/components/ui";
import { todayIst } from "@/lib/validation";
import { initialFormState } from "@/lib/validation/result";

import {
  addCharge,
  addDiscount,
  applyLateFeesNow,
  billChargesNow,
  endDiscount,
  saveLateFeeRule,
} from "../actions";

/** A form inside a modal opened by a button; closes itself once saved. */
function useDialog(status: string, id: string) {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (status === "success") setOpen(false);
  }, [status, id]);
  return { open, setOpen };
}

/**
 * Records a one-off charge for a resident (E13-T2): from a one-time charge
 * in settings, or described by hand. It is billed on the next invoice.
 */
export function AddChargeDialog({
  residentId,
  residentName,
  heads,
}: {
  residentId: string;
  residentName: string;
  heads: readonly { id: string; name: string }[];
}) {
  const [state, action, pending] = useActionState(addCharge, initialFormState);
  const { open, setOpen } = useDialog(state.status, state.id);
  const formId = `charge-${residentId}`;
  return (
    <>
      <Button variant="secondary" size="sm" onClick={() => setOpen(true)}>
        Add charge
      </Button>
      {state.status === "success" && (
        <span role="status" className="sr-only">
          {state.message}
        </span>
      )}
      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title={`Charge ${residentName}`}
        description="A one-off charge such as a key, damage or an admission fee. It is added to their next invoice."
        footer={
          <>
            <Button variant="secondary" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" form={formId} loading={pending}>
              Add charge
            </Button>
          </>
        }
      >
        <form key={state.id} id={formId} action={action} noValidate className="space-y-4">
          {state.formError && <Alert tone="error">{state.formError}</Alert>}
          <input type="hidden" name="resident_id" value={residentId} />
          {heads.length > 0 && (
            <Select
              id={`${formId}-head`}
              name="fee_head_id"
              label="Charge"
              placeholder="Something else (describe it below)"
              options={heads.map((head) => ({ value: head.id, label: head.name }))}
              defaultValue={state.values?.fee_head_id ?? ""}
              error={state.fieldErrors.fee_head_id?.[0]}
            />
          )}
          <Input
            id={`${formId}-description`}
            name="description"
            label="Description"
            maxLength={200}
            defaultValue={state.values?.description ?? ""}
            hint={heads.length > 0 ? "Optional when a charge is chosen above." : undefined}
            error={state.fieldErrors.description?.[0]}
          />
          <div className="grid gap-4 sm:grid-cols-2">
            <Input
              id={`${formId}-amount`}
              name="amount"
              label="Amount (₹)"
              inputMode="decimal"
              defaultValue={state.values?.amount ?? ""}
              required
              error={state.fieldErrors.amount?.[0]}
            />
            <Input
              id={`${formId}-date`}
              name="charge_date"
              type="date"
              label="Date"
              max={todayIst()}
              defaultValue={state.values?.charge_date || todayIst()}
              required
              error={state.fieldErrors.charge_date?.[0]}
            />
          </div>
        </form>
      </Modal>
    </>
  );
}

/** Bills every pending charge now, on an invoice due today. */
export function BillChargesNowButton({ residentId }: { residentId: string }) {
  const [state, action, pending] = useActionState(billChargesNow, initialFormState);
  return (
    <form action={action} className="inline-flex items-center gap-2">
      <input type="hidden" name="resident_id" value={residentId} />
      <Button type="submit" size="sm" loading={pending}>
        Bill pending charges now
      </Button>
      {state.formError && <span className="text-xs text-red-700">{state.formError}</span>}
      {state.status === "success" && (
        <span role="status" className="text-xs text-slate-600">
          {state.message}
        </span>
      )}
    </form>
  );
}

/** A percentage or fixed amount off rent or one charge, for a range of months (E13-T5). */
export function AddDiscountDialog({
  residentId,
  residentName,
  heads,
}: {
  residentId: string;
  residentName: string;
  heads: readonly { id: string; name: string }[];
}) {
  const [state, action, pending] = useActionState(addDiscount, initialFormState);
  const { open, setOpen } = useDialog(state.status, state.id);
  const formId = `discount-${residentId}`;
  const thisMonth = todayIst().slice(0, 7);
  return (
    <>
      <Button variant="secondary" size="sm" onClick={() => setOpen(true)}>
        Give discount
      </Button>
      {state.status === "success" && (
        <span role="status" className="sr-only">
          {state.message}
        </span>
      )}
      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title={`Discount for ${residentName}`}
        description="Comes off each invoice generated for the months chosen. It never takes a charge below zero."
        footer={
          <>
            <Button variant="secondary" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" form={formId} loading={pending}>
              Save discount
            </Button>
          </>
        }
      >
        <form key={state.id} id={formId} action={action} noValidate className="space-y-4">
          {state.formError && <Alert tone="error">{state.formError}</Alert>}
          <input type="hidden" name="resident_id" value={residentId} />
          <div className="grid gap-4 sm:grid-cols-2">
            <Select
              id={`${formId}-target`}
              name="target"
              label="Off"
              options={[
                { value: "rent", label: "Rent" },
                ...heads.map((head) => ({ value: head.id, label: head.name })),
              ]}
              defaultValue={state.values?.target ?? "rent"}
              required
              error={state.fieldErrors.target?.[0]}
            />
            <Select
              id={`${formId}-measure`}
              name="measure"
              label="As"
              options={[
                { value: "percent", label: "A percentage" },
                { value: "fixed", label: "A fixed amount (₹)" },
              ]}
              defaultValue={state.values?.measure ?? "percent"}
              required
              error={state.fieldErrors.measure?.[0]}
            />
            <Input
              id={`${formId}-value`}
              name="value"
              label="Percentage or amount"
              inputMode="decimal"
              defaultValue={state.values?.value ?? ""}
              required
              error={state.fieldErrors.value?.[0]}
            />
            <Input
              id={`${formId}-from`}
              name="from_month"
              type="month"
              label="From"
              defaultValue={state.values?.from_month || thisMonth}
              required
              error={state.fieldErrors.from_month?.[0]}
            />
            <Input
              id={`${formId}-to`}
              name="to_month"
              type="month"
              label="Until"
              defaultValue={state.values?.to_month ?? ""}
              hint="Leave empty to keep it going."
              error={state.fieldErrors.to_month?.[0]}
            />
          </div>
          <Textarea
            id={`${formId}-reason`}
            name="reason"
            label="Reason"
            rows={2}
            maxLength={200}
            defaultValue={state.values?.reason ?? ""}
            required
            error={state.fieldErrors.reason?.[0]}
          />
        </form>
      </Modal>
    </>
  );
}

/** Ends a discount after a chosen month. */
export function EndDiscountForm({
  discountId,
  residentId,
  label,
}: {
  discountId: string;
  residentId: string;
  label: string;
}) {
  const [state, action, pending] = useActionState(endDiscount, initialFormState);
  return (
    <form action={action} className="flex flex-wrap items-end gap-2">
      <input type="hidden" name="id" value={discountId} />
      <input type="hidden" name="resident_id" value={residentId} />
      <Input
        id={`end-${discountId}`}
        name="to_month"
        type="month"
        label={`Last month for ${label}`}
        defaultValue={todayIst().slice(0, 7)}
        className="w-40"
      />
      <Button type="submit" variant="secondary" size="sm" loading={pending}>
        End discount
      </Button>
      {state.formError && <span className="text-xs text-red-700">{state.formError}</span>}
    </form>
  );
}

/** The hostel's late fee rule (E13-T6). */
export function LateFeeRuleForm({
  rule,
}: {
  rule: { graceDays: number; kind: string; amount: string; cap: string; active: boolean } | null;
}) {
  const [state, action, pending] = useActionState(saveLateFeeRule, initialFormState);
  const value = (name: "grace_days" | "kind" | "amount" | "cap") =>
    state.values?.[name] ??
    (rule
      ? {
          grace_days: String(rule.graceDays),
          kind: rule.kind,
          amount: rule.amount,
          cap: rule.cap,
        }[name]
      : undefined);
  return (
    <form key={state.id} action={action} noValidate className="space-y-4">
      {state.formError && <Alert tone="error">{state.formError}</Alert>}
      {state.status === "success" && <Alert tone="success">{state.message}</Alert>}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Input
          id="late-grace"
          name="grace_days"
          type="number"
          label="Grace days"
          min={0}
          max={60}
          defaultValue={value("grace_days") ?? "3"}
          hint="Days after the due date before a fee."
          required
          error={state.fieldErrors.grace_days?.[0]}
        />
        <Select
          id="late-kind"
          name="kind"
          label="Fee"
          options={[
            { value: "fixed", label: "A fixed amount" },
            { value: "per_day", label: "An amount per day" },
          ]}
          defaultValue={value("kind") ?? "fixed"}
          required
          error={state.fieldErrors.kind?.[0]}
        />
        <Input
          id="late-amount"
          name="amount"
          label="Amount (₹)"
          inputMode="decimal"
          defaultValue={value("amount") ?? ""}
          required
          error={state.fieldErrors.amount?.[0]}
        />
        <Input
          id="late-cap"
          name="cap"
          label="Most it can reach (₹)"
          inputMode="decimal"
          defaultValue={value("cap") ?? ""}
          hint="Per-day fees only."
          error={state.fieldErrors.cap?.[0]}
        />
      </div>
      <Checkbox
        id="late-active"
        name="active"
        label="Apply late fees"
        hint="Checked every night. A late fee is added to the resident's next invoice."
        defaultChecked={state.values ? state.values.active === "on" : (rule?.active ?? true)}
      />
      <Button type="submit" loading={pending}>
        Save late fee rule
      </Button>
    </form>
  );
}

/** Runs the late fee rule now instead of waiting for tonight. */
export function ApplyLateFeesButton() {
  const [state, action, pending] = useActionState(applyLateFeesNow, initialFormState);
  return (
    <form action={action} className="inline-flex flex-wrap items-center gap-2">
      <Button type="submit" variant="secondary" loading={pending}>
        Apply late fees now
      </Button>
      {state.formError && <span className="text-sm text-red-700">{state.formError}</span>}
      {state.status === "success" && (
        <span role="status" className="text-sm text-slate-600">
          {state.message}
        </span>
      )}
    </form>
  );
}
