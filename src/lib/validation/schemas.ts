import { z } from "zod";

import {
  FEE_HEAD_BILLINGS,
  FEE_HEAD_PRICINGS,
  GENDERS,
  HOSTEL_TYPES,
  ID_PROOF_TYPES,
  INDIAN_STATES,
  MANUAL_BED_STATUSES,
  PAYMENT_MODES,
  RESIDENT_STATUSES,
  SHARING_TYPES,
  type IdProofType,
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
// Authentication (EP-02)
// ---------------------------------------------------------------------------

/** bcrypt, which Supabase Auth uses, ignores everything past 72 bytes. */
export const MAX_PASSWORD_LENGTH = 72;

/** Mirrors supabase/config.toml: 8+ characters with letters and digits. */
export const newPassword = z
  .string({ error: "Password is required" })
  .min(8, { error: "Use at least 8 characters" })
  .max(MAX_PASSWORD_LENGTH, { error: `Use at most ${MAX_PASSWORD_LENGTH} characters` })
  .refine((value) => /[A-Za-z]/.test(value) && /\d/.test(value), {
    error: "Use both letters and numbers",
  });

export const signupSchema = z.object({
  full_name: requiredText("Your name", 120),
  email,
  password: newPassword,
});

export const loginSchema = z.object({
  email,
  // Never re-check strength at login: a rule change must not lock anyone out.
  password: z.string({ error: "Password is required" }).min(1, { error: "Password is required" }),
});

export const forgotPasswordSchema = z.object({ email });

export const resetPasswordSchema = z
  .object({
    password: newPassword,
    confirm_password: z.string({ error: "Confirm your new password" }),
  })
  .refine((input) => input.password === input.confirm_password, {
    error: "Passwords do not match",
    path: ["confirm_password"],
  });

export type SignupInput = z.output<typeof signupSchema>;
export type LoginInput = z.output<typeof loginSchema>;

// ---------------------------------------------------------------------------
// Hostel (EP-03)
// ---------------------------------------------------------------------------

/** Onboarding step 1. The owner's name comes from their account. */
export const hostelBasicsSchema = z.object({
  name: requiredText("Hostel name", 120),
  type: z.enum(HOSTEL_TYPES, { error: "Choose boys, girls or co-ed" }),
  phone: indianMobile,
});

/** Onboarding step 2. */
export const hostelAddressSchema = z.object({
  address: requiredText("Address", 500),
  city: requiredText("City", 100),
  state: z.enum(INDIAN_STATES, { error: "Choose a state" }),
  pincode,
  alt_phone: optional(indianMobile),
  email: optional(email),
  floors: integer("Number of floors", 1, 100),
});

/** GST registration number, e.g. 29ABCDE1234F1Z5. Stored upper-cased. */
export const gstin = z
  .string()
  .trim()
  .toUpperCase()
  .regex(/^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/, {
    error: "Enter a valid 15-character GSTIN",
  });

/** Settings page: both steps together, plus details only settings collects. */
export const hostelSchema = hostelBasicsSchema
  .extend(hostelAddressSchema.shape)
  .extend({ gstin: optional(gstin) });

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

export const MAX_BEDS_PER_ROOM = 12;

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

/** Editing a room: the room number is identity and never changes. */
export const roomUpdateSchema = z
  .object(roomFields)
  .refine((room) => capacityMatchesSharing(room.sharing_type, room.capacity), capacityRule);

/** Manual bed status. A reason is kept only while a bed is out of service. */
export const bedStatusSchema = z
  .object({
    bed_id: uuid("Bed"),
    status: z.enum(MANUAL_BED_STATUSES, { error: "Choose a status" }),
    status_reason: optional(requiredText("Reason", 200)),
  })
  .transform((input) => ({
    ...input,
    status_reason: input.status === "available" ? null : input.status_reason,
  }));

export type RoomInput = z.output<typeof roomSchema>;
export type RoomUpdateInput = z.output<typeof roomUpdateSchema>;
export type BulkRoomInput = z.output<typeof bulkRoomSchema>;
export type BedStatusInput = z.output<typeof bedStatusSchema>;

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
  )
  .refine(
    (resident) => ID_PROOF_FORMATS[resident.id_proof_type].pattern.test(resident.id_proof_number),
    {
      error: "ID proof number does not match the chosen document",
      path: ["id_proof_number"],
    },
  )
  .refine((resident) => resident.joining_date >= resident.dob, {
    error: "Joining date cannot be before the date of birth",
    path: ["joining_date"],
  });

