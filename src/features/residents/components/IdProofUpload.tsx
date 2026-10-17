"use client";

import { useActionState } from "react";

import { HostelField } from "@/components/shell/ActiveHostel";
import { Alert, Button, Input } from "@/components/ui";
import { initialFormState } from "@/lib/validation/result";

import { uploadIdProof } from "../actions";
import { ID_PROOF_MIME_TYPES } from "../options";

/**
 * Uploads a copy of the resident's ID proof to private storage (E5-T7). The
 * server re-checks the size and the real file type from its contents.
 */
export function IdProofUpload({ residentId, hasFile }: { residentId: string; hasFile: boolean }) {
  const [state, action, pending] = useActionState(uploadIdProof, initialFormState);

  return (
    <form key={state.id} action={action} noValidate className="space-y-3">
      <HostelField />
      {state.formError && <Alert tone="error">{state.formError}</Alert>}
      {state.status === "success" && <Alert tone="success">{state.message}</Alert>}
      <input type="hidden" name="resident_id" value={residentId} />
      <Input
        id="file"
        label={hasFile ? "Replace ID proof copy" : "Upload ID proof copy"}
        type="file"
        accept={ID_PROOF_MIME_TYPES.join(",")}
        hint="PDF, JPG or PNG, up to 5 MB. For Aadhaar, upload a masked copy with the first 8 digits hidden."
        error={state.fieldErrors.file?.[0]}
        className="file:mr-3 file:rounded file:border-0 file:bg-slate-100 file:px-3 file:py-1 file:text-sm"
      />
      <Button type="submit" variant="secondary" size="sm" loading={pending}>
        Upload
      </Button>
    </form>
  );
}
