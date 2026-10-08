import type { BadgeTone, SelectOption } from "@/components/ui";
import {
  GENDERS,
  ID_PROOF_TYPES,
  RESIDENT_STATUSES,
  type Gender,
  type IdProofType,
  type ResidentStatus,
} from "@/types";

export const GENDER_LABELS: Record<Gender, string> = {
  male: "Male",
  female: "Female",
  other: "Other",
};

export const GENDER_OPTIONS: readonly SelectOption[] = GENDERS.map((gender) => ({
  value: gender,
  label: GENDER_LABELS[gender],
}));

export const ID_PROOF_LABELS: Record<IdProofType, string> = {
  aadhaar: "Aadhaar",
  pan: "PAN card",
  passport: "Passport",
  driving_licence: "Driving licence",
  voter_id: "Voter ID",
};

export const ID_PROOF_OPTIONS: readonly SelectOption[] = ID_PROOF_TYPES.map((type) => ({
  value: type,
  label: ID_PROOF_LABELS[type],
}));

export const RESIDENT_STATUS_LABELS: Record<ResidentStatus, string> = {
  active: "Active",
  notice: "On notice",
  vacated: "Vacated",
  blocked: "Blocked",
};

export const RESIDENT_STATUS_TONES: Record<ResidentStatus, BadgeTone> = {
  active: "success",
  notice: "warning",
  vacated: "neutral",
  blocked: "danger",
};

export const RESIDENT_STATUS_OPTIONS: readonly SelectOption[] = RESIDENT_STATUSES.map((status) => ({
  value: status,
  label: RESIDENT_STATUS_LABELS[status],
}));

/**
 * Status changes offered from each status. Mirrors the transition rule in
 * the database (private.residents_guard_status), which has the final say.
 */
export const NEXT_STATUSES: Record<ResidentStatus, readonly ResidentStatus[]> = {
  active: ["notice", "blocked"],
  notice: ["active", "vacated", "blocked"],
  vacated: ["active"],
  blocked: ["active"],
};

/** Button wording for moving to a status. */
export const STATUS_ACTION_LABELS: Record<ResidentStatus, string> = {
  active: "Mark active",
  notice: "Put on notice",
  vacated: "Mark vacated",
  blocked: "Block resident",
};

/** Accepted ID proof uploads (E5-T7). */
export const ID_PROOF_MAX_BYTES = 5 * 1024 * 1024;
export const ID_PROOF_MIME_TYPES = ["application/pdf", "image/jpeg", "image/png"] as const;
