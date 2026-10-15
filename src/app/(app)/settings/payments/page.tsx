import type { Metadata } from "next";
import Link from "next/link";

import { PageHeader } from "@/components/shell/PageHeader";
import { Alert, Badge } from "@/components/ui";
import {
  ConnectGatewayForm,
  DisconnectGateway,
  GatewayToggle,
} from "@/features/online-payments/components/OnlinePaymentForms";
import { getGatewayAccount } from "@/features/online-payments/queries";
import { requireActiveHostel } from "@/lib/hostels/active";
import { canStoreGatewayKeys, siteUrl } from "@/lib/payments/config";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Online payments" };

const day = new Intl.DateTimeFormat("en-IN", { dateStyle: "medium", timeZone: "Asia/Kolkata" });

const EVENTS = ["payment_link.paid", "payment.failed", "refund.processed", "settlement.processed"];

/**
 * The hostel's own Razorpay account for rent (E13-T10). Rent goes straight
 * to the owner's account; Hostel ERP only records it.
 */
export default async function OnlinePaymentsPage() {
  const { user, hostel } = await requireActiveHostel();
  const supabase = await createClient();
  const account = await getGatewayAccount(supabase, hostel.id);
  const isOwner = user.role === "owner";
  const webhookUrl = account ? `${siteUrl()}/api/webhooks/payments/${account.webhookToken}` : null;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Online payments"
        description={`Residents of ${hostel.name} pay rent by UPI, card or netbanking from a link, into your own Razorpay account.`}
      />

      {account ? (
        <section className="space-y-3 rounded-lg border border-slate-200 bg-white p-4 text-sm">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-medium text-slate-900">Razorpay</span>
            <Badge tone={account.enabled ? "success" : "neutral"}>
              {account.enabled ? "On" : "Off"}
            </Badge>
            <Badge tone={account.mode === "live" ? "info" : "warning"}>
              {account.mode === "live" ? "Live" : "Test mode"}
            </Badge>
          </div>
          <p className="text-slate-700">
            Key <span className="font-mono">{account.keyId}</span>, connected{" "}
            {day.format(new Date(account.connectedAt))}.
          </p>
          {isOwner && webhookUrl && (
            <div className="space-y-2 rounded-md bg-slate-50 p-3">
              <p className="font-medium text-slate-900">Add this webhook in Razorpay</p>
              <p className="text-slate-700">
                Dashboard → Account &amp; Settings → Webhooks → Add new webhook. Use the same secret
                you entered here, and tick these events:
              </p>
              <p className="font-mono text-xs break-all text-slate-900">{webhookUrl}</p>
              <ul className="list-disc pl-5 font-mono text-xs text-slate-700">
                {EVENTS.map((event) => (
                  <li key={event}>{event}</li>
                ))}
              </ul>
            </div>
          )}
          {isOwner && (
            <div className="flex flex-wrap items-start gap-3">
              <GatewayToggle enabled={account.enabled} />
              <DisconnectGateway />
            </div>
          )}
          <Link href="/fees/online" className="font-medium text-brand-700 hover:underline">
            See online payments and settlements →
          </Link>
        </section>
      ) : (
        <Alert tone="info">
          Online payments are not connected.{" "}
          {isOwner ? "Connect your Razorpay account below." : "Only the owner can connect them."}
        </Alert>
      )}

      {isOwner && (
        <section aria-labelledby="connect-heading" className="space-y-3">
          <h2 id="connect-heading" className="text-base font-semibold text-slate-900">
            {account ? "Replace keys" : "Connect Razorpay"}
          </h2>
          {!canStoreGatewayKeys() && (
            <Alert tone="warning">
              The server&apos;s encryption key (PAYMENT_KEYS_ENCRYPTION_KEY) is not set, so keys
              cannot be stored yet.
            </Alert>
          )}
          <p className="max-w-2xl text-sm text-slate-600">
            You need a Razorpay account in your business&apos;s name with KYC completed. Start with
            test keys to try it, then replace them with live keys. Razorpay&apos;s fee is deducted
            from each payment before it reaches your bank.
          </p>
          <ConnectGatewayForm connected={Boolean(account)} />
        </section>
      )}
    </div>
  );
}
