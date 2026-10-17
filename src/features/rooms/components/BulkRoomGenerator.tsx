"use client";

import Link from "next/link";
import { useActionState, useState } from "react";

import { HostelField } from "@/components/shell/ActiveHostel";
import { Alert, Button, buttonClass, Input } from "@/components/ui";

import { generateRooms, type BulkRoomState } from "../actions";
import { floorLabel, SHARING_TYPE_LABELS } from "../options";
import { summariseRange } from "../plan";
import { SharingCapacityFields } from "./SharingCapacityFields";

const initialState: BulkRoomState = { id: "initial", status: "idle", fieldErrors: {} };

/**
 * Bulk room generation for a number range (E4-T5). "Preview" lists exactly
 * which rooms and beds will be created and flags numbers that already exist;
 * "Create" then makes them all in one database call, or none at all.
 */
export function BulkRoomGenerator() {
  // Each round is a fresh form; "Generate more rooms" starts the next one.
  const [round, setRound] = useState(0);
  return <BulkRoomRound key={round} onReset={() => setRound((value) => value + 1)} />;
}

function BulkRoomRound({ onReset }: { onReset: () => void }) {
  const [state, action, pending] = useActionState(generateRooms, initialState);
  // Any edit after a preview makes it stale: hide the create button until
  // the owner previews again.
  const [editedSince, setEditedSince] = useState<string | null>(null);

  if (state.created) {
    return (
      <div className="space-y-5">
        <Alert tone="success" title="Rooms created">
          Created {state.created.rooms} {state.created.rooms === 1 ? "room" : "rooms"} with{" "}
          {state.created.beds} {state.created.beds === 1 ? "bed" : "beds"}.
        </Alert>
        <div className="flex flex-col gap-2 sm:flex-row">
          <Link href="/rooms" className={buttonClass()}>
            View rooms
          </Link>
          <Button variant="secondary" onClick={onReset}>
            Generate more rooms
          </Button>
        </div>
      </div>
    );
  }

  const preview = editedSince === state.id ? undefined : state.preview;
  const value = (name: string) => state.values?.[name];

  return (
    <form
      key={state.id}
      action={action}
      noValidate
      onChange={() => setEditedSince(state.id)}
      className="space-y-6"
    >
      <HostelField />
      {state.formError && <Alert tone="error">{state.formError}</Alert>}

      <div className="grid gap-5 sm:grid-cols-2">
        <Input
          id="from_number"
          label="First room number"
          type="number"
          inputMode="numeric"
          required
          min={1}
          defaultValue={value("from_number")}
          error={state.fieldErrors.from_number?.[0]}
        />
        <Input
          id="to_number"
          label="Last room number"
          type="number"
          inputMode="numeric"
          required
          min={1}
          defaultValue={value("to_number")}
          hint="Up to 100 rooms at a time."
          error={state.fieldErrors.to_number?.[0]}
        />
        <Input
          id="floor"
          label="Floor"
          type="number"
          inputMode="numeric"
          required
          min={0}
          max={100}
          defaultValue={value("floor")}
          hint="0 is the ground floor."
          error={state.fieldErrors.floor?.[0]}
        />
        <div className="hidden sm:block" aria-hidden="true" />
        <SharingCapacityFields
          defaultSharing={value("sharing_type")}
          defaultCapacity={value("capacity")}
          errors={state.fieldErrors}
        />
      </div>

      {preview && (
        <section
          aria-labelledby="bulk-preview-heading"
          className="space-y-3 rounded-lg border border-slate-200 bg-slate-50 p-4"
        >
          <h2 id="bulk-preview-heading" className="text-sm font-semibold text-slate-900">
            Preview: {preview.roomNumbers.length}{" "}
            {preview.roomNumbers.length === 1 ? "room" : "rooms"} and {preview.bedCount}{" "}
            {preview.bedCount === 1 ? "bed" : "beds"}
          </h2>
          <dl className="grid gap-x-6 gap-y-1 text-sm sm:grid-cols-[auto_1fr]">
            <dt className="text-slate-600">Rooms</dt>
            <dd className="font-medium text-slate-900">{summariseRange(preview.roomNumbers)}</dd>
            <dt className="text-slate-600">Floor</dt>
            <dd className="text-slate-900">{floorLabel(preview.floor)}</dd>
            <dt className="text-slate-600">Each room</dt>
            <dd className="text-slate-900">
              {SHARING_TYPE_LABELS[preview.sharingType]}, {preview.capacity}{" "}
              {preview.capacity === 1 ? "bed" : "beds"} (labelled {preview.roomNumbers[0]}-A
              {preview.capacity > 1 &&
                ` to ${preview.roomNumbers[0]}-${String.fromCharCode(64 + preview.capacity)}`}
              )
            </dd>
          </dl>
          {preview.conflicts.length > 0 && (
            <Alert tone="error" title="Some rooms already exist">
              {summariseRange(preview.conflicts)} {preview.conflicts.length === 1 ? "is" : "are"}{" "}
              already in this hostel. Change the range so it only covers new rooms.
            </Alert>
          )}
        </section>
      )}

      <div className="flex flex-col-reverse gap-2 border-t border-slate-200 pt-5 sm:flex-row sm:justify-end">
        <Link href="/rooms" className={buttonClass({ variant: "ghost" })}>
          Cancel
        </Link>
        <Button
          type="submit"
          name="intent"
          value="preview"
          variant={preview ? "secondary" : "primary"}
          loading={pending && !preview}
        >
          {preview ? "Preview again" : "Preview"}
        </Button>
        {preview && preview.conflicts.length === 0 && (
          <Button type="submit" name="intent" value="create" loading={pending}>
            Create {preview.roomNumbers.length}{" "}
            {preview.roomNumbers.length === 1 ? "room" : "rooms"}
          </Button>
        )}
      </div>
    </form>
  );
}
