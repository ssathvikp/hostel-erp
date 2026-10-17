import "server-only";

import type { createClient } from "@/lib/supabase/server";
import { isPastLastPage } from "@/lib/pagination";

type Supabase = Awaited<ReturnType<typeof createClient>>;

export const REMINDER_PAGE_SIZE = 50;

export interface ReminderRow {
  residentId: string;
  name: string;
  phone: string;
  outstanding: number;
  overdue: number;
  /** Earliest due date among the resident's open invoices. */
  dueDate: string | null;
  lastReminder: { sentAt: string; sentByName: string | null; channel: string } | null;
}

/**
 * Residents who owe money, most overdue first, with when they were last
 * reminded (EP-11). Paged, so it never meets the API's row cap. Returns
 * null for a page past the end.
 */
export async function getReminderList(
  supabase: Supabase,
  hostelId: string,
  page: number,
): Promise<{ rows: ReminderRow[]; total: number } | null> {
  const from = (page - 1) * REMINDER_PAGE_SIZE;
  const { data, count, error } = await supabase
    .from("resident_balances")
    .select("resident_id, outstanding, overdue", { count: "exact" })
    .eq("hostel_id", hostelId)
    .gt("outstanding", 0)
    .order("overdue", { ascending: false })
    .order("outstanding", { ascending: false })
    .order("resident_id")
    .range(from, from + REMINDER_PAGE_SIZE - 1);
  if (isPastLastPage(error)) return null;
  if (error) throw error;
  if (!data.length) return { rows: [], total: count ?? 0 };

  const ids = data.map((row) => row.resident_id!);
  const [residents, invoices, reminders] = await Promise.all([
    supabase
      .from("residents")
      .select("id, full_name, phone")
      .eq("hostel_id", hostelId)
      .in("id", ids),
    supabase
      .from("invoice_balances")
      .select("resident_id, due_date")
      .eq("hostel_id", hostelId)
      .in("resident_id", ids)
      .gt("balance", 0),
    supabase
      .from("last_reminders")
      .select("resident_id, sent_at, sent_by_name, channel")
      .eq("hostel_id", hostelId)
      .in("resident_id", ids),
  ]);
  if (residents.error) throw residents.error;
  if (invoices.error) throw invoices.error;
  if (reminders.error) throw reminders.error;

  const residentById = new Map(residents.data.map((row) => [row.id, row]));
  const reminderById = new Map(reminders.data.map((row) => [row.resident_id, row]));
  const dueById = new Map<string, string>();
  for (const invoice of invoices.data) {
    const current = dueById.get(invoice.resident_id!);
    if (!current || invoice.due_date! < current)
      dueById.set(invoice.resident_id!, invoice.due_date!);
  }

  return {
    total: count ?? data.length,
    rows: data.map((row) => {
      const id = row.resident_id!;
      const reminder = reminderById.get(id);
      return {
        residentId: id,
        name: residentById.get(id)?.full_name ?? "",
        phone: residentById.get(id)?.phone ?? "",
        outstanding: Number(row.outstanding ?? 0),
        overdue: Number(row.overdue ?? 0),
        dueDate: dueById.get(id) ?? null,
        lastReminder: reminder
          ? {
              sentAt: reminder.sent_at!,
              sentByName: reminder.sent_by_name,
              channel: reminder.channel!,
            }
          : null,
      };
    }),
  };
}

/** The hostel's own reminder wording, or null for the default. */
export async function getReminderTemplate(supabase: Supabase, hostelId: string) {
  const { data, error } = await supabase
    .from("hostels")
    .select("reminder_template")
    .eq("id", hostelId)
    .single();
  if (error) throw error;
  return data.reminder_template;
}
