import { timingSafeEqual } from "node:crypto";

import { NextResponse, type NextRequest } from "next/server";

import { deliverOutbox } from "@/lib/outbox/deliver";
import { logUnexpected } from "@/lib/request-context";

/**
 * Sends queued SMS and emails. Called by Vercel Cron (vercel.json), which
 * sends `Authorization: Bearer <CRON_SECRET>`, or by any external scheduler
 * given the same header (docs/resident-complaints.md).
 */
export const dynamic = "force-dynamic";

function authorised(header: string | null, secret: string): boolean {
  const expected = Buffer.from(`Bearer ${secret}`);
  const given = Buffer.from(header ?? "");
  return given.length === expected.length && timingSafeEqual(given, expected);
}

export async function GET(request: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return new NextResponse("Not configured", { status: 503 });
  if (!authorised(request.headers.get("authorization"), secret)) {
    return new NextResponse("Unauthorized", { status: 401 });
  }
  try {
    return NextResponse.json(await deliverOutbox());
  } catch (error) {
    await logUnexpected("cronOutbox", error);
    return new NextResponse("Delivery failed", { status: 500 });
  }
}
