import type { Metadata } from "next";

import { DraftNotice } from "@/components/shell/DraftNotice";
import { business, TERMS_VERSION } from "@/lib/legal";

export const metadata: Metadata = { title: "Refunds and cancellation" };

export default function RefundsPage() {
  return (
    <>
      <h1>Refunds and cancellation</h1>
      <DraftNotice version={TERMS_VERSION} />

      <h2>Cancelling</h2>
      <ul>
        <li>Cancel any time from Settings → Billing. No notice period or fee applies.</li>
        <li>
          Your plan keeps working until the end of the month or year you have paid for. After that
          your account becomes read-only; nothing is deleted, and you can choose a plan again at any
          time.
        </li>
        <li>To delete your data as well, request account closure under Settings → Hostel.</li>
      </ul>

      <h2>Refunds</h2>
      <ul>
        <li>
          The free trial lets you try everything before paying, so we do not refund partly used
          periods.
        </li>
        <li>
          If you were charged by mistake (for example twice for the same period, or after you
          cancelled), we refund the full amount to the original payment method within 7 working days
          of confirming it. Your bank may take a few more days to show it.
        </li>
        <li>Every refund comes with a GST credit note under Settings → Billing.</li>
      </ul>

      <h2>Downgrades and upgrades</h2>
      <p>
        An upgrade starts at once and you pay the difference for the rest of the period. A downgrade
        starts at your next renewal; we do not refund the difference for the current period.
      </p>

      <h2>Questions</h2>
      <p>
        Write to {business.supportEmail} or call {business.supportPhone}.
      </p>
    </>
  );
}
