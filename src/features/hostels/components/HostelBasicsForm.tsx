"use client";

import { useActionState, useState, useTransition } from "react";

import { Alert, Button, Input, Select } from "@/components/ui";
import { usePersistedForm } from "@/lib/hooks/usePersistedForm";
import { initialFormState } from "@/lib/validation/result";

import { isHostelNameTaken, saveHostelBasics } from "../actions";
import { HOSTEL_TYPE_OPTIONS } from "../options";

export interface HostelBasicsDefaults {
  name: string;
  type: string;
  phone: string;
}

/** Onboarding step 1: name, type and contact phone (E3-T3). */
export function HostelBasicsForm({
  defaults,
  persistKey,
}: {
  defaults: HostelBasicsDefaults | null;
  persistKey: string;
}) {
  const [state, action, pending] = useActionState(saveHostelBasics, initialFormState);
  const [nameWarning, setNameWarning] = useState<string | null>(null);
  const [, startCheck] = useTransition();
  const persistRef = usePersistedForm(persistKey);

  const value = (name: keyof HostelBasicsDefaults) => state.values?.[name] ?? defaults?.[name];

  function checkName(name: string) {
    startCheck(async () => {
      const taken = await isHostelNameTaken(name);
      setNameWarning(
        taken
          ? `You already have a hostel called "${name.trim()}". Choose a different name.`
          : null,
      );
    });
  }

  return (
    <form key={state.id} ref={persistRef} action={action} noValidate className="space-y-5">
      {state.formError && <Alert tone="error">{state.formError}</Alert>}

      <Input
        id="name"
        label="Hostel name"
        required
        autoComplete="organization"
        defaultValue={value("name")}
        onBlur={(event) => checkName(event.currentTarget.value)}
        error={state.fieldErrors.name?.[0]}
        hint={
          nameWarning ? (
            <span className="text-amber-700" role="status">
              {nameWarning}
            </span>
          ) : (
            "As residents and parents know it."
          )
        }
      />
      <Select
        id="type"
        label="Hostel type"
        required
        placeholder="Choose a type"
        options={HOSTEL_TYPE_OPTIONS}
        defaultValue={value("type") ?? ""}
        error={state.fieldErrors.type?.[0]}
      />
      <Input
        id="phone"
        label="Contact phone"
        type="tel"
        inputMode="numeric"
        autoComplete="tel"
        required
        defaultValue={value("phone")}
        hint="10-digit mobile number residents can call."
        error={state.fieldErrors.phone?.[0]}
      />

      <div className="flex justify-end">
        <Button type="submit" loading={pending}>
          Continue
        </Button>
      </div>
    </form>
  );
}
