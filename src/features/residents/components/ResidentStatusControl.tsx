"use client";

import { useActionState, useState } from "react";

import { HostelField } from "@/components/shell/ActiveHostel";
import { Alert, Button, Modal } from "@/components/ui";
import { initialFormState } from "@/lib/validation/result";
import type { ResidentStatus } from "@/types";

import { changeResidentStatus } from "../actions";
import { NEXT_STATUSES, RESIDENT_STATUS_LABELS, STATUS_ACTION_LABELS } from "../options";

const CONSEQUENCES: Record<ResidentStatus, string> = {
  active: "The resident can be allocated a bed and billed again.",
  notice: "The resident has given notice and is expected to leave. Billing continues.",
  vacated: "The resident has left. They stay searchable but cannot be given a bed or billed.",
  blocked: "The resident cannot be given a bed until they are made active again.",
};

/**
 * Moves a resident through active, notice, vacated and blocked (E5-T6).
 * Only the transitions the database allows are offered; the database still
 * decides, and records who made the change and when.
 */
export function ResidentStatusControl({
  resident,
}: {
  resident: { id: string; name: string; status: ResidentStatus };
}) {
  const [state, action, pending] = useActionState(changeResidentStatus, initialFormState);
  const [target, setTarget] = useState<ResidentStatus | null>(null);

  return (
    <div className="space-y-3">
      {state.formError && <Alert tone="error">{state.formError}</Alert>}
      {state.status === "success" && <Alert tone="success">{state.message}</Alert>}
      <div className="flex flex-wrap gap-2">
        {NEXT_STATUSES[resident.status].map((status) => (
          <Button
            key={status}
            variant={status === "blocked" || status === "vacated" ? "secondary" : "primary"}
            size="sm"
            onClick={() => setTarget(status)}
          >
            {STATUS_ACTION_LABELS[status]}
          </Button>
        ))}
      </div>

      <Modal
        open={target !== null}
        onClose={() => setTarget(null)}
        title={target ? `${STATUS_ACTION_LABELS[target]}?` : ""}
        description={
          target
            ? `${resident.name} moves from ${RESIDENT_STATUS_LABELS[resident.status].toLowerCase()} to ${RESIDENT_STATUS_LABELS[target].toLowerCase()}. ${CONSEQUENCES[target]}`
            : undefined
        }
        footer={
          <>
            <Button variant="secondary" onClick={() => setTarget(null)}>
              Cancel
            </Button>
            <form action={action} onSubmit={() => setTarget(null)}>
              <HostelField />
              <input type="hidden" name="resident_id" value={resident.id} />
              <input type="hidden" name="status" value={target ?? ""} />
              <Button type="submit" loading={pending} className="w-full">
                {target ? STATUS_ACTION_LABELS[target] : "Confirm"}
              </Button>
            </form>
          </>
        }
      />
    </div>
  );
}
