import Link from "next/link";

import type { AccountState } from "@/features/billing/queries";
import { daysUntil } from "@/lib/billing/pricing";
import { cn } from "@/lib/cn";

import { focusRing } from "../ui";

const day = new Intl.DateTimeFormat("en-IN", { dateStyle: "medium", timeZone: "Asia/Kolkata" });

/**
 * The account's billing state, shown above every app page (E14-T3, T9):
 * days left in the trial, a failed payment, or why the account is
 * read-only and how to restore it. Owners get the link to billing; staff
 * are told to ask the owner. Nothing shows for a paid, healthy account.
 */
export function AccountBanner({
  state,
  isOwner,
}: {
  state: AccountState | null;
  isOwner: boolean;
}) {
  if (!state) return null;

  let tone: "info" | "warning" | "critical";
  let message: string;
  if (!state.can_write) {
    tone = "critical";
    message =
      state.status === "trialing" || state.status === "read_only"
        ? "The free trial has ended, so this account is read-only. Nothing has been deleted: you can still view, print and export everything."
        : "This account is read-only because its subscription is not paid. Nothing has been deleted: you can still view, print and export everything.";
  } else if (state.status === "trialing" && state.trial_ends_at) {
    const left = daysUntil(state.trial_ends_at);
    tone = left <= 3 ? "warning" : "info";
    message = `Free trial: ${left} ${left === 1 ? "day" : "days"} left (ends ${day.format(new Date(state.trial_ends_at))}).`;
  } else if (state.status === "past_due") {
    tone = "warning";
    message = `The last subscription payment did not go through. Full access continues until ${state.grace_ends_at ? day.format(new Date(state.grace_ends_at)) : "the grace period ends"}.`;
  } else if (state.cancel_at_period_end && state.current_period_end && !state.complimentary) {
    tone = "info";
    message = `The plan is cancelled and ends on ${day.format(new Date(state.current_period_end))}; the account then becomes read-only.`;
  } else {
    return null;
  }

  const styles = {
    info: "border-brand-100 bg-brand-50 text-slate-800",
    warning: "border-amber-200 bg-amber-50 text-amber-900",
    critical: "border-red-200 bg-red-50 text-red-800",
  }[tone];

  return (
    // A labelled region, not a live one: it is part of every page, so
    // announcing it on each navigation would only be noise.
    <section
      aria-label="Billing notice"
      className={cn(
        "mb-6 flex flex-wrap items-center justify-between gap-3 rounded-md border px-4 py-3 text-sm print:hidden",
        styles,
      )}
    >
      <p>{message}</p>
      {isOwner ? (
        <Link
          href="/settings/billing"
          className={cn("rounded font-medium whitespace-nowrap underline", focusRing)}
        >
          {state.status === "past_due" ? "Update payment" : "Choose a plan"}
        </Link>
      ) : (
        <span className="font-medium">Ask the owner to sort out billing.</span>
      )}
    </section>
  );
}
