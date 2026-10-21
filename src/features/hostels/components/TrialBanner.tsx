import Link from "next/link";

import { Alert } from "@/components/ui";
import { daysBetween } from "@/lib/money";

/** How close to the end of the free trial the owner is warned. */
export const TRIAL_WARNING_DAYS = 14;

const day = new Intl.DateTimeFormat("en-IN", { dateStyle: "medium", timeZone: "UTC" });

/**
 * Tells an owner their free trial is ending (EP-10, EP-14 T3). When it ends
 * the account becomes read-only, and the read-only banner takes over.
 */
export function TrialBanner({ trialEndsAt, today }: { trialEndsAt: string; today: string }) {
  const left = daysBetween(today, trialEndsAt);
  if (left > TRIAL_WARNING_DAYS) return null;
  const date = day.format(new Date(trialEndsAt));

  return (
    <Alert
      tone={left < 0 ? "warning" : "info"}
      title={
        left < 0
          ? `Your free trial ended on ${date}`
          : left === 0
            ? "Your free trial ends today"
            : `Your free trial ends in ${left} ${left === 1 ? "day" : "days"}`
      }
      // Never on a printed invoice or receipt.
      className="mb-6 print:hidden"
    >
      <Link href="/settings/billing" className="font-medium underline">
        Choose a plan
      </Link>{" "}
      to keep everything as it is. When the trial ends the account becomes read-only; nothing is
      deleted.
    </Alert>
  );
}
