import type { z } from "zod";

/** Field path (dot-joined, e.g. `address.city`) to its error messages. */
export type FieldErrors = Record<string, string[]>;

/**
 * The shape every server action returns. Actions never throw validation or
 * expected business errors at the client; they return `ok: false` instead.
 */
export type ActionResult<T = void> =
  { ok: true; data: T } | { ok: false; formError?: string; fieldErrors: FieldErrors };

/** Fallback key for issues that are not attached to a specific field. */
export const FORM_ERROR_KEY = "_form";

/** Converts a Zod failure into field-level error messages. */
export function toFieldErrors(error: z.ZodError): FieldErrors {
  const fieldErrors: FieldErrors = {};
  for (const issue of error.issues) {
    const key = issue.path.length > 0 ? issue.path.join(".") : FORM_ERROR_KEY;
    (fieldErrors[key] ??= []).push(issue.message);
  }
  return fieldErrors;
}

/** Validates `input` and returns either the parsed data or field errors. */
export function validate<S extends z.ZodType>(
  schema: S,
  input: unknown,
): ActionResult<z.output<S>> {
  const parsed = schema.safeParse(input);
  if (parsed.success) {
    return { ok: true, data: parsed.data };
  }
  return { ok: false, fieldErrors: toFieldErrors(parsed.error) };
}

/**
 * Validates a submitted form. Repeated keys (multi-selects, checkbox groups)
 * become arrays; single keys stay strings.
 */
export function validateFormData<S extends z.ZodType>(
  schema: S,
  formData: FormData,
): ActionResult<z.output<S>> {
  const input: Record<string, FormDataEntryValue | FormDataEntryValue[]> = {};
  for (const key of new Set(formData.keys())) {
    const values = formData.getAll(key);
    input[key] = values.length === 1 ? values[0] : values;
  }
  return validate(schema, input);
}

/**
 * State for forms driven by `useActionState`. `values` echoes back what the
 * user typed (never passwords) so a failed submit does not clear the form.
 *
 * `id` is new on every server response. Forms use it as their React `key`,
 * so fields remount with the echoed values: React's automatic form reset
 * restores text inputs but not the selected option of a <select>.
 */
export interface FormState {
  id: string;
  status: "idle" | "error" | "success";
  formError?: string;
  fieldErrors: FieldErrors;
  message?: string;
  /** Something the user should act on even though the action succeeded. */
  warning?: string;
  values?: Record<string, string>;
}

export const initialFormState: FormState = { id: "initial", status: "idle", fieldErrors: {} };

export function formFailure(
  formError?: string,
  values?: Record<string, string>,
  fieldErrors: FieldErrors = {},
): FormState {
  return { id: crypto.randomUUID(), status: "error", formError, fieldErrors, values };
}

export function formSuccess(message?: string, warning?: string): FormState {
  return { id: crypto.randomUUID(), status: "success", fieldErrors: {}, message, warning };
}

/** Reads the named text fields from a submission, for echoing back. */
export function formValues(formData: FormData, names: readonly string[]): Record<string, string> {
  return Object.fromEntries(
    names.map((name) => {
      const value = formData.get(name);
      return [name, typeof value === "string" ? value : ""];
    }),
  );
}
