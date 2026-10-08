import type { ReactNode, TextareaHTMLAttributes } from "react";

import { cn } from "@/lib/cn";

import { describedBy, Field } from "./Field";
import { fieldBase, fieldBorder } from "./styles";

export interface TextareaProps extends TextareaHTMLAttributes<HTMLTextAreaElement> {
  id: string;
  label: string;
  hint?: ReactNode;
  error?: string;
}

export function Textarea({ id, label, hint, error, required, className, ...props }: TextareaProps) {
  return (
    <Field id={id} label={label} required={required} hint={hint} error={error}>
      <textarea
        id={id}
        name={props.name ?? id}
        required={required}
        rows={props.rows ?? 3}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy(id, hint, error)}
        className={cn(fieldBase, fieldBorder(Boolean(error)), className)}
        {...props}
      />
    </Field>
  );
}
