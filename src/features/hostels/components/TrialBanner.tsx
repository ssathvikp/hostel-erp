import { Alert } from "@/components/ui";
import { daysBetween } from "@/lib/money";

/** How close to the end of the free trial the owner is warned. */
export const TRIAL_WARNING_DAYS = 14;

const day = new Intl.DateTimeFormat("en-IN", { dateStyle: "medium", timeZone: "UTC" });

/**
 * Tells an owner their free trial is ending or has ended (EP-10). Nothing
 * is locked when it ends; the platform admin decides what happens next.
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
      className="mb-6"
    >
      Contact Hostel ERP support to choose a plan and keep everything as it is.
    </Alert>
  );
}
