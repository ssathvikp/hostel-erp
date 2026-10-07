import type { ReactNode, SelectHTMLAttributes } from "react";

import { cn } from "@/lib/cn";

import { describedBy, Field } from "./Field";
import { fieldBase, fieldBorder } from "./styles";

export interface SelectOption {
  value: string;
  label: string;
  disabled?: boolean;
}

export interface SelectProps extends SelectHTMLAttributes<HTMLSelectElement> {
  id: string;
  label: string;
  options: readonly SelectOption[];
  /** Adds an empty first option, e.g. "Choose a sharing type". */
  placeholder?: string;
  hint?: ReactNode;
  error?: string;
}

export function Select({
  id,
  label,
  options,
  placeholder,
  hint,
  error,
  required,
  className,
  ...props
}: SelectProps) {
  return (
    <Field id={id} label={label} required={required} hint={hint} error={error}>
      <select
        id={id}
        name={props.name ?? id}
        required={required}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy(id, hint, error)}
        className={cn(fieldBase, fieldBorder(Boolean(error)), "pr-8", className)}
        {...props}
      >
        {placeholder !== undefined && <option value="">{placeholder}</option>}
        {options.map((option) => (
          <option key={option.value} value={option.value} disabled={option.disabled}>
            {option.label}
          </option>
        ))}
      </select>
    </Field>
  );
}