/**
 * Shape of each document's number after normalisation. Strict enough to
 * catch a number typed against the wrong document type, loose enough for
 * older formats (driving licences and voter IDs vary by state).
 */
export const ID_PROOF_FORMATS: Record<IdProofType, { pattern: RegExp; example: string }> = {
  aadhaar: { pattern: /^[2-9][0-9]{11}$/, example: "12 digits" },
  pan: { pattern: /^[A-Z]{5}[0-9]{4}[A-Z]$/, example: "ABCDE1234F" },
  passport: { pattern: /^[A-Z][0-9]{7}$/, example: "A1234567" },
  driving_licence: { pattern: /^[A-Z]{2}[0-9A-Z]{8,14}$/, example: "KA0120190001234" },
  voter_id: { pattern: /^[A-Z]{3}[0-9]{7}$/, example: "ABC1234567" },
};

/** Editing a resident: contact, address, guardian and notes (E5-T2). */
export const residentUpdateSchema = z.object({
  phone: indianMobile,
  alt_phone: optional(indianMobile),
  email: optional(email),
  guardian_name: optional(requiredText("Guardian name", 120)),
  guardian_phone: optional(indianMobile),
  permanent_address: requiredText("Permanent address", 500),
  notes: optional(requiredText("Notes", 1000)),
});

/** A status change (E5-T6). Allowed transitions are enforced by the database. */
export const residentStatusSchema = z.object({
  resident_id: uuid("Resident"),
  status: z.enum(RESIDENT_STATUSES, { error: "Choose a status" }),
});

export type ResidentInput = z.output<typeof residentSchema>;
export type ResidentUpdateInput = z.output<typeof residentUpdateSchema>;

// ---------------------------------------------------------------------------
// Allocation (EP-06)
// ---------------------------------------------------------------------------

/** Allocations record moves that have happened: no advance bookings (E6-T2). */
const notFuture = (label: string) =>
  isoDate(label).refine((value) => value <= todayIst(), {
    error: `${label} cannot be in the future`,
  });

export const allocationSchema = z.object({
  resident_id: uuid("Resident"),
  bed_id: uuid("Bed"),
  start_date: notFuture("Start date"),
  rent_override: optional(rupees("Rent override")),
});

/** Reasons a user can give for vacating; "transferred" is set by transfers only. */
export const VACATE_FORM_REASONS = ["moved_out", "evicted", "other"] as const;

/**
 * Vacating (E6-T4). The move-out date is the day the resident leaves; the
 * allocation's last night (end_date) is the day before.
 */
export const vacateSchema = z.object({
  allocation_id: uuid("Allocation"),
  move_out_date: notFuture("Move-out date"),
  vacate_reason: z.enum(VACATE_FORM_REASONS, { error: "Choose a reason" }),
  mark_vacated: z
    .literal("on")
    .optional()
    .transform((value) => value === "on"),
});

/** Transferring to another bed (E6-T4). The first night in the new bed is move_date. */
export const transferSchema = z.object({
  allocation_id: uuid("Allocation"),
  bed_id: uuid("New bed"),
  move_date: notFuture("Move date"),
  rent_override: optional(rupees("Rent override")),
});

export type AllocationInput = z.output<typeof allocationSchema>;
export type VacateInput = z.output<typeof vacateSchema>;
export type TransferInput = z.output<typeof transferSchema>;

// ---------------------------------------------------------------------------
// Fees and payments (EP-07)
// ---------------------------------------------------------------------------

/**
 * A rate for a sharing type from a date (E7-T2). It has no end date: the
 * next rate set for the same type closes it the day before it starts.
 */
export const feeStructureSchema = z.object({
  sharing_type: z.enum(SHARING_TYPES, { error: "Choose a sharing type" }),
  monthly_amount: rupees("Monthly amount"),
  effective_from: isoDate("Effective from"),
});

/** A billing month typed into `<input type="month">` (`YYYY-MM`), output as `YYYY-MM-01`. */
export const billingMonth = z
  .string({ error: "Choose a month" })
  .regex(/^\d{4}-(0[1-9]|1[0-2])$/, { error: "Choose a month" })
  .refine((value) => value <= todayIst().slice(0, 7), {
    error: "A future month cannot be billed yet",
  })
  .transform((value) => `${value}-01`);

