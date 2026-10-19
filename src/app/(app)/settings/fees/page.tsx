import type { Metadata } from "next";

import { PageHeader } from "@/components/shell/PageHeader";
import { Alert, Badge, Table, TBody, Td, Th, THead, Tr } from "@/components/ui";
import { LateFeeRuleForm } from "@/features/fees/components/LateFeeRuleForm";
import { RateForm } from "@/features/fees/components/RateForm";
import { describeLateFeeRule } from "@/features/fees/late-fees";
import { getLateFeeRule, getRates } from "@/features/fees/queries";
import { ReminderTemplateForm } from "@/features/notifications/components/ReminderTemplateForm";
import { getReminderTemplate } from "@/features/notifications/queries";
import { SHARING_TYPE_LABELS } from "@/features/rooms/options";
import { requireActiveHostel } from "@/lib/hostels/active";
import { formatPaise, shiftMonth } from "@/lib/money";
import { createClient } from "@/lib/supabase/server";
import { todayIst } from "@/lib/validation";

export const metadata: Metadata = { title: "Fee settings" };

const day = new Intl.DateTimeFormat("en-IN", { dateStyle: "medium", timeZone: "UTC" });
const formatDay = (value: string) => day.format(new Date(value));

/** Monthly rent per sharing type, with effective dates (E7-T2). */
export default async function FeeSettingsPage() {
  const { user, hostel } = await requireActiveHostel();
  const supabase = await createClient();
  const [{ history, summaries }, reminderTemplate, lateFeeRule] = await Promise.all([
    getRates(supabase, hostel.id),
    getReminderTemplate(supabase, hostel.id),
    getLateFeeRule(supabase, hostel.id),
  ]);
  const isOwner = user.role === "owner";

  // Sharing types with rooms but no rate today would go unbilled.
  const unpriced = summaries.filter((summary) => summary.rooms > 0 && !summary.current);
  const inUse = summaries.filter((summary) => summary.rooms > 0 || summary.current);

  return (
    <div className="max-w-4xl space-y-6">
      <PageHeader
        title="Fee settings"
        description="Monthly rent for each sharing type. Invoices use the rate in force on the 1st of the month."
      />

      {unpriced.length > 0 && (
        <Alert tone="warning" title="Some rooms have no rate">
          {unpriced
            .map(
              (summary) =>
                `${SHARING_TYPE_LABELS[summary.sharingType]} (${summary.rooms} ${summary.rooms === 1 ? "room" : "rooms"})`,
            )
            .join(", ")}{" "}
          {unpriced.length === 1 ? "has" : "have"} no rate for today. Residents in these rooms are
          not billed unless their allocation has a rent override.
        </Alert>
      )}

      <section
        aria-labelledby="current-rates"
        className="rounded-lg border border-slate-200 bg-white p-5 shadow-xs sm:p-6"
      >
        <h2 id="current-rates" className="mb-4 text-base font-semibold text-slate-900">
          Current rates
        </h2>
        {inUse.length === 0 ? (
          <p className="text-sm text-slate-600">
            No rates yet. Add rooms, then set the monthly rent for each sharing type.
          </p>
        ) : (
          <Table caption="Current rates">
            <THead>
              <tr>
                <Th>Sharing type</Th>
                <Th>Rooms</Th>
                <Th>Monthly rent</Th>
                <Th>Since</Th>
                <Th>Next change</Th>
              </tr>
            </THead>
            <TBody>
              {inUse.map((summary) => (
                <Tr key={summary.sharingType}>
                  <Td className="font-medium">{SHARING_TYPE_LABELS[summary.sharingType]}</Td>
                  <Td>{summary.rooms}</Td>
                  <Td>
                    {summary.current ? (
                      formatPaise(summary.current.monthlyAmount)
                    ) : (
                      <Badge tone="warning">No rate</Badge>
                    )}
                  </Td>
                  <Td>{summary.current ? formatDay(summary.current.effectiveFrom) : "—"}</Td>
                  <Td>
                    {summary.upcoming
                      ? `${formatPaise(summary.upcoming.monthlyAmount)} from ${formatDay(summary.upcoming.effectiveFrom)}`
                      : "—"}
                  </Td>
                </Tr>
              ))}
            </TBody>
          </Table>
        )}
      </section>

      {isOwner ? (
        <section
          aria-labelledby="set-rate"
          className="rounded-lg border border-slate-200 bg-white p-5 shadow-xs sm:p-6"
        >
          <h2 id="set-rate" className="text-base font-semibold text-slate-900">
            Set a rate
          </h2>
          <p className="mt-1 mb-4 text-sm text-slate-600">
            A new rate replaces the current one from its start date. To correct a rate, enter it
            again with the same start date. Invoices already issued never change.
          </p>
          <RateForm defaultFrom={shiftMonth(todayIst(), 0)} />
        </section>
      ) : (
        <Alert tone="info">Only the hostel owner can change rates.</Alert>
      )}

      <section
        id="late-fees"
        aria-labelledby="late-fee-heading"
        className="rounded-lg border border-slate-200 bg-white p-5 shadow-xs sm:p-6"
      >
        <h2 id="late-fee-heading" className="text-base font-semibold text-slate-900">
          Late fees
        </h2>
        <p className="mt-1 mb-4 text-sm text-slate-600">
          {describeLateFeeRule(lateFeeRule)} Late fees are added as their own invoice, once per
          month&apos;s rent, from Fees → Add late fees now. The owner can waive one with a reason.
          {lateFeeRule.since &&
            ` Applies to rent due on or after ${formatDay(lateFeeRule.since)}, when the rule was switched on.`}
        </p>
        {isOwner && <LateFeeRuleForm rule={lateFeeRule} />}
      </section>

      {isOwner && (
        <section
          id="reminder-message"
          aria-labelledby="reminder-heading"
          className="rounded-lg border border-slate-200 bg-white p-5 shadow-xs sm:p-6"
        >
          <h2 id="reminder-heading" className="text-base font-semibold text-slate-900">
            Reminder message
          </h2>
          <p className="mt-1 mb-4 text-sm text-slate-600">
            The text sent from Fees → Send reminders. Each resident&apos;s name, amount and due date
            are filled in.
          </p>
          <ReminderTemplateForm template={reminderTemplate} />
        </section>
      )}

      {history.length > 0 && (
        <section aria-labelledby="rate-history">
          <h2 id="rate-history" className="mb-3 text-base font-semibold text-slate-900">
            Rate history
          </h2>
          <Table caption="Rate history">
            <THead>
              <tr>
                <Th>Sharing type</Th>
                <Th>Monthly rent</Th>
                <Th>From</Th>
                <Th>To</Th>
              </tr>
            </THead>
            <TBody>
              {history.map((rate) => (
                <Tr key={rate.id}>
                  <Td>{SHARING_TYPE_LABELS[rate.sharingType]}</Td>
                  <Td>{formatPaise(rate.monthlyAmount)}</Td>
                  <Td>{formatDay(rate.effectiveFrom)}</Td>
                  <Td>{rate.effectiveTo ? formatDay(rate.effectiveTo) : "Until changed"}</Td>
                </Tr>
              ))}
            </TBody>
          </Table>
        </section>
      )}
    </div>
  );
}
