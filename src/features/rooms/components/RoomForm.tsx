"use client";

import Link from "next/link";
import { useActionState } from "react";

import { Alert, Button, buttonClass, Input } from "@/components/ui";
import { initialFormState } from "@/lib/validation/result";

import { createRoom, updateRoom } from "../actions";
import { SharingCapacityFields } from "./SharingCapacityFields";

export interface RoomFormValues {
  id: string;
  room_number: string;
  floor: number;
  sharing_type: string;
  capacity: number;
}

/**
 * Creates a room (E4-T2) or edits one (E4-T7). The hostel always comes from
 * the session on the server; the form never carries it. Room numbers cannot
 * be changed after creation because bed labels are derived from them.
 */
export function RoomForm({ room }: { room?: RoomFormValues }) {
  const [state, action, pending] = useActionState(room ? updateRoom : createRoom, initialFormState);

  const value = (name: keyof RoomFormValues) =>
    state.values?.[name] ?? (room ? String(room[name]) : undefined);

  return (
    <form key={state.id} action={action} noValidate className="space-y-5">
      {state.formError && <Alert tone="error">{state.formError}</Alert>}
      {room && <input type="hidden" name="room_id" value={room.id} />}

      <div className="grid gap-5 sm:grid-cols-2">
        {room ? (
          <Input
            id="room_number"
            name="room_number_display"
            label="Room number"
            value={room.room_number}
            readOnly
            hint="Room numbers cannot change once beds are labelled."
          />
        ) : (
          <Input
            id="room_number"
            label="Room number"
            required
            autoComplete="off"
            maxLength={20}
            defaultValue={value("room_number")}
            hint="For example 101 or G-02."
            error={state.fieldErrors.room_number?.[0]}
          />
        )}
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
        <SharingCapacityFields
          defaultSharing={value("sharing_type")}
          defaultCapacity={value("capacity")}
          errors={state.fieldErrors}
          capacityHint={
            room
              ? "More beds adds the next labels; fewer retires the highest-labelled vacant beds."
              : undefined
          }
        />
      </div>

      <div className="flex flex-col-reverse gap-2 border-t border-slate-200 pt-5 sm:flex-row sm:justify-end">
        <Link
          href={room ? `/rooms/${room.id}` : "/rooms"}
          className={buttonClass({ variant: "ghost" })}
        >
          Cancel
        </Link>
        <Button type="submit" loading={pending}>
          {room ? "Save changes" : "Create room"}
        </Button>
      </div>
    </form>
  );
}
