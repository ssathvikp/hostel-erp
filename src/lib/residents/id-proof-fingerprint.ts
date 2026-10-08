import type { IdProofType } from "@/types";

export interface IdProofFingerprint {
  id_proof_type: IdProofType;
  id_proof_last4: string;
  id_proof_hash: string;
}

/**
 * Derives the stored fingerprint of an ID number. The type is part of the
 * hashed message, so the same digits on two different documents never
 * collide. Pure and key-agnostic so it can be unit tested; the server
 * supplies the keyed HMAC through `hmac`.
 */
export function idProofFingerprint(
  type: IdProofType,
  normalisedNumber: string,
  hmac: (message: string) => string,
): IdProofFingerprint {
  return {
    id_proof_type: type,
    id_proof_last4: normalisedNumber.slice(-4),
    id_proof_hash: hmac(`${type}:${normalisedNumber}`),
  };
}
