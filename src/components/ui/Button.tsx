import type { ButtonHTMLAttributes } from "react";

import { cn } from "@/lib/cn";

import { Spinner } from "./Spinner";
import { focusRing } from "./styles";

const variants = {
  primary: "bg-brand-600 text-white hover:bg-brand-700 disabled:bg-brand-300",
  secondary:
    "border border-slate-300 bg-white text-slate-800 hover:bg-slate-50 disabled:text-slate-400",
  danger: "bg-red-600 text-white hover:bg-red-700 disabled:bg-red-300",
  ghost: "text-slate-700 hover:bg-slate-100 disabled:text-slate-400",
} as const;

const sizes = {
  sm: "h-8 px-3 text-sm gap-1.5",
  md: "h-10 px-4 text-sm gap-2",
} as const;

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: keyof typeof variants;
  size?: keyof typeof sizes;
  /** Shows a spinner and disables the button, e.g. while a form submits. */
  loading?: boolean;
}

export function Button({
  variant = "primary",
  size = "md",
  loading = false,
  disabled,
  type = "button",
  className,
  children,
  ...props
}: ButtonProps) {
  return (
    <button
      type={type}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      className={cn(
        "inline-flex items-center justify-center rounded-md font-medium transition-colors disabled:cursor-not-allowed",
        focusRing,
        variants[variant],
        sizes[size],
        className,
      )}
      {...props}
    >
      {loading && <Spinner className="size-4" />}
      {children}
    </button>
  );
}
