"use client";

import Link from "next/link";
import { useActionState, useState, type ReactNode } from "react";

import { Alert, Button, buttonClass, Input, Select, Textarea } from "@/components/ui";
import { ID_PROOF_FORMATS } from "@/lib/validation/schemas";
import { todayIst } from "@/lib/validation/fields";
import type { IdProofType } from "@/types";

import { registerResident, updateResident, type ResidentFormState } from "../actions";
import { GENDER_LABELS, GENDER_OPTIONS, ID_PROOF_LABELS, ID_PROOF_OPTIONS } from "../options";

const initialState: ResidentFormState = { id: "initial", status: "idle", fieldErrors: {} };

export interface ResidentFormValues {
  id: string;
  full_name: string;
  gender: string;
  dob: string;
  id_proof_type: string;
  id_proof_last4: string;
  phone: string;
  alt_phone: string | null;
  email: string | null;
  guardian_name: string | null;
  guardian_phone: string | null;
  permanent_address: string;
  notes: string | null;
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="space-y-5 border-t border-slate-200 pt-6 first:border-t-0 first:pt-0">
      <h2 className="text-base font-semibold text-slate-900">{title}</h2>
      <div className="grid gap-5 sm:grid-cols-2">{children}</div>
    </section>
  );
}

function ReadOnly({ label, value }: { label: string; value: string }) {
  return (
    <div className="space-y-1.5">
      <p className="text-sm font-medium text-slate-800">{label}</p>
      <p className="text-sm text-slate-700">{value}</p>
    </div>
  );
}

/**
 * Registers a resident (E5-T2) or edits one. Identity (name, gender, date of
 * birth and ID proof) is fixed at registration; editing covers contact,
 * address, guardian and notes. The full ID number is sent once, turned into
 * last-4 plus a keyed hash on the server, and never echoed back or saved in
 * the browser.
 */
export function ResidentForm({ resident }: { resident?: ResidentFormValues }) {
  const [state, action, pending] = useActionState(
    resident ? updateResident : registerResident,
    initialState,
  );
  const [idType, setIdType] = useState<string>(state.values?.id_proof_type ?? "");
  const errors = state.fieldErrors;

  const value = (name: keyof ResidentFormValues) =>
    state.values?.[name] ?? (resident ? (resident[name] ?? undefined) : undefined);
  const today = todayIst();
  const format = ID_PROOF_FORMATS[idType as IdProofType];

  return (
    <form key={state.id} action={action} noValidate className="space-y-6">
      {state.formError && <Alert tone="error">{state.formError}</Alert>}
      {state.existing && (
        <Alert tone="error" title="Already registered">
          {state.existing.match === "phone"
            ? "This phone number belongs to "
            : "This ID proof belongs to "}
          <span className="font-medium">{state.existing.name}</span>.{" "}
          <Link
            href={`/residents/${state.existing.id}`}
            className="font-medium text-brand-700 underline"
          >
            Open the existing resident
          </Link>
        </Alert>
      )}
      {resident && <input type="hidden" name="resident_id" value={resident.id} />}

      <Section title="Identity">
        {resident ? (
          <>
            <ReadOnly label="Full name" value={resident.full_name} />
            <ReadOnly
              label="Gender"
              value={GENDER_LABELS[resident.gender as keyof typeof GENDER_LABELS]}
            />
            <ReadOnly label="Date of birth" value={resident.dob} />
            <ReadOnly
              label="ID proof"
              value={`${ID_PROOF_LABELS[resident.id_proof_type as IdProofType]} ending ${resident.id_proof_last4}`}
            />
          </>
        ) : (
          <>
            <div className="sm:col-span-2">
              <Input
                id="full_name"
                label="Full name"
                required
                autoComplete="off"
                defaultValue={value("full_name")}
                hint="As written on the ID proof."
                error={errors.full_name?.[0]}
              />
            </div>
            <Select
              id="gender"
              label="Gender"
              required
              placeholder="Choose a gender"
              options={GENDER_OPTIONS}
              defaultValue={value("gender") ?? ""}
              error={errors.gender?.[0]}
            />
            <Input
              id="dob"
              label="Date of birth"
              type="date"
              required
              max={today}
              defaultValue={value("dob")}
              error={errors.dob?.[0]}
            />
            <Select
              id="id_proof_type"
              label="ID proof type"
              required
              placeholder="Choose a document"
              options={ID_PROOF_OPTIONS}
              value={idType}
              onChange={(event) => setIdType(event.currentTarget.value)}
              error={errors.id_proof_type?.[0]}
            />
            <Input
              id="id_proof_number"
              label="ID proof number"
              required
              autoComplete="off"
              spellCheck={false}
              hint={
                format
                  ? `Format: ${format.example}. Only the last 4 characters are kept.`
                  : "Only the last 4 characters are kept."
              }
              error={errors.id_proof_number?.[0]}
            />
          </>
        )}
      </Section>

      <Section title="Contact">
        <Input
          id="phone"
          label="Mobile number"
          type="tel"
          inputMode="numeric"
          required
          defaultValue={value("phone")}
          error={errors.phone?.[0]}
        />
        <Input
          id="alt_phone"
          label="Alternate number"
          type="tel"
          inputMode="numeric"
          defaultValue={value("alt_phone")}
          hint="Optional."
          error={errors.alt_phone?.[0]}
        />
        <div className="sm:col-span-2">
          <Input
            id="email"
            label="Email"
            type="email"
            defaultValue={value("email")}
            hint="Optional."
            error={errors.email?.[0]}
          />
        </div>
        <div className="sm:col-span-2">
          <Textarea
            id="permanent_address"
            label="Permanent address"
            required
            defaultValue={value("permanent_address")}
            error={errors.permanent_address?.[0]}
          />
        </div>
      </Section>

      <Section title="Guardian">
        <Input
          id="guardian_name"
          label="Guardian name"
          defaultValue={value("guardian_name")}
          hint="Optional."
          error={errors.guardian_name?.[0]}
        />
        <Input
          id="guardian_phone"
          label="Guardian mobile"
          type="tel"
          inputMode="numeric"
          defaultValue={value("guardian_phone")}
          hint="Optional."
          error={errors.guardian_phone?.[0]}
        />
      </Section>

      <Section title="Stay">
        {!resident && (
          <Input
            id="joining_date"
            label="Joining date"
            type="date"
            required
            defaultValue={state.values?.joining_date ?? today}
            error={errors.joining_date?.[0]}
          />
        )}
        <div className="sm:col-span-2">
          <Textarea
            id="notes"
            label="Notes"
            defaultValue={value("notes")}
            hint="Optional. Visible to the hostel's owner and staff."
            error={errors.notes?.[0]}
          />
        </div>
      </Section>

      <div className="flex flex-col-reverse gap-2 border-t border-slate-200 pt-5 sm:flex-row sm:justify-end">
        <Link
          href={resident ? `/residents/${resident.id}` : "/residents"}
          className={buttonClass({ variant: "ghost" })}
        >
          Cancel
        </Link>
        <Button type="submit" loading={pending}>
          {resident ? "Save changes" : "Register resident"}
        </Button>
      </div>
    </form>
  );
}
