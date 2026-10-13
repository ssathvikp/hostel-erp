import { createHmac } from "node:crypto";

import type { Client } from "./supabase";

/** Decodes an RFC 4648 base32 secret, as authenticator apps receive it. */
function base32(secret: string): Buffer {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  let bits = "";
  for (const char of secret.replace(/=+$/, "").toUpperCase()) {
    const value = alphabet.indexOf(char);
    if (value < 0) throw new Error(`Invalid base32 character ${char}`);
    bits += value.toString(2).padStart(5, "0");
  }
  const bytes = [];
  for (let i = 0; i + 8 <= bits.length; i += 8) bytes.push(parseInt(bits.slice(i, i + 8), 2));
  return Buffer.from(bytes);
}

/** The current 6-digit TOTP code for `secret` (RFC 6238, SHA-1, 30 s steps). */
export function totp(secret: string, now = Date.now()): string {
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(Math.floor(now / 1000 / 30)));
  const hmac = createHmac("sha1", base32(secret)).update(counter).digest();
  const offset = hmac[hmac.length - 1] & 0x0f;
  const code = (hmac.readUInt32BE(offset) & 0x7fffffff) % 1_000_000;
  return code.toString().padStart(6, "0");
}

/**
 * Enrols a TOTP factor for the signed-in client and verifies it, so the
 * session is raised to aal2. Returns the secret for later sign-ins.
 */
export async function enrolTotp(client: Client): Promise<string> {
  const { data, error } = await client.auth.mfa.enroll({ factorType: "totp" });
  if (error) throw error;
  const verified = await client.auth.mfa.challengeAndVerify({
    factorId: data.id,
    code: totp(data.totp.secret),
  });
  if (verified.error) throw verified.error;
  return data.totp.secret;
}
