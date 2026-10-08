import { createHash, randomInt, randomUUID } from "node:crypto";

import type { Database } from "@/types/database";

type ResidentInsert = Database["public"]["Tables"]["residents"]["Insert"];

/** A random valid Indian mobile number. */
export function randomMobile(): string {
  return `9${String(randomInt(0, 1_000_000_000)).padStart(9, "0")}`;
}

/** A stand-in for the app's keyed hash: any 64-character hex string is valid. */
export function fakeIdHash(seed: string = randomUUID()): string {
  return createHash("sha256").update(seed).digest("hex");
}

/** A complete, valid resident row for `hostelId`, unique unless overridden. */
export function residentRow(
  hostelId: string,
  overrides: Partial<ResidentInsert> = {},
): ResidentInsert {
  return {
    hostel_id: hostelId,
    full_name: `Test Resident ${randomUUID().slice(0, 6)}`,
    phone: randomMobile(),
    gender: "male",
    dob: "2002-05-14",
    id_proof_type: "aadhaar",
    id_proof_last4: "1234",
    id_proof_hash: fakeIdHash(),
    permanent_address: "12 Station Road, Vijayawada",
    joining_date: "2026-06-01",
    ...overrides,
  };
}
