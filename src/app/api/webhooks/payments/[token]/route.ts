import { NextResponse, type NextRequest } from "next/server";

import {
  isGatewayEventId,
  normaliseRentEvent,
  verifyRazorpaySignature,
} from "@/lib/billing/razorpay-webhook";
import { logger } from "@/lib/logger";
import { openGatewaySecret } from "@/lib/payments/config";
import { logUnexpected, requestId } from "@/lib/request-context";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * Webhooks from a hostel's own Razorpay account (E13-T10). The token in the
 * URL only names the hostel; the body must be signed with that hostel's own
 * webhook secret. Each event id, and each gateway payment, counts once.
 */
export const dynamic = "force-dynamic";

const MAX_BODY_BYTES = 256 * 1024;
const TOKEN = /^[0-9a-f]{32}$/;

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ token: string }> },
) {
  const { token } = await params;
  if (!TOKEN.test(token)) return new NextResponse("Not found", { status: 404 });

  const body = await request.text();
  if (body.length > MAX_BODY_BYTES) return new NextResponse("Too large", { status: 413 });

  const admin = createAdminClient();
  const { data: account, error: accountError } = await admin.rpc("gateway_account_for_webhook", {
    p_token: token,
  });
  if (accountError) {
    await logUnexpected("rentWebhook:account", accountError);
    return new NextResponse("Try again", { status: 500 });
  }
  if (!account) return new NextResponse("Not found", { status: 404 });
  const { hostel_id: hostelId, webhook_secret_encrypted: sealed } = account as {
    hostel_id: string;
    webhook_secret_encrypted: string;
  };

  let secret: string;
  try {
    secret = openGatewaySecret(sealed);
  } catch (error) {
    await logUnexpected("rentWebhook:secret", error);
    return new NextResponse("Not configured", { status: 503 });
  }
  if (!verifyRazorpaySignature(body, request.headers.get("x-razorpay-signature"), secret)) {
    logger.warn("Rent webhook with a bad signature", { requestId: await requestId(), hostelId });
    return new NextResponse("Bad signature", { status: 401 });
  }
  const eventId = request.headers.get("x-razorpay-event-id");
  if (!isGatewayEventId(eventId)) return new NextResponse("Missing event id", { status: 400 });

  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    return new NextResponse("Bad body", { status: 400 });
  }
  const event = normaliseRentEvent(parsed);
  if (!event) return NextResponse.json({ result: "ignored" });

  const { data: result, error } = await admin.rpc("collect_gateway_event", {
    p_hostel_id: hostelId,
    p_event_id: eventId,
    p_event_type: event.eventType,
    p_kind: event.kind,
    p_data: event.data,
  });
  if (error) {
    await logUnexpected("rentWebhook", error);
    return new NextResponse("Could not apply the event", { status: 500 });
  }
  logger.info("Rent webhook applied", {
    requestId: await requestId(),
    hostelId,
    eventType: event.eventType,
    result,
  });
  return NextResponse.json({ result });
}
