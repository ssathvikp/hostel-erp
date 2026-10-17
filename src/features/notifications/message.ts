/**
 * Fee reminder and receipt text, and the click-to-chat links that carry it
 * (EP-11). Pure functions, so the same wording is used on every screen and
 * by any provider added later.
 */

export const REMINDER_PLACEHOLDERS = ["name", "hostel", "amount", "due_date"] as const;
export type ReminderPlaceholder = (typeof REMINDER_PLACEHOLDERS)[number];

export const DEFAULT_REMINDER_TEMPLATE =
  "Hello {name}, this is a reminder from {hostel}. Rent of {amount} is pending (due {due_date}). Please pay at the earliest. Thank you.";

export const MAX_TEMPLATE_LENGTH = 1000;

/** Fills `{placeholder}`s. Unknown placeholders are left as typed. */
export function fillTemplate(
  template: string,
  values: Record<ReminderPlaceholder, string>,
): string {
  return template.replace(/\{(\w+)\}/g, (match, key: string) =>
    (REMINDER_PLACEHOLDERS as readonly string[]).includes(key)
      ? values[key as ReminderPlaceholder]
      : match,
  );
}

/** Placeholders in a template that the app does not know, for validation. */
export function unknownPlaceholders(template: string): string[] {
  const found = [...template.matchAll(/\{(\w+)\}/g)].map((match) => match[1]);
  return [
    ...new Set(found.filter((key) => !(REMINDER_PLACEHOLDERS as readonly string[]).includes(key))),
  ];
}

export function receiptMessage(input: {
  name: string;
  hostel: string;
  amount: string;
  month: string;
  date: string;
  balance: string | null;
}): string {
  const rest = input.balance
    ? ` Balance still due: ${input.balance}.`
    : " Nothing more is due for this month.";
  return `Hello ${input.name}, ${input.hostel} has received your payment of ${input.amount} for ${input.month} on ${input.date}.${rest} Thank you.`;
}

/**
 * WhatsApp click-to-chat link for an Indian mobile number stored as 10
 * digits. Opens WhatsApp (app or web) with the message ready to send; the
 * person sending still presses send, so nothing goes out by itself.
 */
export function whatsAppLink(phone: string, message: string): string {
  const digits = phone.replace(/\D/g, "").slice(-10);
  return `https://wa.me/91${digits}?text=${encodeURIComponent(message)}`;
}
