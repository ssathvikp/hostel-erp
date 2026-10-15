"use client";

import { useActionState, useState } from "react";

import { Alert, Button, Input, Modal } from "@/components/ui";
import { formatPaise } from "@/lib/money";
import { initialFormState } from "@/lib/validation/result";

import {
  connectGateway,
  createPaymentLink,
  disconnectGateway,
  setGatewayEnabled,
} from "../actions";

const day = new Intl.DateTimeFormat("en-IN", { dateStyle: "medium", timeZone: "Asia/Kolkata" });

/** Key id, key secret and webhook secret for the hostel's own Razorpay account. */
export function ConnectGatewayForm({ connected }: { connected: boolean }) {
  const [state, formAction, pending] = useActionState(connectGateway, initialFormState);
  return (
    <form key={state.id} action={formAction} noValidate className="max-w-lg space-y-4">
      {state.formError && <Alert tone="error">{state.formError}</Alert>}
      {state.status === "success" && <Alert tone="success">{state.message}</Alert>}
      <Input
        id="key_id"
        label="Key id"
        required
        autoComplete="off"
        defaultValue={state.values?.key_id ?? ""}
        hint="Razorpay dashboard → Account & Settings → API Keys. Starts with rzp_test_ or rzp_live_."
        error={state.fieldErrors.key_id?.[0]}
      />
      <Input
        id="key_secret"
        type="password"
        label="Key secret"
        required
        autoComplete="off"
        hint="Stored encrypted. Nobody, including you, can read it back here."
        error={state.fieldErrors.key_secret?.[0]}
      />
      <Input
        id="webhook_secret"
        type="password"
        label="Webhook secret"
        required
        autoComplete="off"
        hint="Choose a long random secret, and enter the same one when you add the webhook in Razorpay."
        error={state.fieldErrors.webhook_secret?.[0]}
      />
      <Button type="submit" loading={pending}>
        {connected ? "Replace keys" : "Connect Razorpay"}
      </Button>
    </form>
  );
}

export function GatewayToggle({ enabled }: { enabled: boolean }) {
  const [state, formAction, pending] = useActionState(setGatewayEnabled, initialFormState);
  return (
    <form action={formAction} className="flex flex-wrap items-center gap-3">
      <input type="hidden" name="enabled" value={enabled ? "false" : "true"} />
      <Button type="submit" variant="secondary" loading={pending}>
        {enabled ? "Turn off online payments" : "Turn on online payments"}
      </Button>
      {state.message && (
        <span role="status" className="text-sm text-emerald-700">
          {state.message}
        </span>
      )}
      {state.formError && (
        <span role="alert" className="text-sm text-red-700">
          {state.formError}
        </span>
      )}
    </form>
  );
}

export function DisconnectGateway() {
  const [open, setOpen] = useState(false);
  const [state, formAction, pending] = useActionState(() => disconnectGateway(), initialFormState);
  return (
    <>
      <Button variant="secondary" onClick={() => setOpen(true)}>
        Disconnect
      </Button>
      {state.message && (
        <p role="status" className="text-sm text-emerald-700">
          {state.message}
        </p>
      )}
      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title="Disconnect Razorpay"
        description="The keys are deleted. Payments on links you have already sent will still reach your Razorpay account, but Hostel ERP will no longer record them: record those by hand. To pause instead, turn online payments off."
        footer={
          <>
            <Button variant="secondary" onClick={() => setOpen(false)}>
              Keep connected
            </Button>
            <Button type="submit" form="disconnect-gateway" variant="danger" loading={pending}>
              Disconnect
            </Button>
          </>
        }
      >
        <form id="disconnect-gateway" action={formAction}>
          {state.formError && <Alert tone="error">{state.formError}</Alert>}
        </form>
      </Modal>
    </>
  );
}

/** Copies text, saying so for screen readers. */
function CopyButton({ text, label }: { text: string; label: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <Button
      size="sm"
      variant="secondary"
      onClick={async () => {
        await navigator.clipboard.writeText(text);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      }}
    >
      <span aria-live="polite">{copied ? "Copied" : label}</span>
    </Button>
  );
}

export interface PaymentLinkView {
  shortUrl: string;
  amount: number;
  expiresAt: string;
  qrSvg: string;
}

/**
 * The invoice's payment link (E13-T10): create or renew it, then copy it,
 * send it by WhatsApp, or let the resident scan the QR code.
 */
export function PaymentLinkPanel({
  invoiceId,
  balance,
  residentName,
  residentPhone,
  hostelName,
  link,
}: {
  invoiceId: string;
  balance: number;
  residentName: string;
  residentPhone: string | null;
  hostelName: string;
  link: PaymentLinkView | null;
}) {
  const [state, formAction, pending] = useActionState(createPaymentLink, initialFormState);
  const stale = link && link.amount !== balance;
  const message = link
    ? `Hello ${residentName}, please pay your rent of ${formatPaise(link.amount)} to ${hostelName} here: ${link.shortUrl}`
    : "";

  return (
    <section
      aria-labelledby="online-heading"
      className="space-y-3 rounded-lg border border-slate-200 bg-white p-4"
    >
      <h2 id="online-heading" className="text-base font-semibold text-slate-900">
        Pay online
      </h2>
      {state.formError && <Alert tone="error">{state.formError}</Alert>}
      {state.status === "success" && state.message && <Alert tone="success">{state.message}</Alert>}
      {link && !stale ? (
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start">
          <div
            className="size-40 shrink-0 rounded border border-slate-200 bg-white p-1 [&_svg]:size-full"
            // Inline SVG made on the server by the qrcode library.
            dangerouslySetInnerHTML={{ __html: link.qrSvg }}
          />
          <div className="min-w-0 space-y-2 text-sm">
            <p className="text-slate-700">
              {formatPaise(link.amount)} by UPI, card or netbanking. Valid until{" "}
              {day.format(new Date(link.expiresAt))}.
            </p>
            <p className="font-mono text-xs break-all text-slate-900">{link.shortUrl}</p>
            <div className="flex flex-wrap gap-2">
              <CopyButton text={link.shortUrl} label="Copy link" />
              {residentPhone && (
                <a
                  href={`https://wa.me/91${residentPhone}?text=${encodeURIComponent(message)}`}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex h-8 items-center rounded-md border border-slate-300 px-3 text-sm font-medium text-slate-700 hover:bg-slate-50"
                >
                  Send on WhatsApp
                </a>
              )}
            </div>
            <p className="text-xs text-slate-500">
              The payment is recorded here automatically once the gateway confirms it.
            </p>
          </div>
        </div>
      ) : (
        <form action={formAction} className="space-y-2">
          <input type="hidden" name="invoice_id" value={invoiceId} />
          {stale && (
            <p className="text-sm text-slate-700">
              The balance changed since the last link was made. A new link replaces it.
            </p>
          )}
          <Button type="submit" loading={pending}>
            {stale ? "Make a new link" : "Make a payment link"} for {formatPaise(balance)}
          </Button>
        </form>
      )}
    </section>
  );
}
