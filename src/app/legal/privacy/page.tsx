import type { Metadata } from "next";

import { DraftNotice } from "@/components/shell/DraftNotice";
import { business, TERMS_VERSION } from "@/lib/legal";

export const metadata: Metadata = { title: "Privacy policy" };

/**
 * The privacy notice under the Digital Personal Data Protection Act, 2023.
 * Retention periods match docs/data-protection.md.
 */
export default function PrivacyPage() {
  return (
    <>
      <h1>Privacy policy</h1>
      <DraftNotice version={TERMS_VERSION} />
      <p>
        This policy explains what personal data {business.legalName} (&quot;Hostel ERP&quot;)
        handles, why, and the rights you have under the Digital Personal Data Protection Act, 2023
        (DPDP Act).
      </p>

      <h2>Two kinds of data</h2>
      <ul>
        <li>
          <strong>Your account data</strong> (owners and staff): name, email, phone, sign-in
          records, and for owners billing details and GSTIN. For this data we are the data
          fiduciary.
        </li>
        <li>
          <strong>Your residents&apos; data</strong>: names, phone numbers, guardians, addresses, ID
          proof type and last four characters, ID proof files, stays, fees and complaints. The
          hostel owner decides why and how this is collected and is its data fiduciary; we process
          it on the owner&apos;s behalf only to provide Hostel ERP.
        </li>
      </ul>

      <h2>What we do with it</h2>
      <ul>
        <li>Provide, secure and support the service, and send account and billing emails.</li>
        <li>Bill you and keep tax records as the law requires.</li>
        <li>
          We do not sell personal data, and we do not use residents&apos; data for our own purposes.
        </li>
      </ul>

      <h2>How it is protected</h2>
      <ul>
        <li>Each hostel&apos;s data is isolated from every other hostel at the database level.</li>
        <li>
          Full ID numbers are never stored: only the type, the last four characters and a keyed
          fingerprint used to spot duplicates.
        </li>
        <li>
          ID proof files and complaint photos are private and served through short-lived links.
        </li>
        <li>
          Our staff can see a hostel&apos;s data only through an audited, read-only support view;
          the owner can see every such visit and its reason.
        </li>
        <li>Card and UPI details are handled by our payment gateway, never by us.</li>
      </ul>

      <h2>Who else processes it</h2>
      <p>
        Our hosting and database provider (Supabase), our application host (Vercel), our payment
        gateway (Razorpay) and, once enabled, our email and SMS providers. Each processes data only
        to provide their part of the service.
      </p>

      <h2>How long we keep it</h2>
      <ul>
        <li>While your account is open, for as long as you keep it.</li>
        <li>
          When an owner erases a resident who has left, their personal details and ID proof are
          removed at once; amounts, dates and invoice numbers stay because tax law requires them.
        </li>
        <li>
          When you close your account, we delete your data after a 30-day notice period in which you
          can export it, except tax records we must keep for 8 years.
        </li>
      </ul>

      <h2>Your rights</h2>
      <p>
        You can access, correct and erase your personal data, withdraw consent, and nominate someone
        to act for you. Owners can export a hostel&apos;s data and erase residents from within the
        app. Residents should contact their hostel first, which can act through Hostel ERP; they may
        also contact us.
      </p>

      <h2>Grievances</h2>
      <p>
        {`Our grievance officer is ${business.grievanceOfficer}, reachable at ${business.grievanceEmail}.`}{" "}
        We respond within the time the DPDP Act and its rules require. If you are not satisfied, you
        may complain to the Data Protection Board of India.
      </p>
    </>
  );
}
