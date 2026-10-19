import {
  completedSteps,
  isActivated,
  SETUP_STEP_LABELS,
  SETUP_STEPS,
} from "@/lib/hostels/activation";
import { daysBetween } from "@/lib/money";

import type { AdminHostel } from "./queries";

/**
 * Which hostels need the operator's attention, and why (plan E14-T13,
 * E15-T2). Pure, so the rules are unit-tested.
 */
export type SignalKind = "setup_stalled" | "trial_ending" | "trial_lapsed" | "quiet" | "upsell";

export interface Signal {
  hostelId: string;
  hostelName: string;
  kind: SignalKind;
  message: string;
}

export const SIGNAL_LABELS: Record<SignalKind, string> = {
  setup_stalled: "Not set up",
  trial_ending: "Trial ending",
  trial_lapsed: "Trial ended",
  quiet: "Gone quiet",
  upsell: "Bigger plan",
};

/** Days without any activity before a live hostel counts as gone quiet. */
export const QUIET_DAYS = 14;
/** How close to its end a trial is flagged. */
export const TRIAL_ENDING_DAYS = 7;
/** Days into a trial after which an unfinished set-up is flagged (and called). */
export const SETUP_CHECK_DAYS = [7, 21] as const;
/** Beds from which a hostel is a candidate for a bigger plan. */
export const LARGE_HOSTEL_BEDS = 100;

const plural = (count: number, one: string) => `${count} ${one}${count === 1 ? "" : "s"}`;

export function hostelSignals(hostel: AdminHostel, today: string): Signal[] {
  if (hostel.status !== "active") return [];
  const signals: Signal[] = [];
  const add = (kind: SignalKind, message: string) =>
    signals.push({ hostelId: hostel.id, hostelName: hostel.name, kind, message });
  const age = daysBetween(hostel.createdAt.slice(0, 10), today);

  if (!isActivated(hostel.setup) && age >= SETUP_CHECK_DAYS[0]) {
    const done = completedSteps(hostel.setup);
    const next = SETUP_STEPS.find((step) => !done[step]);
    add(
      "setup_stalled",
      `${plural(age, "day")} since sign-up${age >= SETUP_CHECK_DAYS[1] ? ", call the owner" : ""}. Next step: ${next ? SETUP_STEP_LABELS[next].toLowerCase() : "generate invoices"}.`,
    );
  }

  if (hostel.plan === "trial" && hostel.trialEndsAt) {
    const left = daysBetween(today, hostel.trialEndsAt);
    if (left < 0) {
      add("trial_lapsed", `Trial ended ${plural(-left, "day")} ago without a plan.`);
    } else if (left <= TRIAL_ENDING_DAYS) {
      add(
        "trial_ending",
        `Trial ends ${left === 0 ? "today" : `in ${plural(left, "day")}`}. ${isActivated(hostel.setup) ? "Set up and in use." : "Not set up yet."}`,
      );
    }
  }

  const sinceActivity = hostel.lastActivityAt
    ? daysBetween(hostel.lastActivityAt.slice(0, 10), today)
    : age;
  if (age >= QUIET_DAYS && sinceActivity >= QUIET_DAYS) {
    add("quiet", `Nothing recorded for ${plural(sinceActivity, "day")}.`);
  }

  if (hostel.plan !== "paid" && (hostel.beds >= LARGE_HOSTEL_BEDS || hostel.ownerHostels > 1)) {
    add(
      "upsell",
      hostel.ownerHostels > 1
        ? `Owner runs ${plural(hostel.ownerHostels, "hostel")}: a chain plan candidate.`
        : `${hostel.beds} beds: a candidate for a bigger plan.`,
    );
  }

  return signals;
}

const ORDER: SignalKind[] = ["trial_lapsed", "trial_ending", "setup_stalled", "quiet", "upsell"];

/** Every hostel's signals, most urgent kind first. */
export function attentionList(hostels: readonly AdminHostel[], today: string): Signal[] {
  return hostels
    .flatMap((hostel) => hostelSignals(hostel, today))
    .sort((a, b) => ORDER.indexOf(a.kind) - ORDER.indexOf(b.kind));
}
