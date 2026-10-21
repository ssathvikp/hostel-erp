"use client";

import { useActionState, useState } from "react";

import { HostelField } from "@/components/shell/ActiveHostel";
import { Alert, Button, Checkbox, Input, Select, Textarea } from "@/components/ui";
import { initialFormState } from "@/lib/validation/result";

import { raiseComplaint } from "../actions";
import { PRIORITY_OPTIONS } from "../options";

export interface RoomChoice {
  id: string;
  label: string;
  beds: { id: string; label: string; residentId: string | null }[];
}

/**
 * Raises a complaint for a room (optionally one bed) or a common area,
 * optionally for a resident (ClickUp EP-15 T2). Routing happens as it saves.
 */
export function ComplaintForm({
  rooms,
  residents,
  categories,
  initial,
}: {
  rooms: readonly RoomChoice[];
  residents: readonly { id: string; label: string }[];
  categories: readonly { id: string; name: string }[];
  initial?: { roomId?: string; residentId?: string };
}) {
  const [state, action, pending] = useActionState(raiseComplaint, initialFormState);
  const values = state.values ?? {};
  const [location, setLocation] = useState(values.location ?? "room");
  const [roomId, setRoomId] = useState(values.room_id ?? initial?.roomId ?? "");
  const [bedId, setBedId] = useState(values.bed_id ?? "");
  const beds = rooms.find((room) => room.id === roomId)?.beds ?? [];

  return (
    <form key={state.id} action={action} noValidate className="space-y-5">
      <HostelField />
      {state.formError && <Alert tone="error">{state.formError}</Alert>}

      <fieldset className="space-y-2">
        <legend className="text-sm font-medium text-slate-800">Where is the problem?</legend>
        <div className="flex flex-wrap gap-4 text-sm">
          {(
            [
              ["room", "A room"],
              ["area", "A common area"],
            ] as const
          ).map(([value, label]) => (
            <label key={value} className="flex items-center gap-2">
              <input
                type="radio"
                name="location"
                value={value}
                checked={location === value}
                onChange={() => setLocation(value)}
                className="accent-brand-600"
              />
              {label}
            </label>
          ))}
        </div>
      </fieldset>

      {location === "room" ? (
        <div className="grid gap-4 sm:grid-cols-2">
          <Select
            id="complaint-room"
            name="room_id"
            label="Room"
            placeholder="Choose a room"
            options={rooms.map((room) => ({ value: room.id, label: room.label }))}
            value={roomId}
            onChange={(event) => {
              setRoomId(event.target.value);
              setBedId("");
            }}
            required
            error={state.fieldErrors.room_id?.[0]}
          />
          <Select
            id="complaint-bed"
            name="bed_id"
            label="Bed (optional)"
            placeholder="The whole room"
            options={beds.map((bed) => ({ value: bed.id, label: bed.label }))}
            value={bedId}
            onChange={(event) => setBedId(event.target.value)}
            disabled={beds.length === 0}
            error={state.fieldErrors.bed_id?.[0]}
          />
        </div>
      ) : (
        <Input
          id="complaint-area"
          name="area"
          label="Area"
          placeholder="e.g. Kitchen, Terrace, Ground floor corridor"
          defaultValue={values.area ?? ""}
          required
          error={state.fieldErrors.area?.[0]}
        />
      )}

      <div className="grid gap-4 sm:grid-cols-2">
        <Select
          id="complaint-category"
          name="category_id"
          label="Category"
          placeholder="Choose"
          options={categories.map((category) => ({ value: category.id, label: category.name }))}
          defaultValue={values.category_id ?? ""}
          required
          error={state.fieldErrors.category_id?.[0]}
        />
        <Select
          id="complaint-priority"
          name="priority"
          label="Priority"
          options={PRIORITY_OPTIONS}
          defaultValue={values.priority ?? "normal"}
          error={state.fieldErrors.priority?.[0]}
        />
      </div>
      <Input
        id="complaint-title"
        name="title"
        label="What is wrong"
        placeholder="e.g. Ceiling fan not working"
        defaultValue={values.title ?? ""}
        required
        error={state.fieldErrors.title?.[0]}
      />
      <Textarea
        id="complaint-description"
        name="description"
        label="Details (optional)"
        rows={3}
        defaultValue={values.description ?? ""}
        error={state.fieldErrors.description?.[0]}
      />
      <Select
        id="complaint-resident"
        name="resident_id"
        label="For a resident (optional)"
        hint="Needed to charge a repair to the resident later."
        placeholder="Nobody in particular"
        options={residents.map((resident) => ({ value: resident.id, label: resident.label }))}
        defaultValue={values.resident_id ?? initial?.residentId ?? ""}
        error={state.fieldErrors.resident_id?.[0]}
      />
      {location === "room" && bedId && (
        <Checkbox
          id="complaint-bed-maintenance"
          name="bed_maintenance"
          label="Mark this bed as under maintenance"
          hint="Nobody can be given the bed until it is made available again."
          defaultChecked={values.bed_maintenance === "on"}
        />
      )}
      <Button type="submit" loading={pending}>
        Raise complaint
      </Button>
      <p className="text-sm text-slate-600">
        It is sent to the right worker automatically when one is available. Add photos on the next
        page.
      </p>
    </form>
  );
}
