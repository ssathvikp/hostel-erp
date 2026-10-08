"use client";

import { useState } from "react";

import { Input, Select } from "@/components/ui";
import { MAX_BEDS_PER_ROOM } from "@/lib/validation/schemas";
import { SHARING_TYPES, type SharingType } from "@/types";

import { FIXED_CAPACITY, SHARING_TYPE_OPTIONS } from "../options";

function isSharingType(value: string | undefined): value is SharingType {
  return (SHARING_TYPES as readonly string[]).includes(value ?? "");
}

/**
 * Sharing type and capacity, kept consistent: single, double and triple fix
 * the number of beds; "four or more" lets the owner choose 4 to 12. The
 * server re-checks the same rule.
 */
export function SharingCapacityFields({
  defaultSharing,
  defaultCapacity,
  errors,
  capacityHint,
}: {
  defaultSharing?: string;
  defaultCapacity?: string;
  errors: Record<string, string[] | undefined>;
  capacityHint?: string;
}) {
  const [sharing, setSharing] = useState(defaultSharing ?? "");
  const [capacity, setCapacity] = useState(defaultCapacity ?? "");
  const fixed = isSharingType(sharing) ? FIXED_CAPACITY[sharing] : null;

  return (
    <>
      <Select
        id="sharing_type"
        label="Sharing type"
        required
        placeholder="Choose a sharing type"
        options={SHARING_TYPE_OPTIONS}
        value={sharing}
        onChange={(event) => {
          const next = event.currentTarget.value;
          setSharing(next);
          if (isSharingType(next)) {
            const nextFixed = FIXED_CAPACITY[next];
            if (nextFixed !== null) setCapacity(String(nextFixed));
            else if (Number(capacity) < 4) setCapacity("4");
          }
        }}
        error={errors.sharing_type?.[0]}
      />
      <Input
        id="capacity"
        label="Beds in the room"
        type="number"
        inputMode="numeric"
        required
        min={fixed ?? 4}
        max={fixed ?? MAX_BEDS_PER_ROOM}
        readOnly={fixed !== null}
        value={capacity}
        onChange={(event) => setCapacity(event.currentTarget.value)}
        hint={
          capacityHint ??
          (fixed !== null
            ? "Set by the sharing type."
            : `Between 4 and ${MAX_BEDS_PER_ROOM}. One bed is created for each.`)
        }
        error={errors.capacity?.[0]}
      />
    </>
  );
}
