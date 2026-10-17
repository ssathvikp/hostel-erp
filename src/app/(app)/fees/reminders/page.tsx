import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";

import { PageHeader } from "@/components/shell/PageHeader";
import { Badge, buttonClass, EmptyState, Table, TBody, Td, Th, THead, Tr } from "@/components/ui";
import { SendButtons } from "@/features/notifications/components/SendButtons";
import {
  DEFAULT_REMINDER_TEMPLATE,
  fillTemplate,
  whatsAppLink,
} from "@/features/notifications/message";
import {
  getReminderList,
  getReminderTemplate,
  REMINDER_PAGE_SIZE,
} from "@/features/notifications/queries";
import { requireActiveHostel } from "@/lib/hostels/active";
import { formatPaise } from "@/lib/money";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Fee reminders" };

const day = new Intl.DateTimeFormat("en-IN", { dateStyle: "medium", timeZone: "UTC" });
const moment = new Intl.DateTimeFormat("en-IN", {
  dateStyle: "medium",
  timeStyle: "short",
  timeZone: "Asia/Kolkata",
});

/**
 * Everyone who owes rent, with a ready-made reminder to send on WhatsApp
 * and when they were last reminded (EP-11). Owners and staff.
 */
export default async function RemindersPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string }>;
}) {
  const { user, hostel } = await requireActiveHostel();
  const pageParam = Number((await searchParams).page);
  const page = Number.isInteger(pageParam) && pageParam > 1 ? pageParam : 1;
  const supabase = await createClient();

  const [list, template] = await Promise.all([
    getReminderList(supabase, hostel.id, page),
    getReminderTemplate(supabase, hostel.id),
  ]);
  if (!list) redirect("/fees/reminders");
  const { rows, total } = list;
  const lastPage = Math.max(1, Math.ceil(total / REMINDER_PAGE_SIZE));

  return (
    <>
      <div>
        <Link href="/fees" className="text-sm font-medium text-brand-700 hover:underline">
          ← Fees
        </Link>
        <div className="mt-2">
          <PageHeader
            title="Fee reminders"
            description="Residents who owe rent, most overdue first. WhatsApp opens with the message ready; you press send."
            actions={
              user.role === "owner" ? (
                <Link
                  href="/settings/fees#reminder-message"
                  className={buttonClass({ variant: "secondary" })}
                >
                  Edit message
                </Link>
              ) : undefined
            }
          />
        </div>
      </div>

      {rows.length === 0 ? (
        <EmptyState
          title="Nobody owes rent"
          description="Residents with money due will appear here, ready to remind."
        />
      ) : (
        <>
          <Table caption="Residents who owe rent">
            <THead>
              <tr>
                <Th>Resident</Th>
                <Th className="text-right">Due</Th>
                <Th>Since</Th>
                <Th>Last reminded</Th>
                <Th>
                  <span className="sr-only">Send</span>
                </Th>
              </tr>
            </THead>
            <TBody>
              {rows.map((row) => {
                const message = fillTemplate(template ?? DEFAULT_REMINDER_TEMPLATE, {
                  name: row.name,
                  hostel: hostel.name,
                  amount: formatPaise(row.outstanding),
                  due_date: row.dueDate ? day.format(new Date(row.dueDate)) : "now",
                });
                return (
                  <Tr key={row.residentId}>
                    <Td>
                      <Link
                        href={`/residents/${row.residentId}`}
                        className="font-medium text-brand-700 hover:underline"
                      >
                        {row.name}
                      </Link>
                      <span className="block text-xs text-slate-600">{row.phone}</span>
                    </Td>
                    <Td className="text-right tabular-nums">
                      <span className="font-medium">{formatPaise(row.outstanding)}</span>
                      {row.overdue > 0 && (
                        <span className="mt-0.5 block">
                          <Badge tone="danger">{formatPaise(row.overdue)} overdue</Badge>
                        </span>
                      )}
                    </Td>
                    <Td>{row.dueDate ? day.format(new Date(row.dueDate)) : "—"}</Td>
                    <Td>
                      {row.lastReminder ? (
                        <>
                          {moment.format(new Date(row.lastReminder.sentAt))}
                          {row.lastReminder.sentByName && (
                            <span className="block text-xs text-slate-500">
                              by {row.lastReminder.sentByName}
                            </span>
                          )}
                        </>
                      ) : (
                        <span className="text-slate-500">Never</span>
                      )}
                    </Td>
                    <Td>
                      <SendButtons
                        link={whatsAppLink(row.phone, message)}
                        message={message}
                        subject={`reminder to ${row.name}`}
                        send={{
                          residentId: row.residentId,
                          kind: "due",
                          invoiceId: null,
                          amount: row.outstanding,
                        }}
                      />
                    </Td>
                  </Tr>
                );
              })}
            </TBody>
          </Table>

          <nav
            aria-label="Pagination"
            className="mt-4 flex items-center justify-between text-sm text-slate-600"
          >
            <span>
              {total} {total === 1 ? "resident" : "residents"} owe rent
            </span>
            <div className="flex items-center gap-3">
              {page > 1 && (
                <Link
                  href={page > 2 ? `/fees/reminders?page=${page - 1}` : "/fees/reminders"}
                  className={buttonClass({ variant: "secondary", size: "sm" })}
                >
                  Previous
                </Link>
              )}
              <span>
                Page {page} of {lastPage}
              </span>
              {page < lastPage && (
                <Link
                  href={`/fees/reminders?page=${page + 1}`}
                  className={buttonClass({ variant: "secondary", size: "sm" })}
                >
                  Next
                </Link>
              )}
            </div>
          </nav>
        </>
      )}
    </>
  );
}
