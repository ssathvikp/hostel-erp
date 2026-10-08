import type { HTMLAttributes, TdHTMLAttributes, ThHTMLAttributes } from "react";

import { cn } from "@/lib/cn";

interface TableProps extends HTMLAttributes<HTMLTableElement> {
  /** Visually hidden caption describing the table for screen readers. */
  caption?: string;
}

/**
 * Data table. The wrapper scrolls horizontally on narrow screens so wide
 * tables never break the page layout at 375px.
 */
export function Table({ caption, className, children, ...props }: TableProps) {
  return (
    <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
      <table className={cn("min-w-full divide-y divide-slate-200 text-sm", className)} {...props}>
        {caption && <caption className="sr-only">{caption}</caption>}
        {children}
      </table>
    </div>
  );
}

export function THead({ className, ...props }: HTMLAttributes<HTMLTableSectionElement>) {
  return <thead className={cn("bg-slate-50", className)} {...props} />;
}

export function TBody({ className, ...props }: HTMLAttributes<HTMLTableSectionElement>) {
  return <tbody className={cn("divide-y divide-slate-100", className)} {...props} />;
}

export function Tr({ className, ...props }: HTMLAttributes<HTMLTableRowElement>) {
  return <tr className={cn("hover:bg-slate-50", className)} {...props} />;
}

export function Th({ className, scope = "col", ...props }: ThHTMLAttributes<HTMLTableCellElement>) {
  return (
    <th
      scope={scope}
      className={cn(
        "px-4 py-2.5 text-left text-xs font-semibold tracking-wide whitespace-nowrap text-slate-600 uppercase",
        className,
      )}
      {...props}
    />
  );
}

export function Td({ className, ...props }: TdHTMLAttributes<HTMLTableCellElement>) {
  return <td className={cn("px-4 py-3 whitespace-nowrap text-slate-800", className)} {...props} />;
}
