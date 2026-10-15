"use client";

import { useActionState, useState } from "react";

import { Alert, Button, Checkbox, Input, Modal } from "@/components/ui";
import { initialFormState } from "@/lib/validation/result";

import { makeRoomCode, saveResidentReporting } from "../staff-actions";

export function MakeRoomCode({ roomId }: { roomId: string }) {
  const [state, action, pending] = useActionState(makeRoomCode, initialFormState);
  return (
    <form action={action} className="space-y-2">
      <input type="hidden" name="room_id" value={roomId} />
      {state.formError && <Alert tone="error">{state.formError}</Alert>}
      <Button type="submit" size="sm" variant="secondary" loading={pending}>
        Make a QR code
      </Button>
    </form>
  );
}

export function RegenerateRoomCode({ roomId }: { roomId: string }) {
  const [open, setOpen] = useState(false);
  const [state, action, pending] = useActionState(makeRoomCode, initialFormState);
  return (
    <>
      <Button size="sm" variant="secondary" onClick={() => setOpen(true)}>
        Make a new code
      </Button>
      {state.status === "success" && (
        <p role="status" className="text-sm text-emerald-700">
          {state.message}
        </p>
      )}
      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title="Make a new code for this room"
        description="The code printed in the room stops working at once; anyone who kept a photo of it can no longer use it. Print and put up the new one."
        footer={
          <>
            <Button variant="secondary" onClick={() => setOpen(false)}>
              Keep the current code
            </Button>
            <Button
              type="submit"
              form={`regenerate-${roomId}`}
              loading={pending}
              onClick={() => setTimeout(() => setOpen(false), 0)}
            >
              Make a new code
            </Button>
          </>
        }
      >
        <form id={`regenerate-${roomId}`} action={action}>
          <input type="hidden" name="room_id" value={roomId} />
          <input type="hidden" name="regenerate" value="true" />
          {state.formError && <Alert tone="error">{state.formError}</Alert>}
        </form>
      </Modal>
    </>
  );
}

export function ResidentReportingForm({
  enabled,
  confirmDays,
}: {
  enabled: boolean;
  confirmDays: number;
}) {
  const [state, action, pending] = useActionState(saveResidentReporting, initialFormState);
  return (
    <form key={state.id} action={action} noValidate className="max-w-lg space-y-4">
      {state.formError && <Alert tone="error">{state.formError}</Alert>}
      {state.status === "success" && <Alert tone="success">{state.message}</Alert>}
      <Checkbox
        id="resident-reporting-enabled"
        name="enabled"
        label="Residents can report problems from the QR code in their room"
        hint="They confirm who they are with a code sent to the mobile number on their record."
        defaultChecked={enabled}
      />
      <Input
        id="confirm_days"
        type="number"
        min={1}
        max={14}
        label="Days a resident has to confirm a fix"
        required
        defaultValue={String(confirmDays)}
        hint="A fixed complaint the resident does not answer closes on its own after this."
        error={state.fieldErrors.confirm_days?.[0]}
      />
      <Button type="submit" loading={pending}>
        Save
      </Button>
    </form>
  );
}
