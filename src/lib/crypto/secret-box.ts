import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

/**
 * Authenticated encryption for secrets stored in the database: owners'
 * payment gateway keys (E13-T10). AES-256-GCM with a random 96-bit IV; the
 * output is `v1.<iv>.<tag>.<ciphertext>` in base64url, so a tampered or
 * truncated value fails to open instead of decrypting to garbage.
 *
 * The key is 32 bytes as 64 hex characters (PAYMENT_KEYS_ENCRYPTION_KEY).
 * Losing it makes every stored secret unreadable: owners would have to
 * connect their gateway again. Never log either side.
 */

const VERSION = "v1";

function keyFrom(hex: string): Buffer {
  if (!/^[0-9a-f]{64}$/i.test(hex)) {
    throw new Error("The encryption key must be 64 hexadecimal characters");
  }
  return Buffer.from(hex, "hex");
}

export function seal(plaintext: string, keyHex: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", keyFrom(keyHex), iv);
  const body = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [VERSION, iv, tag, body]
    .map((part) => (typeof part === "string" ? part : part.toString("base64url")))
    .join(".");
}

export function open(sealed: string, keyHex: string): string {
  const [version, iv, tag, body] = sealed.split(".");
  if (version !== VERSION || !iv || !tag || body === undefined) {
    throw new Error("Not a sealed secret");
  }
  const decipher = createDecipheriv("aes-256-gcm", keyFrom(keyHex), Buffer.from(iv, "base64url"));
  decipher.setAuthTag(Buffer.from(tag, "base64url"));
  return Buffer.concat([
    decipher.update(Buffer.from(body, "base64url")),
    decipher.final(),
  ]).toString("utf8");
}
