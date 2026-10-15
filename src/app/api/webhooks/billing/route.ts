import { NextResponse, type NextRequest } from "next/server";

import { billingGateway, billingWebhookSecret } from "@/lib/billing/config";
import {
  isGatewayEventId,
  normaliseSubscriptionEvent,
  verifyRazorpaySignature,
} from "@/lib/billing/razorpay-webhook";
import { logger } from "@/lib/logger";
import { logUnexpected, requestId } from "@/lib/request-context";
import { createAdminClient } from "@/lib/supabase/admin";
import { syncRenewalPrice } from "@/features/billing/gateway";

/**
 * Razorpay subscription webhooks for Hostel ERP's own billing (E14-T5).
 *
 * Only a body signed with the webhook secret is read; the event id makes
 * every event count once (the database stores it). Unknown or uninteresting
 * events are acknowledged so the gateway stops retrying them; a failure on
 * our side answers 500 so it retries.
 */
export const dynamic = "force-dynamic";

const MAX_BODY_BYTES = 256 * 1024;

export async function POST(request: NextRequest) {
  const secret = billingWebhookSecret();
  if (!secret) {
    return new NextResponse("Billing webhooks are not configured", { status: 503 });
  }

  const body = await request.text();
  if (body.length > MAX_BODY_BYTES) {
    return new NextResponse("Too large", { status: 413 });
  }
  if (!verifyRazorpaySignature(body, request.headers.get("x-razorpay-signature"), secret)) {
    logger.warn("Billing webhook with a bad signature", { requestId: await requestId() });
    return new NextResponse("Bad signature", { status: 401 });
  }

  const eventId = request.headers.get("x-razorpay-event-id");
  if (!isGatewayEventId(eventId)) {
    return new NextResponse("Missing event id", { status: 400 });
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    return new NextResponse("Bad body", { status: 400 });
  }
  const event = normaliseSubscriptionEvent(parsed);
  if (!event) {
    return NextResponse.json({ result: "ignored" });
  }

  const admin = createAdminClient();
  const { data: result, error } = await admin.rpc("billing_apply_gateway_event", {
    p_event_id: eventId,
    p_event_type: event.eventType,
    p_kind: event.kind,
    p_data: event.data,
  });
  if (error) {
    await logUnexpected("billingWebhook", error);
    return new NextResponse("Could not apply the event", { status: 500 });
  }

  logger.info("Billing webhook applied", {
    requestId: await requestId(),
    eventType: event.eventType,
    result,
  });

  // A renewal is re-priced from today's plan and bed count; the gateway
  // must charge that from the next cycle. Best effort: a failure is logged
  // and the next renewal tries again.
  if (event.kind === "charged" && result === "applied" && event.data.subscription_id) {
    const gateway = billingGateway();
    if (gateway) {
      await syncRenewalPrice(gateway, event.data.subscription_id).catch((syncError) =>
        logUnexpected("billingRenewalSync", syncError),
      );
    }
  }

  return NextResponse.json({ result });
}
