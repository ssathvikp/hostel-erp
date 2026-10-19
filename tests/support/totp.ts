import { createHmac } from "node:crypto";

import type { Client } from "./supabase";

/** Decodes an RFC 4648 base32 secret, as authenticator apps receive it. */
function base32(secret: string): Buffer {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  let bits = "";
  for (const char of secret.replace(/=+$/, "").toUpperCase()) {
    const value = alphabet.indexOf(char);
    if (value < 0) throw new Error(`Not a base32 secret: ${secret}`);
    bits += value.toString(2).padStart(5, "0");
  }
  const bytes = [];
  for (let i = 0; i + 8 <= bits.length; i += 8) bytes.push(parseInt(bits.slice(i, i + 8), 2));
  return Buffer.from(bytes);
}

/** The current 6-digit code for a TOTP secret (RFC 6238, SHA-1, 30 s), as an app shows it. */
export function totpCode(secret: string, now: number = Date.now()): string {
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(Math.floor(now / 1000 / 30)));
  const hmac = createHmac("sha1", base32(secret)).update(counter).digest();
  const offset = hmac[hmac.length - 1] & 0xf;
  const value = (hmac.readUInt32BE(offset) & 0x7fffffff) % 1_000_000;
  return String(value).padStart(6, "0");
}

/**
 * Enrols an authenticator for a signed-in client and verifies it, so the
 * client's session reaches aal2 as an admin's does after the TOTP step.
 * Returns the secret for later sign-ins.
 */
export async function enrollTotp(client: Client): Promise<string> {
  const { data, error } = await client.auth.mfa.enroll({ factorType: "totp" });
  if (error || !data) throw error ?? new Error("enroll returned nothing");
  const secret = data.totp.secret;
  const verified = await client.auth.mfa.challengeAndVerify({
    factorId: data.id,
    code: totpCode(secret),
  });
  if (verified.error) throw verified.error;
  return secret;
}
