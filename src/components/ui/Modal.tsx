"use client";

import { useEffect, useId, useRef, type ReactNode } from "react";

import { cn } from "@/lib/cn";

import { focusRing } from "./styles";

export interface ModalProps {
  open: boolean;
  onClose: () => void;
  title: string;
  description?: ReactNode;
  /** Action buttons, rendered right-aligned in the footer. */
  footer?: ReactNode;
  children?: ReactNode;
}

/**
 * Accessible modal built on the native <dialog> element, which provides the
 * focus trap, Escape-to-close and inert background for free.
 */
export function Modal({ open, onClose, title, description, footer, children }: ModalProps) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const descriptionId = useId();

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);

  return (
    <dialog
      ref={ref}
      aria-labelledby={titleId}
      aria-describedby={description ? descriptionId : undefined}
      onClose={onClose}
      onClick={(event) => {
        // A click on the backdrop targets the dialog element itself.
        if (event.target === event.currentTarget) onClose();
      }}
      className="m-auto w-[calc(100%-2rem)] max-w-lg rounded-lg bg-white p-0 text-slate-900 shadow-xl backdrop:bg-slate-900/50"
    >
      <div className="p-5 sm:p-6">
        <div className="flex items-start justify-between gap-4">
          <h2 id={titleId} className="text-lg font-semibold">
            {title}
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className={cn("-m-1 rounded p-1 text-slate-500 hover:text-slate-800", focusRing)}
          >
            <svg aria-hidden="true" viewBox="0 0 20 20" className="size-5" fill="currentColor">
              <path d="M6.28 5.22a.75.75 0 0 0-1.06 1.06L8.94 10l-3.72 3.72a.75.75 0 1 0 1.06 1.06L10 11.06l3.72 3.72a.75.75 0 1 0 1.06-1.06L11.06 10l3.72-3.72a.75.75 0 0 0-1.06-1.06L10 8.94 6.28 5.22Z" />
            </svg>
          </button>
        </div>
        {description && (
          <p id={descriptionId} className="mt-1 text-sm text-slate-600">
            {description}
          </p>
        )}
        {children && <div className="mt-4">{children}</div>}
      </div>
      {footer && (
        <div className="flex flex-col-reverse gap-2 rounded-b-lg border-t border-slate-200 bg-slate-50 px-5 py-3 sm:flex-row sm:justify-end sm:px-6">
          {footer}
        </div>
      )}
    </dialog>
  );
}
