import type { Metadata } from "next";
import Link from "next/link";

import { DraftNotice } from "@/components/shell/DraftNotice";
import { business, TERMS_VERSION } from "@/lib/legal";

export const metadata: Metadata = { title: "Terms of service" };

export default function TermsPage() {
  return (
    <>
      <h1>Terms of service</h1>
      <DraftNotice version={TERMS_VERSION} />
      <p>
        These terms are an agreement between you (the hostel or PG owner who creates an account) and{" "}
        {business.legalName}, {business.address} (&quot;we&quot;, &quot;Hostel ERP&quot;). By
        creating an account you accept them.
      </p>

      <h2>1. The service</h2>
      <p>
        Hostel ERP is web software for running hostels and paying-guest accommodation: rooms and
        beds, residents, allocations, fees and payments, complaints and reports. We provide it as a
        hosted service; you do not install anything.
      </p>

      <h2>2. Your account</h2>
      <ul>
        <li>You must be at least 18 and able to enter a contract under Indian law.</li>
        <li>
          Keep your password secret. You are responsible for what happens under your account and for
          the staff accounts you ask us to create.
        </li>
        <li>Give us accurate details, including your business details for tax invoices.</li>
      </ul>

      <h2>3. Free trial, plans and payment</h2>
      <ul>
        <li>
          New accounts get a free trial with full features. No payment details are needed for the
          trial.
        </li>
        <li>
          After the trial you choose a paid plan. Prices are shown excluding GST, which is added at
          the applicable rate. Plans renew automatically each month or year until cancelled.
        </li>
        <li>
          Payments are collected by our payment gateway (Razorpay) through card or UPI AutoPay
          mandates, under the Reserve Bank of India&apos;s e-mandate rules. We never see or store
          your card or UPI details.
        </li>
        <li>
          Each plan has limits (beds, hostels, staff accounts). We may change prices for future
          renewals with at least 30 days&apos; notice; a change never affects a period you have
          already paid for.
        </li>
        <li>We issue a GST tax invoice for every payment.</li>
      </ul>

      <h2>4. Unpaid accounts</h2>
      <p>
        If a payment fails we retry and tell you. After a grace period your account becomes
        read-only: you and your staff can still see, print and export all of your data, but cannot
        add or change it. Paying restores full access immediately. We do not delete your data
        because a payment failed.
      </p>

      <h2>5. Your data</h2>
      <p>
        You own the data you put into Hostel ERP. You are the data fiduciary for your
        residents&apos; personal data under the Digital Personal Data Protection Act, 2023; we
        process it only to provide the service, as set out in our{" "}
        <Link href="/legal/privacy" className="text-brand-700 underline">
          privacy policy
        </Link>
        . You must have a lawful basis, such as your residents&apos; consent, for the data you
        record. You can export your data at any time and ask us to close your account.
      </p>

      <h2>6. Acceptable use</h2>
      <ul>
        <li>
          Do not use the service for anything unlawful, or to store data you have no right to hold.
        </li>
        <li>
          Do not try to reach other customers&apos; data, test our security without permission, or
          overload the service.
        </li>
        <li>
          We may suspend an account that breaks these rules, after telling you why where the law
          allows.
        </li>
      </ul>

      <h2>7. Availability and support</h2>
      <p>
        We work to keep the service available and your data safe, but we do not promise it will
        never be interrupted. Contact support at {business.supportEmail}.
      </p>

      <h2>8. Liability</h2>
      <p>
        To the extent the law allows, our total liability to you in any 12 months is limited to the
        fees you paid us in that period, and we are not liable for indirect or consequential loss.
        Nothing in these terms limits liability that cannot be limited by law.
      </p>

      <h2>9. Cancellation</h2>
      <p>
        You can cancel at any time from Settings → Billing; your plan runs to the end of the period
        you paid for. See{" "}
        <Link href="/legal/refunds" className="text-brand-700 underline">
          refunds and cancellation
        </Link>
        .
      </p>

      <h2>10. Changes and law</h2>
      <p>
        We may update these terms; we will tell you about material changes before they apply. These
        terms are governed by the laws of India, and the courts at {business.jurisdiction} have
        jurisdiction.
      </p>
    </>
  );
}
