"use client";

import { useState, useTransition } from "react";

import { buttonClass, Button } from "@/components/ui";

import { logReminderSend, type ReminderSend } from "../actions";

/**
 * Opens WhatsApp with the message ready, or copies it, and records the
 * send (EP-11). The person still presses send in WhatsApp; nothing goes out
 * on its own. Logging never blocks the send.
 */
export function SendButtons({
  link,
  message,
  send,
  subject,
  label = "WhatsApp",
}: {
  link: string;
  message: string;
  send: Omit<ReminderSend, "channel">;
  /** Who it is for, for accessible names, e.g. "reminder to Ravi". */
  subject: string;
  label?: string;
}) {
  const [, startTransition] = useTransition();
  const [status, setStatus] = useState<string | null>(null);

  function record(channel: ReminderSend["channel"], done: string) {
    startTransition(async () => {
      const result = await logReminderSend({ ...send, channel });
      setStatus(result.ok ? done : "Sent, but it could not be recorded. Refresh to check.");
    });
  }

  async function copy() {
    try {
      await navigator.clipboard.writeText(message);
      record("copy", "Message copied and recorded.");
    } catch {
      setStatus("Copying is blocked in this browser. Select the message text instead.");
    }
  }

  return (
    <div className="flex flex-wrap items-center justify-end gap-2">
      <a
        href={link}
        target="_blank"
        rel="noopener noreferrer"
        onClick={() => record("whatsapp", "WhatsApp opened and the reminder recorded.")}
        className={buttonClass({ size: "sm" })}
        aria-label={`Send ${subject} on WhatsApp`}
      >
        {label}
      </a>
      <Button size="sm" variant="secondary" onClick={copy} aria-label={`Copy ${subject}`}>
        Copy
      </Button>
      <span role="status" className="basis-full text-right text-xs text-slate-500 empty:hidden">
        {status}
      </span>
    </div>
  );
}
