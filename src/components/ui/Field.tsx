import type { ReactNode } from "react";

/** Ids that link a control to its hint and error text for screen readers. */
export function fieldIds(id: string) {
  return { hint: `${id}-hint`, error: `${id}-error` };
}

export function describedBy(id: string, hint?: ReactNode, error?: string) {
  const ids = fieldIds(id);
  // Mirrors Field: the hint is hidden while an error is shown.
  if (error) return ids.error;
  return hint ? ids.hint : undefined;
}

interface FieldProps {
  id: string;
  label: string;
  required?: boolean;
  hint?: ReactNode;
  error?: string;
  children: ReactNode;
}

/** Label, control, hint and error message laid out consistently. */
export function Field({ id, label, required, hint, error, children }: FieldProps) {
  const ids = fieldIds(id);
  return (
    <div className="space-y-1.5">
      <label htmlFor={id} className="block text-sm font-medium text-slate-800">
        {label}
        {required && (
          <span aria-hidden="true" className="ml-0.5 text-red-600">
            *
          </span>
        )}
      </label>
      {children}
      {hint && !error && (
        <p id={ids.hint} className="text-xs text-slate-500">
          {hint}
        </p>
      )}
      {error && (
        <p id={ids.error} className="text-xs text-red-600">
          {error}
        </p>
      )}
    </div>
  );
}
