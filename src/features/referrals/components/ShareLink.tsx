"use client";

import { useState } from "react";

import { buttonClass, Button } from "@/components/ui";

/** The owner's referral link with copy and WhatsApp share buttons (plan E14-T12). */
export function ShareLink({ link }: { link: string }) {
  const [status, setStatus] = useState<string | null>(null);
  const message = `I manage my hostel with Hostel ERP: rooms, residents and rent in one place. Try it free: ${link}`;

  async function copy() {
    try {
      await navigator.clipboard.writeText(link);
      setStatus("Link copied.");
    } catch {
      setStatus("Copying is blocked in this browser. Select the link instead.");
    }
  }

  return (
    <div className="space-y-2">
      <p className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2 font-mono text-sm break-all text-slate-900">
        {link}
      </p>
      <div className="flex flex-wrap items-center gap-2">
        <Button variant="secondary" onClick={copy}>
          Copy link
        </Button>
        <a
          href={`https://wa.me/?text=${encodeURIComponent(message)}`}
          target="_blank"
          rel="noopener noreferrer"
          className={buttonClass({})}
        >
          Share on WhatsApp
        </a>
        <span role="status" className="text-sm text-slate-600 empty:hidden">
          {status}
        </span>
      </div>
    </div>
  );
}
