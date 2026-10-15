"use client";

import { useActionState, useState } from "react";

import { Alert, Button, Input, Select, Textarea } from "@/components/ui";
import { shrinkInputFiles } from "@/lib/images/shrink";
import { initialFormState } from "@/lib/validation/result";

import {
  endResidentSession,
  raiseResidentComplaint,
  requestResidentCode,
  respondToFix,
  verifyResidentCode,
  type CodeState,
} from "../actions";

/**
 * Step 1 and 2 on the room page (E15-T3): the mobile number on the
 * resident's record, then the code sent to it. Built for a cheap phone:
 * plain fields, numeric keyboards, no scripts beyond the form itself.
 */
export function ResidentSignIn({ token }: { token: string }) {
  const [requested, request, requesting] = useActionState<CodeState, FormData>(
    requestResidentCode,
    initialFormState,
  );
  const [verified, verify, verifying] = useActionState<CodeState, FormData>(
    verifyResidentCode,
    initialFormState,
  );
  const [changing, setChanging] = useState(false);
  const phone = verified.phone ?? requested.phone;
  const askCode = Boolean(phone) && !changing;

  if (!askCode) {
    return (
      <form
        key={requested.id}
        action={(data) => {
          setChanging(false);
          request(data);
        }}
        noValidate
        className="space-y-4"
      >
        <input type="hidden" name="token" value={token} />
        {requested.formError && <Alert tone="error">{requested.formError}</Alert>}
        <Input
          id="phone"
          name="phone"
          type="tel"
          inputMode="numeric"
          autoComplete="tel-national"
          label="Your mobile number"
          required
          defaultValue={requested.values?.phone ?? ""}
          hint="The number the hostel has for you. We send a code to it."
          error={requested.fieldErrors.phone?.[0]}
        />
        <Button type="submit" className="w-full" loading={requesting}>
          Send code
        </Button>
      </form>
    );
  }

  return (
    <form key={verified.id} action={verify} noValidate className="space-y-4">
      <input type="hidden" name="token" value={token} />
      <input type="hidden" name="phone" value={phone} />
      {requested.message && !verified.formError && <Alert tone="info">{requested.message}</Alert>}
      {verified.formError && <Alert tone="error">{verified.formError}</Alert>}
      <Input
        id="code"
        name="code"
        inputMode="numeric"
        autoComplete="one-time-code"
        pattern="[0-9]{6}"
        maxLength={6}
        label="6-digit code"
        required
        error={verified.fieldErrors.code?.[0]}
      />
      <Button type="submit" className="w-full" loading={verifying}>
        Continue
      </Button>
      <button
        type="button"
        onClick={() => setChanging(true)}
        className="w-full text-sm font-medium text-brand-700 underline"
      >
        Use a different number, or send the code again
      </button>
    </form>
  );
}

/** Step 3: what is wrong, and optional photos (E15-T3, T5). */
export function ResidentComplaintForm({
  token,
  categories,
}: {
  token: string;
  categories: { id: string; name: string }[];
}) {
  const [state, action, pending] = useActionState(raiseResidentComplaint, initialFormState);
  return (
    <form key={state.id} action={action} noValidate className="space-y-4">
      <input type="hidden" name="token" value={token} />
      {state.formError && <Alert tone="error">{state.formError}</Alert>}
      <Select
        id="category_id"
        name="category_id"
        label="What is it about?"
        required
        placeholder="Choose one"
        options={categories.map((c) => ({ value: c.id, label: c.name }))}
        defaultValue={state.values?.category_id ?? ""}
        error={state.fieldErrors.category_id?.[0]}
      />
      <Textarea
        id="description"
        name="description"
        label="What is wrong?"
        required
        rows={4}
        maxLength={1000}
        defaultValue={state.values?.description ?? ""}
        hint="For example: the bathroom tap leaks all the time."
        error={state.fieldErrors.description?.[0]}
      />
      <Input
        id="photos"
        name="photos"
        type="file"
        multiple
        accept="image/jpeg,image/png,image/webp"
        capture="environment"
        label="Photos (optional)"
        hint="Up to 5. A photo helps the person fixing it bring the right things."
        onChange={(event) => void shrinkInputFiles(event.currentTarget)}
        error={state.fieldErrors.photos?.[0]}
      />
      <Button type="submit" className="w-full" loading={pending}>
        Report the problem
      </Button>
      <button
        type="button"
        onClick={() => void endResidentSession().then(() => window.location.reload())}
        className="w-full text-sm font-medium text-slate-600 underline"
      >
        Not you? Sign out
      </button>
    </form>
  );
}

/** On the status page: is it fixed? (E15-T4) */
export function RespondToFix({ token, complaintId }: { token: string; complaintId: string }) {
  const [state, action, pending] = useActionState(respondToFix, initialFormState);
  const [answer, setAnswer] = useState<"yes" | "no" | null>(null);

  if (state.status === "success") {
    return (
      <p role="status" className="text-sm text-emerald-700">
        {state.message}
      </p>
    );
  }
  if (!answer) {
    return (
      <div className="flex flex-wrap gap-2">
        <Button size="sm" onClick={() => setAnswer("yes")}>
          Yes, it is fixed
        </Button>
        <Button size="sm" variant="secondary" onClick={() => setAnswer("no")}>
          No, still a problem
        </Button>
      </div>
    );
  }
  return (
    <form key={state.id} action={action} noValidate className="space-y-3">
      <input type="hidden" name="token" value={token} />
      <input type="hidden" name="complaint_id" value={complaintId} />
      <input type="hidden" name="fixed" value={answer} />
      {state.formError && <Alert tone="error">{state.formError}</Alert>}
      {answer === "yes" && (
        <fieldset>
          <legend className="text-sm font-medium text-slate-800">
            How was it handled? (optional)
          </legend>
          <div className="mt-1 flex gap-3">
            {[1, 2, 3, 4, 5].map((value) => (
              <label key={value} className="flex items-center gap-1 text-sm">
                <input type="radio" name="rating" value={value} className="accent-brand-600" />
                {value}
              </label>
            ))}
          </div>
          <p className="text-xs text-slate-500">1 is poor, 5 is excellent.</p>
        </fieldset>
      )}
      <Textarea
        id={`comment-${complaintId}`}
        name="comment"
        label={answer === "yes" ? "Anything to add? (optional)" : "What is still wrong?"}
        required={answer === "no"}
        rows={2}
        maxLength={500}
        defaultValue={state.values?.comment ?? ""}
        error={state.fieldErrors.comment?.[0]}
      />
      <div className="flex gap-2">
        <Button type="submit" size="sm" loading={pending}>
          {answer === "yes" ? "Close the complaint" : "Reopen it"}
        </Button>
        <Button size="sm" variant="secondary" onClick={() => setAnswer(null)}>
          Back
        </Button>
      </div>
    </form>
  );
}
