/**
 * The text of every SMS to residents (E15-T3, T4). Indian operators deliver
 * only messages that match a DLT-registered template word for word, with
 * {#var#} where the variables go, so the templates live here in one place:
 * register exactly these texts (docs/resident-complaints.md).
 */

export const SMS_TEMPLATES = {
  resident_code:
    "{#var#} is your code to report a problem at {#var#}. It expires in 10 minutes. Do not share it. - Hostel ERP",
  complaint_update: "Complaint #{#var#} at {#var#}: {#var#}. Track it: {#var#} - Hostel ERP",
} as const;

export type SmsKind = keyof typeof SMS_TEMPLATES;

/** Fills a template's {#var#} slots in order. */
export function fillTemplate(kind: SmsKind, variables: readonly string[]): string {
  let index = 0;
  return SMS_TEMPLATES[kind].replace(/\{#var#\}/g, () => variables[index++] ?? "");
}

/** The status link in a complaint update, from the stored status token. */
export function statusUrl(siteUrl: string, token: string): string {
  return `${siteUrl.replace(/\/+$/, "")}/c/${token}`;
}

/** Variables for a complaint update as sent: the token becomes the full link. */
export function updateVariables(stored: readonly string[], siteUrl: string): string[] {
  const [number, hostel, step, token] = stored;
  return [
    number,
    hostel,
    step === "received" ? "received, we will update you" : step,
    statusUrl(siteUrl, token),
  ];
}
