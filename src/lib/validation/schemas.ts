import { z } from "zod";

import {
  GENDERS,
  HOSTEL_TYPES,
  ID_PROOF_TYPES,
  PAYMENT_MODES,
  SHARING_TYPES,
  VACATE_REASONS,
  type SharingType,
} from "@/types";

import {
  ageOn,
  email,
  indianMobile,
  integer,
  isoDate,
  optional,
  pincode,
  requiredText,
  rupees,
  todayIst,
  uuid,
} from "./fields";

/**
 * Input schemas for every form in the MVP. These are the single source of
 * truth: client components may reuse them for inline feedback, but server
 * actions must always re-validate with them before touching the database.
 *
 * Hostel ids are never part of an input schema; they come from the session.
 */

// ---------------------------------------------------------------------------
// Hostel (EP-03)
// ---------------------------------------------------------------------------

/** Onboarding step 1. */
export const hostelBasicsSchema = z.object({
  name: requiredText("Hostel name", 120),
  type: z.enum(HOSTEL_TYPES, { error: "Choose boys, girls or co-ed" }),
  phone: indianMobile,
  owner_name: requiredText("Owner name", 120),
});

/** Onboarding step 2. */
export const hostelAddressSchema = z.object({
  address: requiredText("Address", 500),
  city: requiredText("City", 100),
  state: requiredText("State", 100),
  pincode,
  alt_phone: optional(indianMobile),
  email: optional(email),
  floors: integer("Number of floors", 1, 100),
});

/** Settings page: both steps together. */
export const hostelSchema = hostelBasicsSchema.extend(hostelAddressSchema.shape);

export type HostelBasicsInput = z.input<typeof hostelBasicsSchema>;
export type HostelInput = z.output<typeof hostelSchema>;

// ---------------------------------------------------------------------------
// Room (EP-04)
// ---------------------------------------------------------------------------

/** Room numbers are trimmed and upper-cased so `101a` and ` 101A` collide. */
export const roomNumber = z
  .string({ error: "Room number is required" })
  .trim()
  .toUpperCase()
  .min(1, { error: "Room number is required" })
  .max(20, { error: "Room number must be at most 20 characters" })
  .regex(/^[A-Z0-9][A-Z0-9-]*$/, {
    error: "Use only letters, digits and dashes",
  });

const MAX_BEDS_PER_ROOM = 12;

/** Whether a capacity is consistent with the chosen sharing type. */
export function capacityMatchesSharing(sharing: SharingType, capacity: number): boolean {
  switch (sharing) {
    case "single":
      return capacity === 1;
    case "double":
      return capacity === 2;
    case "triple":
      return capacity === 3;
    case "four_plus":
      return capacity >= 4;
  }
}

const roomFields = {
  floor: integer("Floor", 0, 100),
  sharing_type: z.enum(SHARING_TYPES, { error: "Choose a sharing type" }),
  capacity: integer("Capacity", 1, MAX_BEDS_PER_ROOM),
};

const capacityRule = {
  error: "Capacity does not match the sharing type",
  path: ["capacity"],
};

export const roomSchema = z
  .object({ room_number: roomNumber, ...roomFields })
  .refine((room) => capacityMatchesSharing(room.sharing_type, room.capacity), capacityRule);

export const MAX_BULK_ROOMS = 100;

/** Bulk generation of a numeric range such as 101 to 110. */
export const bulkRoomSchema = z
  .object({
    from_number: integer("First room number", 1, 99_999),
    to_number: integer("Last room number", 1, 99_999),
    ...roomFields,
  })
  .refine((input) => input.to_number >= input.from_number, {
    error: "Last room number must not be before the first",
    path: ["to_number"],
  })
  .refine((input) => input.to_number - input.from_number + 1 <= MAX_BULK_ROOMS, {
    error: `At most ${MAX_BULK_ROOMS} rooms can be created at once`,
    path: ["to_number"],
  })
  .refine((input) => capacityMatchesSharing(input.sharing_type, input.capacity), capacityRule);

