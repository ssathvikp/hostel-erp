"use client";

import { useActionState, useEffect, useState } from "react";

import { HostelField } from "@/components/shell/ActiveHostel";
import { Alert, Button, Input, Modal, Select } from "@/components/ui";
import { useDialogState } from "@/lib/hooks/useDialogState";
import { initialFormState } from "@/lib/validation/result";
import type { ManualBedStatus } from "@/types";

import { setBedStatus } from "../actions";
import { MANUAL_BED_STATUS_OPTIONS } from "../options";

/**
 * Blocks a bed, marks it under maintenance, or makes it available again
 * (E4-T8). Occupied is never offered: it follows from allocations.
 */
export function BedStatusControl({
  bed,
}: {
  bed: { id: string; label: string; status: ManualBedStatus; reason: string | null };
}) {
  const [open, setOpen] = useState(false);
  const [state, action, pending] = useActionState(setBedStatus, initialFormState);
  const { shown, formKey } = useDialogState(state, open);
  const [status, setStatus] = useState<string>(bed.status);

  // Close once the change is saved; the page re-renders with the new status.
  useEffect(() => {
    if (state.status === "success") setOpen(false);
  }, [state]);

  const formId = `bed-status-${bed.id}`;

  return (
    <>
      <Button
        variant="secondary"
        size="sm"
        onClick={() => {
          setStatus(bed.status);
          setOpen(true);
        }}
        aria-label={`Change status of bed ${bed.label}`}
      >
        Change status
      </Button>
      {state.status === "success" && (
        <span role="status" className="sr-only">
          {state.message}
        </span>
      )}
      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title={`Bed ${bed.label}`}
        description="Blocked and maintenance beds are not offered for allocation and do not count as vacant."
        footer={
          <>
            <Button variant="secondary" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" form={formId} loading={pending}>
              Save status
            </Button>
          </>
        }
      >
        <form key={formKey} id={formId} action={action} noValidate className="space-y-4">
          <HostelField />
          {shown.formError && <Alert tone="error">{shown.formError}</Alert>}
          <input type="hidden" name="bed_id" value={bed.id} />
          <Select
            id={`${formId}-status`}
            name="status"
            label="Status"
            options={MANUAL_BED_STATUS_OPTIONS}
            value={status}
            onChange={(event) => setStatus(event.currentTarget.value)}
            error={shown.fieldErrors.status?.[0]}
          />
          {status !== "available" && (
            <Input
              id={`${formId}-reason`}
              name="status_reason"
              label="Reason"
              maxLength={200}
              defaultValue={shown.values?.status_reason ?? bed.reason ?? ""}
              hint="Optional. For example: broken bed frame, held for a returning resident."
              error={shown.fieldErrors.status_reason?.[0]}
            />
          )}
        </form>
      </Modal>
    </>
  );
}
