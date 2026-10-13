"use client";

import { useActionState, useState } from "react";

import { Alert, Button, Checkbox, Input, Select, Textarea } from "@/components/ui";
import { initialFormState } from "@/lib/validation/result";

import { raiseComplaint } from "../actions";
import { PRIORITY_OPTIONS } from "../options";

export interface RoomChoice {
  id: string;
  label: string;
  beds: { id: string; label: string }[];
}

export interface ResidentChoice {
  id: string;
  name: string;
  roomId: string | null;
}

/**
 * Raises a complaint for a room, one of its beds, or a common area (E15-T2).
 * Owners and staff can raise one on behalf of a resident; choosing the
 * resident first fills in their room.
 */
export function ComplaintForm({
  categories,
  rooms,
  residents,
  initial,
}: {
  categories: readonly { value: string; label: string }[];
  rooms: readonly RoomChoice[];
  residents: readonly ResidentChoice[];
  initial: { roomId?: string; residentId?: string };
}) {
  const [state, action, pending] = useActionState(raiseComplaint, initialFormState);
  const values = state.values;
  const [place, setPlace] = useState<"room" | "area">(
    (values?.place as "room" | "area") || (rooms.length === 0 ? "area" : "room"),
  );
  const [roomId, setRoomId] = useState(values?.room_id ?? initial.roomId ?? "");
  const [residentId, setResidentId] = useState(values?.resident_id ?? initial.residentId ?? "");
  const [bedId, setBedId] = useState(values?.bed_id ?? "");
  const room = rooms.find((r) => r.id === roomId);
  const errors = state.fieldErrors;

  function chooseResident(id: string) {
    setResidentId(id);
    const resident = residents.find((r) => r.id === id);
    if (resident?.roomId) {
      setPlace("room");
      setRoomId(resident.roomId);
      setBedId("");
    }
  }

  return (
    <form
      key={state.id}
      action={action}
      noValidate
      className="space-y-5 rounded-lg border border-slate-200 bg-white p-5 sm:p-6"
    >
      {state.formError && <Alert tone="error">{state.formError}</Alert>}

      <Input
        id="title"
        label="What is wrong"
        placeholder="e.g. Ceiling fan not working"
        defaultValue={values?.title ?? ""}
        required
        maxLength={120}
        error={errors.title?.[0]}
      />
      <div className="grid gap-4 sm:grid-cols-2">
        <Select
          id="category_id"
          label="Category"
          placeholder="Choose a category"
          options={categories}
          defaultValue={values?.category_id ?? ""}
          required
          hint="Decides which worker it goes to."
          error={errors.category_id?.[0]}
        />
        <Select
          id="priority"
          label="Priority"
          options={PRIORITY_OPTIONS}
          defaultValue={values?.priority || "normal"}
          required
          error={errors.priority?.[0]}
        />
      </div>
      <Textarea
        id="description"
        label="Details"
        rows={4}
        defaultValue={values?.description ?? ""}
        maxLength={2000}
        hint="Optional. What the worker should know before coming."
        error={errors.description?.[0]}
      />

      {residents.length > 0 && (
        <Select
          id="resident_id"
          label="Reported by resident"
          placeholder="Nobody (found on rounds)"
          options={residents.map((r) => ({ value: r.id, label: r.name }))}
          value={residentId}
          onChange={(event) => chooseResident(event.target.value)}
          error={errors.resident_id?.[0]}
        />
      )}

      <fieldset className="space-y-3">
        <legend className="text-sm font-medium text-slate-800">Where</legend>
        <div className="flex gap-6 text-sm">
          {(["room", "area"] as const).map((option) => (
            <label key={option} className="flex items-center gap-2">
              <input
                type="radio"
                name="place"
                value={option}
                checked={place === option}
                onChange={() => setPlace(option)}
                disabled={option === "room" && rooms.length === 0}
                className="size-4 accent-brand-600"
              />
              {option === "room" ? "A room" : "A common area"}
            </label>
          ))}
        </div>
        {place === "room" ? (
          <div className="grid gap-4 sm:grid-cols-2">
            <Select
              id="room_id"
              label="Room"
              placeholder="Choose a room"
              options={rooms.map((r) => ({ value: r.id, label: r.label }))}
              value={roomId}
              onChange={(event) => {
                setRoomId(event.target.value);
                setBedId("");
              }}
              required
              error={errors.room_id?.[0]}
            />
            <Select
              id="bed_id"
              label="Bed"
              placeholder="The whole room"
              options={(room?.beds ?? []).map((bed) => ({ value: bed.id, label: bed.label }))}
              value={bedId}
              onChange={(event) => setBedId(event.target.value)}
              disabled={!room}
              error={errors.bed_id?.[0]}
            />
            {bedId && (
              <div className="sm:col-span-2">
                <Checkbox
                  id="bed_maintenance"
                  label="Take this bed out of service until it is fixed"
                  hint="It cannot be allocated while under maintenance, and comes back once the complaint is resolved."
                  defaultChecked={values?.bed_maintenance === "on"}
                />
              </div>
            )}
          </div>
        ) : (
          <Input
            id="area"
            label="Common area"
            placeholder="e.g. Second floor bathroom, kitchen, terrace"
            defaultValue={values?.area ?? ""}
            required
            maxLength={100}
            error={errors.area?.[0] ?? errors.room_id?.[0]}
          />
        )}
      </fieldset>

      <div className="flex justify-end">
        <Button type="submit" loading={pending}>
          Raise complaint
        </Button>
      </div>
    </form>
  );
}
