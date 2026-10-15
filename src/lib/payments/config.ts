import "server-only";

import { open, seal } from "@/lib/crypto/secret-box";

/**
 * Settings for each hostel's own payment gateway (E13-T10). The encryption
 * key protects owners' Razorpay secrets at rest; it is optional so the app
 * runs without it, but no gateway can be connected until it is set.
 */
function encryptionKey(): string | null {
  const key = process.env.PAYMENT_KEYS_ENCRYPTION_KEY;
  return key && /^[0-9a-f]{64}$/i.test(key) ? key : null;
}

export function canStoreGatewayKeys(): boolean {
  return encryptionKey() !== null;
}

export function sealGatewaySecret(secret: string): string {
  const key = encryptionKey();
  if (!key) throw new Error("PAYMENT_KEYS_ENCRYPTION_KEY is not set");
  return seal(secret, key);
}

export function openGatewaySecret(sealed: string): string {
  const key = encryptionKey();
  if (!key) throw new Error("PAYMENT_KEYS_ENCRYPTION_KEY is not set");
  return open(sealed, key);
}

/** The public origin for links the outside world opens. */
export function siteUrl(): string {
  return (process.env.NEXT_PUBLIC_SITE_URL || "http://localhost:3000").replace(/\/+$/, "");
}
