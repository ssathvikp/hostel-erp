import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Payment received",
  robots: { index: false, follow: false },
  referrer: "no-referrer",
};

/**
 * Where the gateway sends a resident after paying a rent link (E13-T10).
 * It shows nothing about the payment: the gateway's signed webhook, not this
 * page, is what records it.
 */
export default function PaymentThanksPage() {
  return (
    <main className="mx-auto flex min-h-dvh max-w-md items-center px-4">
      <div className="w-full rounded-lg border border-slate-200 bg-white p-6 text-center shadow-sm">
        <h1 className="text-lg font-semibold text-slate-900">Thank you</h1>
        <p className="mt-2 text-sm text-slate-600">
          If your payment went through, the payment gateway has sent you a confirmation. Your hostel
          will see it shortly and can give you a receipt. You can close this page.
        </p>
      </div>
    </main>
  );
}
