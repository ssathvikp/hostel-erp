"use client";

import { useActionState, useEffect, useState } from "react";

import { HostelField } from "@/components/shell/ActiveHostel";
import { Alert, Button, buttonClass, Modal, Textarea } from "@/components/ui";
import { initialFormState } from "@/lib/validation/result";

import { eraseResident, recordConsent } from "../actions";

const moment = new Intl.DateTimeFormat("en-IN", {
  dateStyle: "medium",
  timeStyle: "short",
  timeZone: "Asia/Kolkata",
});

/**
 * Consent, a copy of the data, and erasure for one resident (DPDP Act,
 * 2023). Erasing is offered only once the resident has left and settled;
 * the database checks the same conditions.
 */
export function DataRights({
  resident,
  isOwner,
  erasable,
  blockers,
}: {
  resident: { id: string; name: string; consentAt: string | null; erasedAt: string | null };
  isOwner: boolean;
  erasable: boolean;
  /** Why erasing is not possible yet, in plain words. */
  blockers: string[];
}) {
  const [consentState, consent, recording] = useActionState(recordConsent, initialFormState);
  const [eraseState, erase, erasing] = useActionState(eraseResident, initialFormState);
  const [confirming, setConfirming] = useState(false);

  useEffect(() => {
    if (eraseState.status === "success") setConfirming(false);
  }, [eraseState]);

  if (resident.erasedAt) {
    return (
      <p className="text-sm text-slate-700">
        Personal details were erased on {moment.format(new Date(resident.erasedAt))}. Stays,
        invoices and payments are kept under this pseudonym.
      </p>
    );
  }

  return (
    <div className="space-y-5 text-sm">
      {consentState.formError && <Alert tone="error">{consentState.formError}</Alert>}
      {eraseState.formError && !confirming && <Alert tone="error">{eraseState.formError}</Alert>}

      <div>
        <h3 className="font-medium text-slate-700">Consent</h3>
        {resident.consentAt ? (
          <p className="mt-1 text-slate-600">
            Agreed to their details being kept, recorded{" "}
            {moment.format(new Date(resident.consentAt))}.
          </p>
        ) : (
          <div className="mt-1 flex flex-wrap items-center gap-3">
            <p className="text-slate-600">Not recorded. Ask the resident, then record it.</p>
            <form action={consent}>
              <HostelField />
              <input type="hidden" name="resident_id" value={resident.id} />
              <Button type="submit" size="sm" variant="secondary" loading={recording}>
                Record consent
              </Button>
            </form>
          </div>
        )}
      </div>

      {isOwner && (
        <>
          <div>
            <h3 className="font-medium text-slate-700">Copy of their data</h3>
            <p className="mt-1 text-slate-600">
              Everything held about {resident.name}, as a file you can share with them.
            </p>
            <a
              href={`/residents/${resident.id}/export`}
              className={buttonClass({ variant: "secondary", size: "sm", className: "mt-2" })}
            >
              Download data
            </a>
          </div>

          <div>
            <h3 className="font-medium text-slate-700">Erase personal details</h3>
            <p className="mt-1 text-slate-600">
              When a former resident asks, remove their contact and ID details. Money and stay
              records are kept, as the law requires, under a pseudonym. This cannot be undone.
            </p>
            {erasable ? (
              <Button
                size="sm"
                variant="danger"
                className="mt-2"
                onClick={() => setConfirming(true)}
              >
                Erase personal details
              </Button>
            ) : (
              <ul className="mt-2 list-disc space-y-0.5 pl-5 text-slate-600">
                {blockers.map((blocker) => (
                  <li key={blocker}>{blocker}</li>
                ))}
              </ul>
            )}
          </div>
        </>
      )}

      <Modal
        open={confirming}
        onClose={() => setConfirming(false)}
        title={`Erase ${resident.name}'s personal details?`}
        description="Name, mobile, email, birth date, address, guardian, notes and the ID proof copy are removed for good. Stays, invoices, payments and deposits stay, without their name."
        footer={
          <>
            <Button variant="secondary" onClick={() => setConfirming(false)}>
              Keep
            </Button>
            <Button type="submit" form="erase-form" variant="danger" loading={erasing}>
              Erase for good
            </Button>
          </>
        }
      >
        <form key={eraseState.id} id="erase-form" action={erase} noValidate className="space-y-4">
          <HostelField />
          {eraseState.formError && <Alert tone="error">{eraseState.formError}</Alert>}
          <input type="hidden" name="resident_id" value={resident.id} />
          <Textarea
            id="erase-reason"
            name="reason"
            label="Reason"
            rows={2}
            maxLength={500}
            required
            hint="For example: asked by the resident on WhatsApp on 12 October."
            defaultValue={eraseState.values?.reason ?? ""}
            error={eraseState.fieldErrors.reason?.[0]}
          />
        </form>
      </Modal>
    </div>
  );
}