/** Monthly invoice generation (E7-T3). Due days stop at 28 so every month has one. */
export const generateInvoicesSchema = z.object({
  period_month: billingMonth,
  due_day: integer("Due day", 1, 28),
});

/** Voiding an invoice or payment always records why (E7-T3, E7-T4). */
export const voidSchema = z.object({
  id: uuid("Record"),
  void_reason: requiredText("Reason", 500),
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

/** Money received for a resident, not tied to one invoice: an advance or a deposit. */
export const residentMoneySchema = z.object({
  resident_id: uuid("Resident"),
  amount: rupees("Amount"),
  paid_at: notFuture("Received on"),
  mode: z.enum(PAYMENT_MODES, { error: "Choose a payment mode" }),
  reference: optional(requiredText("Reference", 100)),
});

/** Money paid back to a resident from their credit or deposit. */
export const refundSchema = z.object({
  resident_id: uuid("Resident"),
  amount: rupees("Amount"),
  mode: z.enum(PAYMENT_MODES, { error: "Choose how it is paid back" }),
  reference: optional(requiredText("Reference", 100)),
});

/** Part of a deposit kept, always with a reason. */
export const depositDeductionSchema = z.object({
  resident_id: uuid("Resident"),
  amount: rupees("Amount"),
  reason: requiredText("Reason", 500),
});

/** The deposit asked for on a resident's first stay, per sharing type. Blank removes it. */
export const depositAmountSchema = z.object({
  sharing_type: z.enum(SHARING_TYPES, { error: "Choose a sharing type" }),
  amount: optional(rupees("Deposit")),
});

const asList = (value: unknown) =>
  Array.isArray(value) ? value : value === undefined ? [] : [value];

/** Settling a resident who has left (E13-T8). Up to three deductions. */
export const settlementSchema = z
  .object({
    resident_id: uuid("Resident"),
    deduction_amount: z.preprocess(asList, z.array(z.string()).max(3)),
    deduction_reason: z.preprocess(asList, z.array(z.string()).max(3)),
    use_deposit: z
      .literal("on")
      .optional()
      .transform((value) => value === "on"),
    refund_mode: optional(z.enum(PAYMENT_MODES, { error: "Choose how it is paid back" })),
    refund_reference: optional(requiredText("Reference", 100)),
  })
  .transform((input, ctx) => {
    const deductions: { amount: number; reason: string }[] = [];
    input.deduction_amount.forEach((raw, index) => {
      const reason = (input.deduction_reason[index] ?? "").trim();
      if (!raw.trim() && !reason) return;
      const amount = rupees("Deduction").safeParse(raw);
      if (!amount.success) {
        ctx.addIssue({
          code: "custom",
          message: "Enter each deduction as an amount",
          path: ["deductions"],
        });
        return;
      }
      if (!reason) {
        ctx.addIssue({
          code: "custom",
          message: "Give a reason for each deduction",
          path: ["deductions"],
        });
        return;
      }
      deductions.push({ amount: amount.data, reason });
    });
    return {
      resident_id: input.resident_id,
      deductions,
      use_deposit: input.use_deposit,
      refund_mode: input.refund_mode,
      refund_reference: input.refund_reference,
    };
  });

/** A charge other than rent (E13-T1). Rent is built in and cannot be a head. */
export const feeHeadSchema = z
  .object({
    name: requiredText("Name", 60).refine((name) => name.toLowerCase() !== "rent", {
      error: "Rent is set in the rates above",
    }),
    billing: z.enum(FEE_HEAD_BILLINGS, { error: "Choose how often it is billed" }),
    pricing: z.enum(FEE_HEAD_PRICINGS, { error: "Choose how it is priced" }),
    /** One-time heads only: added as a charge when a resident first gets a bed. */
    charge_on_first_stay: z
      .literal("on")
      .optional()
      .transform((value) => value === "on"),
  })
  .refine((head) => !head.charge_on_first_stay || head.billing === "one_time", {
    error: "Only a one-time charge can be added on a resident's first stay",
    path: ["charge_on_first_stay"],
  });

/** A head's rate from a date; per-sharing heads also name the sharing type. */
export const feeHeadRateSchema = z.object({
  fee_head_id: uuid("Charge"),
  sharing_type: optional(z.enum(SHARING_TYPES, { error: "Choose a sharing type" })),
  amount: rupees("Amount"),
  effective_from: isoDate("Effective from"),
});

export const feeHeadToggleSchema = z.object({
  fee_head_id: uuid("Charge"),
  active: z.enum(["true", "false"]).transform((value) => value === "true"),
});

/** Excusing a resident from a monthly charge, or billing them again. */
export const feeExemptionSchema = z.object({
  resident_id: uuid("Resident"),
  fee_head_id: uuid("Charge"),
  exempt: z.enum(["true", "false"]).transform((value) => value === "true"),
});

/**
 * A charge outside the monthly cycle (E13-T2): from a one-time head, or
 * described by hand. It is billed on the next invoice, or now.
 */
export const chargeSchema = z
  .object({
    resident_id: uuid("Resident"),
    fee_head_id: optional(uuid("Charge")),
    description: optional(requiredText("Description", 200)),
    amount: rupees("Amount"),
    charge_date: notFuture("Date"),
  })
  .refine((charge) => charge.fee_head_id || charge.description, {
    error: "Describe the charge or choose one from the list",
    path: ["description"],
  });

/** `YYYY-MM` from `<input type="month">`, as `YYYY-MM-01`. */
const monthInput = (label: string) =>
  z
    .string({ error: `Choose ${label}` })
    .regex(/^\d{4}-(0[1-9]|1[0-2])$/, { error: `Choose ${label}` })
    .transform((value) => `${value}-01`);

/** A discount off rent or one charge, for a range of months (E13-T5). */
export const discountSchema = z
  .object({
    resident_id: uuid("Resident"),
    /** "rent", or the fee head it comes off. */
    target: z.union([z.literal("rent"), uuid("Charge")], { error: "Choose what it comes off" }),
    measure: z.enum(["percent", "fixed"], { error: "Choose a percentage or an amount" }),
    value: z.coerce.number({ error: "Enter a number" }).positive({ error: "Enter more than zero" }),
    from_month: monthInput("the first month"),
    to_month: optional(monthInput("the last month")),
    reason: requiredText("Reason", 200),
  })
  .refine((d) => d.measure !== "percent" || (Number.isInteger(d.value) && d.value <= 100), {
    error: "A percentage is a whole number up to 100",
    path: ["value"],
  })
  .refine(
    (d) => d.measure !== "fixed" || Math.abs(d.value * 100 - Math.round(d.value * 100)) < 1e-6,
    {
      error: "Amount can have at most 2 decimal places",
      path: ["value"],
    },
  )
  .refine((d) => !d.to_month || d.to_month >= d.from_month, {
    error: "The last month must not be before the first",
    path: ["to_month"],
  })
  .transform((d) => ({
    resident_id: d.resident_id,
    fee_head_id: d.target === "rent" ? null : d.target,
    percent: d.measure === "percent" ? d.value : null,
    amount: d.measure === "fixed" ? Math.round(d.value * 100) : null,
    from_month: d.from_month,
    to_month: d.to_month,
    reason: d.reason,
  }));

/** Ends a discount after a month. */
export const discountEndSchema = z.object({
  id: uuid("Discount"),
  resident_id: uuid("Resident"),
  to_month: monthInput("the last month"),
});

/** The hostel's late fee rule (E13-T6). */
export const lateFeeRuleSchema = z
  .object({
    grace_days: integer("Grace days", 0, 60),
    kind: z.enum(["fixed", "per_day"], { error: "Choose a fixed fee or a fee per day" }),
    amount: rupees("Fee", { max: 1_00_000 }),
    cap: optional(rupees("Most it can reach", { max: 1_00_000 })),
    active: z
      .literal("on")
      .optional()
      .transform((value) => value === "on"),
  })
  .refine((rule) => rule.kind === "fixed" || rule.cap !== null, {
    error: "Set the most a per-day fee can reach",
    path: ["cap"],
  })
  .refine((rule) => rule.cap === null || rule.cap >= rule.amount, {
    error: "The most it can reach must be at least the daily fee",
    path: ["cap"],
  })
  .transform((rule) => ({ ...rule, cap: rule.kind === "fixed" ? null : rule.cap }));

export type FeeStructureInput = z.output<typeof feeStructureSchema>;
export type GenerateInvoicesInput = z.output<typeof generateInvoicesSchema>;
export type PaymentInput = z.output<typeof paymentSchema>;
