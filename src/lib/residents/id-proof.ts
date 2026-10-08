import "server-only";

import { createHmac } from "node:crypto";

import { serverEnv } from "@/lib/env.server";
import type { IdProofType } from "@/types";

import { idProofFingerprint } from "./id-proof-fingerprint";

/**
 * What is stored for an ID number: the last 4 characters for display and a
 * keyed hash for duplicate detection. The full number is never stored and
 * is dropped as soon as these are derived (E5-T1, E5-T2).
 */
export function protectIdProof(type: IdProofType, normalisedNumber: string) {
  return idProofFingerprint(type, normalisedNumber, (message) =>
    createHmac("sha256", serverEnv.idProofHmacKey).update(message).digest("hex"),
  );
}
