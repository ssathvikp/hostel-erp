"use client";

import { useActionState, useEffect, useState } from "react";

import { HostelField } from "@/components/shell/ActiveHostel";
import { Alert, Button, Input, Modal, Select, type SelectOption } from "@/components/ui";
import { todayIst } from "@/lib/validation";
import { useDialogState } from "@/lib/hooks/useDialogState";
import { initialFormState } from "@/lib/validation/result";

import { allocateBed } from "../actions";

export interface AllocateChoice {
  name: "resident_id" | "bed_id";
  label: string;
  placeholder: string;
  options: readonly SelectOption[];
  emptyMessage: string;
}

export interface AllocateModalProps {
  open: boolean;
  onClose: () => void;
  title: string;
  description?: string;
  fixed: { name: "resident_id" | "bed_id"; value: string };
  choice: AllocateChoice;
}

/**
 * Allocates a vacant bed (E6-T2). Opened from a resident (choose a bed) or
 * from a vacant bed (choose a resident). Both lists only hold valid choices:
 * beds that are vacant now, residents who can be given a bed.
 */
export function AllocateModal({
  open,
  onClose,
  title,
  description,
  fixed,
  choice,
}: AllocateModalProps) {
  const [state, action, pending] = useActionState(allocateBed, initialFormState);
  const { shown, formKey } = useDialogState(state, open);
  const formId = `allocate-${fixed.value}`;
  const today = todayIst();
  const empty = choice.options.length === 0;

  // Close once saved; the page re-renders with the new allocation.
  useEffect(() => {
    if (state.status === "success") onClose();
    // onClose is a fresh closure on every render; react only to new results.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state]);

  return (
    <>
      {state.status === "success" && (
        <span role="status" className="sr-only">
          {state.message}
        </span>
      )}
      <Modal
        open={open}
        onClose={onClose}
        title={title}
        description={description}
        footer={
          <>
            <Button variant="secondary" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" form={formId} loading={pending} disabled={empty}>
              Allocate
            </Button>
          </>
        }
      >
        {empty ? (
          <Alert tone="info">{choice.emptyMessage}</Alert>
        ) : (
          <form key={formKey} id={formId} action={action} noValidate className="space-y-4">
            <HostelField />
            {shown.formError && <Alert tone="error">{shown.formError}</Alert>}
            <input type="hidden" name={fixed.name} value={fixed.value} />
            <Select
              id={`${formId}-${choice.name}`}
              name={choice.name}
              label={choice.label}
              placeholder={choice.placeholder}
              options={choice.options}
              defaultValue={shown.values?.[choice.name] ?? ""}
              required
              error={shown.fieldErrors[choice.name]?.[0]}
            />
            <Input
              id={`${formId}-start`}
              name="start_date"
              type="date"
              label="First night in the bed"
              max={today}
              defaultValue={shown.values?.start_date || today}
              required
              hint="Today or an earlier date. Beds cannot be booked ahead."
              error={shown.fieldErrors.start_date?.[0]}
            />
            <Input
              id={`${formId}-rent`}
              name="rent_override"
              label="Monthly rent override (₹)"
              inputMode="decimal"
              defaultValue={shown.values?.rent_override ?? ""}
              hint="Optional. Leave blank to use the fee structure for this room's sharing type."
              error={shown.fieldErrors.rent_override?.[0]}
            />
          </form>
        )}
      </Modal>
    </>
  );
}

/** A button that opens its own allocate dialog. */
export function AllocateDialog({
  triggerLabel = "Allocate bed",
  triggerAriaLabel,
  size = "md",
  ...modal
}: Omit<AllocateModalProps, "open" | "onClose"> & {
  triggerLabel?: string;
  triggerAriaLabel?: string;
  size?: "sm" | "md";
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button size={size} onClick={() => setOpen(true)} aria-label={triggerAriaLabel}>
        {triggerLabel}
      </Button>
      <AllocateModal {...modal} open={open} onClose={() => setOpen(false)} />
    </>
  );
}
