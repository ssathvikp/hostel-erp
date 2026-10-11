"use client";

import { Button } from "@/components/ui";

/** Opens the browser's print dialog; hidden on the printed page itself. */
export function PrintButton({ label = "Print" }: { label?: string }) {
  return (
    <Button className="print:hidden" onClick={() => window.print()}>
      {label}
    </Button>
  );
}
