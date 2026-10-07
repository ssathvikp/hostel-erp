"use client";

import { useActionState } from "react";

import { Alert, Button, Input, Select } from "@/components/ui";
import { initialFormState } from "@/lib/validation/result";

import { updateHostelSettings } from "../actions";
import { HOSTEL_TYPE_OPTIONS, INDIAN_STATE_OPTIONS } from "../options";

export interface HostelSettingsValues {
  name: string;
  type: string;
  phone: string;
  alt_phone: string | null;
  email: string | null;
  address: string | null;
  city: string | null;
  state: string | null;
  pincode: string | null;
  gstin: string | null;
  floors: number | null;
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="space-y-5 border-t border-slate-200 pt-6 first:border-t-0 first:pt-0">
      <h2 className="text-base font-semibold text-slate-900">{title}</h2>
      <div className="grid gap-5 sm:grid-cols-2">{children}</div>
    </section>
  );
}

/** Edits every non-identity hostel field (E3-T5). Read-only for staff. */
export function HostelSettingsForm({
  hostel,
  canEdit,
}: {
  hostel: HostelSettingsValues;
  canEdit: boolean;
}) {
  const [state, action, pending] = useActionState(updateHostelSettings, initialFormState);

  // After a successful save the page re-renders from the database, so
  // `hostel` is the source of truth; typed values are echoed only on failure.
  const value = (name: keyof HostelSettingsValues) =>
    (state.status === "error" ? state.values?.[name] : undefined) ??
    hostel[name]?.toString() ??
    undefined;

  return (
    <form key={state.id} action={action} noValidate className="space-y-6">
      {!canEdit && <Alert tone="info">Only the hostel owner can change these details.</Alert>}
      {state.formError && <Alert tone="error">{state.formError}</Alert>}
      {state.status === "success" && <Alert tone="success">{state.message}</Alert>}

      <fieldset disabled={!canEdit} className="space-y-6">
        <Section title="Basics">
          <Input
            id="name"
            label="Hostel name"
            required
            defaultValue={value("name")}
            error={state.fieldErrors.name?.[0]}
          />
          <Select
            id="type"
            label="Hostel type"
            required
            options={HOSTEL_TYPE_OPTIONS}
            defaultValue={value("type")}
            error={state.fieldErrors.type?.[0]}
          />
          <Input
            id="phone"
            label="Contact phone"
            type="tel"
            inputMode="numeric"
            required
            defaultValue={value("phone")}
            error={state.fieldErrors.phone?.[0]}
          />
          <Input
            id="alt_phone"
            label="Alternate phone"
            type="tel"
            inputMode="numeric"
            defaultValue={value("alt_phone")}
            hint="Optional."
            error={state.fieldErrors.alt_phone?.[0]}
          />
          <Input
            id="email"
            label="Hostel email"
            type="email"
            defaultValue={value("email")}
            hint="Optional."
            error={state.fieldErrors.email?.[0]}
          />
          <Input
            id="gstin"
            label="GSTIN"
            defaultValue={value("gstin")}
            hint="Optional. Shown on invoices once billing is set up."
            error={state.fieldErrors.gstin?.[0]}
          />
        </Section>

        <Section title="Address and capacity">
          <div className="sm:col-span-2">
            <Input
              id="address"
              label="Street address"
              required
              defaultValue={value("address")}
              error={state.fieldErrors.address?.[0]}
            />
          </div>
          <Input
            id="city"
            label="City"
            required
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
            error={state.fieldErrors.floors?.[0]}
          />
        </Section>
      </fieldset>

      {canEdit && (
        <div className="flex justify-end border-t border-slate-200 pt-6">
          <Button type="submit" loading={pending}>
            Save changes
          </Button>
        </div>
      )}
    </form>
  );
}
