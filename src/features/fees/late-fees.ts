import { formatPaise } from "@/lib/money";
import type { LateFeeLine } from "@/types";

/** The parts of a hostel's late-fee rule these helpers read. */
export interface LateFeeRuleSummary {
  mode: "off" | "fixed" | "per_day";
  amount: number | null;
  cap: number | null;
  graceDays: number;
}

function days(count: number): string {
  return `${count} ${count === 1 ? "day" : "days"}`;
}

/** The rule in one sentence, for settings and the fees page (ClickUp E13-T6). */
export function describeLateFeeRule(rule: LateFeeRuleSummary): string {
  if (rule.mode === "off" || rule.amount === null) return "Late fees are off.";
  const after =
    rule.graceDays === 0
      ? "the day after rent is due"
      : `${days(rule.graceDays)} after rent is due`;
  if (rule.mode === "fixed") {
    return `A late fee of ${formatPaise(rule.amount)} applies from ${after}.`;
  }
  return `A late fee of ${formatPaise(rule.amount)} a day applies from ${after}, up to ${formatPaise(rule.cap ?? rule.amount)} per month's rent.`;
}

const day = new Intl.DateTimeFormat("en-IN", { dateStyle: "medium", timeZone: "UTC" });
const formatDay = (value: string) => day.format(new Date(value));

/** Why a late fee was charged, for the invoice and its printout. */
export function explainLateFee(line: LateFeeLine): string {
  const paid = line.settled_on ? `paid in full on ${formatDay(line.settled_on)}` : "still unpaid";
  const grace = line.grace_days > 0 ? ` after the ${line.grace_days}-day grace period` : "";
  const reason = `Rent due ${formatDay(line.rent_due_date)}, ${paid}: ${days(line.days_late)} late${grace}.`;
  if (line.rule === "fixed") return `${reason} Fixed late fee.`;
  const capped = line.cap !== null && line.days_late * line.rate >= line.cap;
  return `${reason} ${formatPaise(line.rate)} a day${capped ? `, capped at ${formatPaise(line.cap!)}` : ""}.`;
}

export function isLateFeeLine(line: unknown): line is LateFeeLine {
  return (
    typeof line === "object" && line !== null && (line as { type?: unknown }).type === "late_fee"
  );
}
