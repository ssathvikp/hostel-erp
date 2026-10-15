import "server-only";

import { emailProvider } from "@/lib/email/provider";
import { describeError, logger } from "@/lib/logger";
import { siteUrl } from "@/lib/payments/config";
import { updateVariables, type SmsKind } from "@/lib/sms/messages";
import { smsProvider } from "@/lib/sms/provider";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * Sends what is waiting in sms_outbox and email_outbox (E15-T4, EP-14).
 * Each row is claimed by bumping its attempt count first, so two runs at
 * once do not send the same message twice; a row is retried up to 5 times.
 * Kinds whose provider is not configured are left waiting.
 */
const BATCH = 50;
const MAX_ATTEMPTS = 5;

export interface DeliveryReport {
  sms: { sent: number; failed: number; skipped: boolean };
  email: { sent: number; failed: number; skipped: boolean };
}

export async function deliverOutbox(): Promise<DeliveryReport> {
  const admin = createAdminClient();
  const report: DeliveryReport = {
    sms: { sent: 0, failed: 0, skipped: false },
    email: { sent: 0, failed: 0, skipped: false },
  };

  const sms = smsProvider();
  if (!sms) {
    report.sms.skipped = true;
  } else {
    const { data: rows, error } = await admin
      .from("sms_outbox")
      .select("id, to_phone, kind, variables, attempts")
      .is("sent_at", null)
      .lt("attempts", MAX_ATTEMPTS)
      .neq("kind", "resident_code")
      .order("created_at")
      .limit(BATCH);
    if (error) throw error;
    for (const row of rows ?? []) {
      const claim = await admin
        .from("sms_outbox")
        .update({ attempts: row.attempts + 1 })
        .eq("id", row.id)
        .eq("attempts", row.attempts)
        .is("sent_at", null)
        .select("id");
      if (!claim.data?.length) continue;
      try {
        const variables = updateVariables(row.variables, siteUrl());
        const { id } = await sms.send({ to: row.to_phone, kind: row.kind as SmsKind, variables });
        await admin
          .from("sms_outbox")
          .update({ sent_at: new Date().toISOString(), provider_id: id, last_error: null })
          .eq("id", row.id);
        report.sms.sent += 1;
      } catch (sendError) {
        await admin
          .from("sms_outbox")
          .update({
            last_error: String(describeError(sendError).message ?? "failed").slice(0, 300),
          })
          .eq("id", row.id);
        report.sms.failed += 1;
      }
    }
  }

  const email = emailProvider();
  if (!email) {
    report.email.skipped = true;
  } else {
    const { data: rows, error } = await admin
      .from("email_outbox")
      .select("id, to_email, subject, body, attempts")
      .is("sent_at", null)
      .lt("attempts", MAX_ATTEMPTS)
      .order("created_at")
      .limit(BATCH);
    if (error) throw error;
    for (const row of rows ?? []) {
      const claim = await admin
        .from("email_outbox")
        .update({ attempts: row.attempts + 1 })
        .eq("id", row.id)
        .eq("attempts", row.attempts)
        .is("sent_at", null)
        .select("id");
      if (!claim.data?.length) continue;
      try {
        await email.send({ to: row.to_email, subject: row.subject, text: row.body });
        await admin
          .from("email_outbox")
          .update({ sent_at: new Date().toISOString(), last_error: null })
          .eq("id", row.id);
        report.email.sent += 1;
      } catch (sendError) {
        await admin
          .from("email_outbox")
          .update({
            last_error: String(describeError(sendError).message ?? "failed").slice(0, 300),
          })
          .eq("id", row.id);
        report.email.failed += 1;
      }
    }
  }

  if (report.sms.sent || report.sms.failed || report.email.sent || report.email.failed) {
    logger.info("Outbox delivered", { ...report });
  }
  return report;
}

/** Runs a delivery after the response, never failing the request that queued it. */
export async function deliverOutboxQuietly(): Promise<void> {
  try {
    await deliverOutbox();
  } catch (error) {
    logger.error("Outbox delivery failed", { error: describeError(error) });
  }
}