export type RoomInput = z.output<typeof roomSchema>;
export type BulkRoomInput = z.output<typeof bulkRoomSchema>;

// ---------------------------------------------------------------------------
// Resident (EP-05)
// ---------------------------------------------------------------------------

export const MIN_RESIDENT_AGE = 15;
export const MAX_RESIDENT_AGE = 80;

/** ID numbers are stored without spaces or dashes, upper-cased. */
const idProofNumber = z
  .string({ error: "ID proof number is required" })
  .transform((value) => value.replace(/[\s-]/g, "").toUpperCase())
  .pipe(
    z
      .string()
      .min(4, { error: "ID proof number is too short" })
      .max(30, { error: "ID proof number is too long" })
      .regex(/^[A-Z0-9]+$/, { error: "Use only letters and digits" }),
  );

export const residentSchema = z
  .object({
    full_name: requiredText("Full name", 120),
    phone: indianMobile,
    alt_phone: optional(indianMobile),
    email: optional(email),
    gender: z.enum(GENDERS, { error: "Choose a gender" }),
    dob: isoDate("Date of birth"),
    id_proof_type: z.enum(ID_PROOF_TYPES, { error: "Choose an ID proof type" }),
    id_proof_number: idProofNumber,
    guardian_name: optional(requiredText("Guardian name", 120)),
    guardian_phone: optional(indianMobile),
    permanent_address: requiredText("Permanent address", 500),
    joining_date: isoDate("Joining date"),
    notes: optional(requiredText("Notes", 1000)),
  })
  .refine(
    (resident) => {
      const age = ageOn(resident.dob, todayIst());
      return age >= MIN_RESIDENT_AGE && age <= MAX_RESIDENT_AGE;
    },
    {
      error: `Resident must be between ${MIN_RESIDENT_AGE} and ${MAX_RESIDENT_AGE} years old`,
      path: ["dob"],
    },
  );

export type ResidentInput = z.output<typeof residentSchema>;

// ---------------------------------------------------------------------------
// Allocation (EP-06)
// ---------------------------------------------------------------------------

export const allocationSchema = z.object({
  resident_id: uuid("Resident"),
  bed_id: uuid("Bed"),
  start_date: isoDate("Start date"),
  rent_override: optional(rupees("Rent override")),
});

export const vacateSchema = z.object({
  allocation_id: uuid("Allocation"),
  end_date: isoDate("End date"),
  vacate_reason: z.enum(VACATE_REASONS, { error: "Choose a reason" }),
});

export type AllocationInput = z.output<typeof allocationSchema>;
export type VacateInput = z.output<typeof vacateSchema>;

// ---------------------------------------------------------------------------
// Fees and payments (EP-07)
// ---------------------------------------------------------------------------

export const feeStructureSchema = z
  .object({
    sharing_type: z.enum(SHARING_TYPES, { error: "Choose a sharing type" }),
    monthly_amount: rupees("Monthly amount"),
    effective_from: isoDate("Effective from"),
    effective_to: optional(isoDate("Effective to")),
  })
  .refine((fee) => fee.effective_to === null || fee.effective_to >= fee.effective_from, {
    error: "Effective to must not be before effective from",
    path: ["effective_to"],
  });

export const paymentSchema = z
  .object({
    invoice_id: uuid("Invoice"),
    amount: rupees("Amount"),
    paid_at: isoDate("Payment date"),
    mode: z.enum(PAYMENT_MODES, { error: "Choose a payment mode" }),
    reference: optional(requiredText("Reference", 100)),
  })
  .refine((payment) => payment.paid_at <= todayIst(), {
    error: "Payment date cannot be in the future",
    path: ["paid_at"],
  });

export type FeeStructureInput = z.output<typeof feeStructureSchema>;
export type PaymentInput = z.output<typeof paymentSchema>;
