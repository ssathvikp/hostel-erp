"use client";

import Link from "next/link";
import { useActionState, useEffect } from "react";

import { Alert, Button, focusRing, Input, Select } from "@/components/ui";
import { cn } from "@/lib/cn";
import { clearPersistedForm, usePersistedForm } from "@/lib/hooks/usePersistedForm";
import { initialFormState } from "@/lib/validation/result";

import { completeHostelOnboarding } from "../actions";
import { INDIAN_STATE_OPTIONS } from "../options";

export interface HostelAddressDefaults {
  address: string | null;
  city: string | null;
  state: string | null;
  pincode: string | null;
  alt_phone: string | null;
  email: string | null;
  floors: number | null;
}

/** Onboarding step 2: address, extra contacts and capacity (E3-T4). */
export function HostelAddressForm({
  defaults,
  persistKey,
  clearKey,
}: {
  defaults: HostelAddressDefaults;
  persistKey: string;
  /** Step 1's unsaved-input key: step 1 is saved once this form shows. */
  clearKey: string;
}) {
  const [state, action, pending] = useActionState(completeHostelOnboarding, initialFormState);
  const persistRef = usePersistedForm(persistKey);
  useEffect(() => clearPersistedForm(clearKey), [clearKey]);

  const value = (name: keyof HostelAddressDefaults) =>
    state.values?.[name] ?? defaults[name]?.toString() ?? undefined;

  return (
    <form key={state.id} ref={persistRef} action={action} noValidate className="space-y-5">
      {state.formError && <Alert tone="error">{state.formError}</Alert>}

      <Input
        id="address"
        label="Street address"
        required
        autoComplete="street-address"
        defaultValue={value("address")}
        error={state.fieldErrors.address?.[0]}
      />
      <div className="grid gap-5 sm:grid-cols-2">
        <Input
          id="city"
          label="City"
          required
          autoComplete="address-level2"
          defaultValue={value("city")}
          error={state.fieldErrors.city?.[0]}
        />
        <Select
          id="state"
          label="State"
          required
          placeholder="Choose a state"
          options={INDIAN_STATE_OPTIONS}
          defaultValue={value("state") ?? ""}
          error={state.fieldErrors.state?.[0]}
        />
        <Input
          id="pincode"
          label="PIN code"
          required
          inputMode="numeric"
          autoComplete="postal-code"
          maxLength={6}
          defaultValue={value("pincode")}
          error={state.fieldErrors.pincode?.[0]}
        />
        <Input
          id="floors"
          label="Number of floors"
          type="number"
          required
          min={1}
          max={100}
          defaultValue={value("floors")}
          hint="Count the ground floor as 1."
          error={state.fieldErrors.floors?.[0]}
        />
        <Input
          id="alt_phone"
          label="Alternate phone"
          type="tel"
          inputMode="numeric"
          defaultValue={value("alt_phone")}
          hint="Optional, for example a warden."
          error={state.fieldErrors.alt_phone?.[0]}
        />
        <Input
          id="email"
          label="Hostel email"
          type="email"
          autoComplete="email"
          defaultValue={value("email")}
          hint="Optional."
          error={state.fieldErrors.email?.[0]}
        />
      </div>

      <div className="flex items-center justify-between">
        <Link
          href="/onboarding?step=1"
          className={cn("rounded-md text-sm font-medium text-slate-700 hover:underline", focusRing)}
        >
          Back
        </Link>
        <Button type="submit" loading={pending}>
          Finish setup
        </Button>
      </div>
    </form>
  );
}
