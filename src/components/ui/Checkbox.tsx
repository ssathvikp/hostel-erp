import type { InputHTMLAttributes, ReactNode } from "react";

import { cn } from "@/lib/cn";

import { describedBy, fieldIds } from "./Field";
import { focusRing } from "./styles";

export interface CheckboxProps extends Omit<InputHTMLAttributes<HTMLInputElement>, "type"> {
  id: string;
  label: ReactNode;
  hint?: ReactNode;
  error?: string;
}

export function Checkbox({ id, label, hint, error, className, ...props }: CheckboxProps) {
  const ids = fieldIds(id);
  return (
    <div className="flex items-start gap-2.5">
      <input
        id={id}
        name={props.name ?? id}
        type="checkbox"
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy(id, hint, error)}
        className={cn(
          "mt-0.5 size-4 shrink-0 rounded border-slate-300 accent-brand-600",
          focusRing,
          className,
        )}
        {...props}
      />
      <div className="text-sm">
        <label htmlFor={id} className="font-medium text-slate-800">
          {label}
        </label>
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
    </div>
  );
}
