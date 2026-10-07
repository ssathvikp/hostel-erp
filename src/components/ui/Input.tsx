import type { InputHTMLAttributes, ReactNode } from "react";

import { cn } from "@/lib/cn";

import { describedBy, Field } from "./Field";
import { fieldBase, fieldBorder } from "./styles";

export interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  id: string;
  label: string;
  hint?: ReactNode;
  error?: string;
}

export function Input({ id, label, hint, error, required, className, ...props }: InputProps) {
  return (
    <Field id={id} label={label} required={required} hint={hint} error={error}>
      <input
        id={id}
        name={props.name ?? id}
        required={required}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy(id, hint, error)}
        className={cn(fieldBase, fieldBorder(Boolean(error)), className)}
        {...props}
      />
    </Field>
  );
}
