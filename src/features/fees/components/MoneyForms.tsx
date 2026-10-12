"use client";

import { useActionState, useEffect, useState } from "react";

import { Alert, Button, Input, Modal, Select, Textarea } from "@/components/ui";
import { SHARING_TYPE_OPTIONS } from "@/features/rooms/options";
import { todayIst } from "@/lib/validation";
import { initialFormState, type FormState } from "@/lib/validation/result";

import {
  deductDeposit,
  recordAdvance,
  recordDeposit,
  refundCredit,
  refundDeposit,
  saveDepositAmount,
} from "../actions";
import { PAYMENT_MODE_OPTIONS } from "../options";

type Action = (state: FormState, formData: FormData) => Promise<FormState>;

const ACTIONS = {
  advance: {
    action: recordAdvance,
    button: "Record advance",
    title: "Record an advance",
    description:
      "Money received with no invoice to pay. It pays any open invoice first; the rest is kept as credit for the next ones.",
    dated: true,
  },
  deposit: {
    action: recordDeposit,
    button: "Record deposit",
    title: "Record the deposit received",
    description: "Refundable money held for the resident. It is never counted as rent.",
    dated: true,
  },
  refundCredit: {
    action: refundCredit,
    button: "Refund credit",
    title: "Pay credit back",
    description: "Pays the resident back from the credit they hold.",
    dated: false,
  },
  refundDeposit: {
    action: refundDeposit,
    button: "Refund deposit",
    title: "Pay the deposit back",
    description: "Pays the resident back from the deposit held.",
    dated: false,
  },
} satisfies Record<
  string,
  { action: Action; button: string; title: string; description: string; dated: boolean }
>;

/** Receives money for, or pays money back to, a resident outside an invoice. */
export function MoneyDialog({
  kind,
  residentId,
  defaultAmount,
}: {
  kind: keyof typeof ACTIONS;
  residentId: string;
  /** Rupees, as the field holds them. */
  defaultAmount?: string;
}) {
  const copy = ACTIONS[kind];
  const [state, action, pending] = useActionState(copy.action, initialFormState);
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (state.status === "success") setOpen(false);
  }, [state]);
  const formId = `${kind}-${residentId}`;

  return (
    <>
      <Button variant="secondary" size="sm" onClick={() => setOpen(true)}>
        {copy.button}
      </Button>
      {state.status === "success" && (
        <span role="status" className="sr-only">
          {state.message}
        </span>
      )}
      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title={copy.title}
        description={copy.description}
        footer={
          <>
            <Button variant="secondary" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" form={formId} loading={pending}>
              {copy.button}
            </Button>
          </>
        }
      >
        <form key={state.id} id={formId} action={action} noValidate className="space-y-4">
          {state.formError && <Alert tone="error">{state.formError}</Alert>}
          <input type="hidden" name="resident_id" value={residentId} />
          <div className="grid gap-4 sm:grid-cols-2">
            <Input
              id={`${formId}-amount`}
              name="amount"
              label="Amount (₹)"
              inputMode="decimal"
              defaultValue={state.values?.amount ?? defaultAmount ?? ""}
              required
              error={state.fieldErrors.amount?.[0]}
            />
            {copy.dated && (
              <Input
                id={`${formId}-date`}
                name="paid_at"
                type="date"
                label="Received on"
                max={todayIst()}
                defaultValue={state.values?.paid_at || todayIst()}
                required
                error={state.fieldErrors.paid_at?.[0]}
              />
            )}
            <Select
              id={`${formId}-mode`}
              name="mode"
              label="Mode"
              placeholder="Choose a mode"
              options={PAYMENT_MODE_OPTIONS}
              defaultValue={state.values?.mode ?? ""}
              required
              error={state.fieldErrors.mode?.[0]}
            />
            <Input
              id={`${formId}-reference`}
              name="reference"
              label="Reference"
              maxLength={100}
              defaultValue={state.values?.reference ?? ""}
              hint="Optional. UPI or bank reference."
              error={state.fieldErrors.reference?.[0]}
            />
          </div>
        </form>
      </Modal>
    </>
  );
}

/** Keeps part of the deposit, for example for damage, with a reason. */
export function DeductionDialog({ residentId }: { residentId: string }) {
  const [state, action, pending] = useActionState(deductDeposit, initialFormState);
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (state.status === "success") setOpen(false);
  }, [state]);
  const formId = `deduct-${residentId}`;
  return (
    <>
      <Button variant="secondary" size="sm" onClick={() => setOpen(true)}>
        Keep part of deposit
      </Button>
      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title="Keep part of the deposit"
        description="For damage or anything else the resident agreed to pay from the deposit. The reason is kept on record."
        footer={
          <>
            <Button variant="secondary" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" form={formId} loading={pending}>
              Keep amount
            </Button>
          </>
        }
      >
        <form key={state.id} id={formId} action={action} noValidate className="space-y-4">
          {state.formError && <Alert tone="error">{state.formError}</Alert>}
          <input type="hidden" name="resident_id" value={residentId} />
          <Input
            id={`${formId}-amount`}
            name="amount"
            label="Amount (₹)"
            inputMode="decimal"
            defaultValue={state.values?.amount ?? ""}
            required
            error={state.fieldErrors.amount?.[0]}
          />
          <Textarea
            id={`${formId}-reason`}
            name="reason"
            label="Reason"
            rows={2}
            maxLength={500}
            defaultValue={state.values?.reason ?? ""}
            required
            error={state.fieldErrors.reason?.[0]}
          />
        </form>
      </Modal>
    </>
  );
}

/** Sets the deposit asked for on a resident's first stay, per sharing type. */
export function DepositAmountForm() {
  const [state, action, pending] = useActionState(saveDepositAmount, initialFormState);
  return (
    <form key={state.id} action={action} noValidate className="space-y-4">
      {state.formError && <Alert tone="error">{state.formError}</Alert>}
      {state.status === "success" && <Alert tone="success">{state.message}</Alert>}
      <div className="grid gap-4 sm:grid-cols-2">
        <Select
          id="deposit-sharing"
          name="sharing_type"
          label="Sharing type"
          placeholder="Choose a sharing type"
          options={SHARING_TYPE_OPTIONS}
          defaultValue={state.values?.sharing_type ?? ""}
          required
          error={state.fieldErrors.sharing_type?.[0]}
        />
        <Input
          id="deposit-amount"
          name="amount"
          label="Deposit (₹)"
          inputMode="decimal"
          defaultValue={state.values?.amount ?? ""}
          hint="Leave empty to stop asking for one."
          error={state.fieldErrors.amount?.[0]}
        />
      </div>
      <Button type="submit" variant="secondary" loading={pending}>
        Save deposit
      </Button>
    </form>
  );
}
