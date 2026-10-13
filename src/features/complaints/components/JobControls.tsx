"use client";

import { useActionState, useState } from "react";

import { Alert, Button, Input, Textarea } from "@/components/ui";
import { paiseToInput } from "@/lib/money";
import { initialFormState } from "@/lib/validation/result";
import type { ComplaintStatus } from "@/types";

import { actOnJob, uploadJobPhoto } from "../job-actions";

type Step = "decline" | "done" | null;

/**
 * The worker's buttons on their job page (E15-T8): accept or decline, then
 * on the way, started and done with a note and their charge.
 */
export function JobControls({
  token,
  status,
  accepted,
  vendorCharge,
}: {
  token: string;
  status: ComplaintStatus;
  accepted: boolean;
  vendorCharge: number;
}) {
  const [state, action, pending] = useActionState(actOnJob, initialFormState);
  const [step, setStep] = useState<Step>(null);
  const finished = status === "resolved" || status === "closed";

  if (finished) {
    return <Alert tone="success">This job is marked done. Thank you.</Alert>;
  }

  return (
    <div className="space-y-4">
      {state.status === "success" && <Alert tone="success">{state.message}</Alert>}
      {state.formError && <Alert tone="error">{state.formError}</Alert>}

      {step === null && (
        <div className="grid gap-2 sm:grid-cols-2">
          {!accepted ? (
            <>
              <form action={action}>
                <input type="hidden" name="token" value={token} />
                <input type="hidden" name="action" value="accept" />
                <Button type="submit" className="w-full" loading={pending}>
                  Accept job
                </Button>
              </form>
              <Button variant="secondary" className="w-full" onClick={() => setStep("decline")}>
                I can&apos;t take it
              </Button>
            </>
          ) : (
            <>
              <form action={action}>
                <input type="hidden" name="token" value={token} />
                <input type="hidden" name="action" value="on_the_way" />
                <Button type="submit" variant="secondary" className="w-full" loading={pending}>
                  I&apos;m on the way
                </Button>
              </form>
              {status !== "in_progress" && (
                <form action={action}>
                  <input type="hidden" name="token" value={token} />
                  <input type="hidden" name="action" value="start" />
                  <Button type="submit" variant="secondary" className="w-full" loading={pending}>
                    Started work
                  </Button>
                </form>
              )}
              <Button className="w-full sm:col-span-2" onClick={() => setStep("done")}>
                Work is done
              </Button>
            </>
          )}
        </div>
      )}

      {step === "decline" && (
        <form key={state.id} action={action} noValidate className="space-y-3">
          <input type="hidden" name="token" value={token} />
          <input type="hidden" name="action" value="decline" />
          <Textarea
            id="decline-note"
            name="note"
            label="Why can't you take it?"
            required
            defaultValue={state.values?.note ?? ""}
            maxLength={2000}
            error={state.fieldErrors.note?.[0]}
          />
          <div className="flex gap-2">
            <Button type="submit" loading={pending}>
              Decline job
            </Button>
            <Button variant="ghost" onClick={() => setStep(null)}>
              Back
            </Button>
          </div>
        </form>
      )}

      {step === "done" && (
        <form key={state.id} action={action} noValidate className="space-y-3">
          <input type="hidden" name="token" value={token} />
          <input type="hidden" name="action" value="done" />
          <Textarea
            id="done-note"
            name="note"
            label="What did you do?"
            defaultValue={state.values?.note ?? ""}
            maxLength={2000}
            hint="Optional. e.g. Replaced the tap washer."
            error={state.fieldErrors.note?.[0]}
          />
          <Input
            id="done-charge"
            name="charge"
            label="Your charge (₹)"
            inputMode="decimal"
            defaultValue={state.values?.charge ?? (vendorCharge ? paiseToInput(vendorCharge) : "")}
            hint="Optional. Labour and parts together."
            error={state.fieldErrors.charge?.[0]}
          />
          <div className="flex gap-2">
            <Button type="submit" loading={pending}>
              Mark done
            </Button>
            <Button variant="ghost" onClick={() => setStep(null)}>
              Back
            </Button>
          </div>
        </form>
      )}
    </div>
  );
}

export function JobPhotoUpload({ token }: { token: string }) {
  const [state, action, pending] = useActionState(uploadJobPhoto, initialFormState);
  return (
    <form key={state.id} action={action} className="space-y-2">
      <input type="hidden" name="token" value={token} />
      <Input
        id="job-photo"
        name="file"
        type="file"
        label="Add a photo of the finished work"
        accept="image/jpeg,image/png,image/webp"
        capture="environment"
        hint="JPG, PNG or WebP, up to 5 MB."
        error={state.fieldErrors.file?.[0]}
      />
      {state.status === "success" && (
        <p role="status" className="text-sm text-emerald-700">
          {state.message}
        </p>
      )}
      {state.formError && <Alert tone="error">{state.formError}</Alert>}
      <Button type="submit" variant="secondary" size="sm" loading={pending}>
        Upload photo
      </Button>
    </form>
  );
}
