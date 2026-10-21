import { z } from "zod";

import {
  GENDERS,
  HOSTEL_TYPES,
  ID_PROOF_TYPES,
  INDIAN_STATES,
  MANUAL_BED_STATUSES,
  DEPOSIT_ENTRY_KINDS,
  PAYMENT_MODES,
  RENT_PAYMENT_MODES,
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
  accept_terms: z.literal("on", { error: "Agree to the terms to create an account" }),
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

/**
 * A security deposit taken when the bed is given (ClickUp E13-T4). Both
 * fields or neither.
 */
export const depositAtAllocationSchema = z
  .object({
    deposit_amount: optional(rupees("Deposit")),
    deposit_mode: optional(z.enum(PAYMENT_MODES, { error: "Choose a payment mode" })),
  })
  .refine((input) => input.deposit_amount === null || input.deposit_mode !== null, {
    error: "Choose how the deposit was paid",
    path: ["deposit_mode"],
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

/** Any month typed into `<input type="month">`, future ones included, as `YYYY-MM-01`. */
export function billingMonthAny(label: string) {
  return z
    .string({ error: `Choose ${label.toLowerCase()}` })
    .regex(/^\d{4}-(0[1-9]|1[0-2])$/, { error: `Choose ${label.toLowerCase()}` })
    .transform((value) => `${value}-01`);
}

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
    mode: z.enum(RENT_PAYMENT_MODES, { error: "Choose a payment mode" }),
    reference: optional(requiredText("Reference", 100)),
    cheque_number: optional(requiredText("Cheque number", 20)),
    cheque_bank: optional(requiredText("Bank", 100)),
  })
  .refine((payment) => payment.paid_at <= todayIst(), {
    error: "Payment date cannot be in the future",
    path: ["paid_at"],
  })
  .refine((payment) => payment.mode !== "cheque" || payment.cheque_number !== null, {
    error: "Enter the cheque number",
    path: ["cheque_number"],
  })
  .refine((payment) => payment.mode !== "cheque" || payment.cheque_bank !== null, {
    error: "Enter the bank",
    path: ["cheque_bank"],
  });

/** An advance, or a refund of credit (ClickUp E13-T7). */
export const creditEntrySchema = z.object({
  resident_id: uuid("Resident"),
  kind: z.enum(["advance", "refund"], { error: "Choose advance or refund" }),
  amount: rupees("Amount"),
  entry_date: isoDate("Date").refine((value) => value <= todayIst(), {
    error: "The date cannot be in the future",
  }),
  mode: z.enum(PAYMENT_MODES, { error: "Choose a payment mode" }),
  reference: optional(requiredText("Reference", 100)),
});

export const LATE_FEE_MODES = ["off", "fixed", "per_day"] as const;
export type LateFeeMode = (typeof LATE_FEE_MODES)[number];

/**
 * The hostel's late-fee rule (ClickUp E13-T6). Amounts only matter when the
 * rule is on, and a cap only for a per-day fee.
 */
export const lateFeeRuleSchema = z
  .object({
    late_fee_mode: z.enum(LATE_FEE_MODES, { error: "Choose how late fees work" }),
    late_fee_amount: optional(rupees("Late fee", { max: 1_00_000 })),
    late_fee_cap: optional(rupees("Most per invoice", { max: 1_00_000 })),
    late_fee_grace_days: integer("Grace days", 0, 28),
  })
  .superRefine((rule, ctx) => {
    if (rule.late_fee_mode === "off") return;
    if (rule.late_fee_amount === null) {
      ctx.addIssue({ code: "custom", message: "Enter the late fee", path: ["late_fee_amount"] });
    }
    if (rule.late_fee_mode !== "per_day") return;
    if (rule.late_fee_cap === null) {
      ctx.addIssue({
        code: "custom",
        message: "Enter the most a late fee can reach",
        path: ["late_fee_cap"],
      });
    } else if (rule.late_fee_amount !== null && rule.late_fee_cap < rule.late_fee_amount) {
      ctx.addIssue({
        code: "custom",
        message: "The most per invoice cannot be less than the fee per day",
        path: ["late_fee_cap"],
      });
    }
  });

export type LateFeeRuleInput = z.output<typeof lateFeeRuleSchema>;

// ---------------------------------------------------------------------------
// Fee heads, charges, discounts and electricity (ClickUp E13-T1/2/3/5)
// ---------------------------------------------------------------------------

export const feeHeadSchema = z.object({
  name: requiredText("Name", 60),
  kind: z.enum(["monthly", "one_time"], { error: "Choose monthly or one-time" }),
  on_first_allocation: z
    .enum(["on"])
    .optional()
    .transform((value) => value === "on"),
});

export const feeHeadPriceSchema = z.object({
  head_id: uuid("Charge"),
  // Empty means one price for every sharing type.
  sharing_type: optional(z.enum(SHARING_TYPES, { error: "Choose a sharing type" })),
  amount: rupees("Amount"),
  effective_from: isoDate("Applies from"),
});

export const chargeSchema = z.object({
  resident_id: uuid("Resident"),
  head_id: optional(uuid("Charge type")),
  description: requiredText("Description", 200),
  amount: rupees("Amount"),
  charge_date: isoDate("Date"),
});

export const discountSchema = z
  .object({
    resident_id: uuid("Resident"),
    // Empty means rent.
    head_id: optional(uuid("Applies to")),
    kind: z.enum(["percent", "fixed"], { error: "Choose percentage or fixed amount" }),
    value: z.string({ error: "Enter the discount" }).trim().min(1, { error: "Enter the discount" }),
    from_month: billingMonthAny("From"),
    to_month: optional(billingMonthAny("Until")),
    reason: requiredText("Reason", 500),
  })
  .transform((input, ctx) => {
    let value: number;
    if (input.kind === "percent") {
      value = Number(input.value);
      if (!Number.isInteger(value) || value < 1 || value > 100) {
        ctx.addIssue({
          code: "custom",
          message: "Enter a whole percentage from 1 to 100",
          path: ["value"],
        });
        return z.NEVER;
      }
    } else {
      const parsed = rupees("Discount").safeParse(input.value);
      if (!parsed.success) {
        ctx.addIssue({ code: "custom", message: parsed.error.issues[0].message, path: ["value"] });
        return z.NEVER;
      }
      value = parsed.data;
    }
    if (input.to_month && input.to_month < input.from_month) {
      ctx.addIssue({
        code: "custom",
        message: "Until must be on or after From",
        path: ["to_month"],
      });
      return z.NEVER;
    }
    return { ...input, value };
  });

export const meterReadingSchema = z.object({
  room_id: uuid("Room"),
  reading_month: billingMonth,
  reading: z.coerce
    .number({ error: "Enter the meter reading" })
    .refine((value) => Number.isFinite(value) && value >= 0 && value < 1e10, {
      error: "Enter the meter reading",
    })
    .refine((value) => Math.abs(value * 10 - Math.round(value * 10)) < 1e-6, {
      error: "At most one decimal place",
    }),
});

export const electricityRateSchema = z.object({
  electricity_unit_rate: optional(rupees("Price per unit", { max: 100 })),
});
export type FeeStructureInput = z.output<typeof feeStructureSchema>;
export type GenerateInvoicesInput = z.output<typeof generateInvoicesSchema>;
export type PaymentInput = z.output<typeof paymentSchema>;

// ---------------------------------------------------------------------------
// Staff (EP-12)
// ---------------------------------------------------------------------------

export const staffInviteSchema = z.object({
  full_name: requiredText("Name", 120),
  email,
});

/** Accepting an invitation: the staff member chooses their own password. */
export const acceptInvitationSchema = resetPasswordSchema;

export type StaffInviteInput = z.output<typeof staffInviteSchema>;

// ---------------------------------------------------------------------------
// Security deposits (EP-12)
// ---------------------------------------------------------------------------

/**
 * One deposit ledger entry. Collections and refunds move money, so they
 * need a mode; a deduction moves none but always says why.
 */
export const depositEntrySchema = z
  .object({
    resident_id: uuid("Resident"),
    kind: z.enum(DEPOSIT_ENTRY_KINDS, { error: "Choose what happened to the deposit" }),
    amount: rupees("Amount"),
    entry_date: isoDate("Date"),
    mode: optional(z.enum(PAYMENT_MODES, { error: "Choose a payment mode" })),
    reference: optional(requiredText("Reference", 100)),
    reason: optional(requiredText("Reason", 500)),
  })
  .refine((entry) => entry.entry_date <= todayIst(), {
    error: "The date cannot be in the future",
    path: ["entry_date"],
  })
  .refine((entry) => entry.kind === "deduction" || entry.mode !== null, {
    error: "Choose a payment mode",
    path: ["mode"],
  })
  .refine((entry) => entry.kind !== "deduction" || entry.reason !== null, {
    error: "Say why the amount is being kept",
    path: ["reason"],
  })
  // A deduction moves no money, so any mode or reference sent is dropped.
  .transform((entry) =>
    entry.kind === "deduction" ? { ...entry, mode: null, reference: null } : entry,
  );

export type DepositEntryInput = z.output<typeof depositEntrySchema>;

/** How many deduction rows the move-out settlement form offers (E13-T8). */
export const SETTLEMENT_DEDUCTION_ROWS = 3;

const checkbox = z
  .literal("on")
  .optional()
  .transform((value) => value === "on");

/**
 * Move-out settlement (E13-T8): deductions from the deposit (each with a
 * reason), whether to re-bill the final month and let the deposit pay dues,
 * and how any refund is paid.
 */
export const settlementSchema = z
  .object({
    allocation_id: uuid("Stay"),
    deduction_amount_1: optional(rupees("Deduction")),
    deduction_reason_1: optional(requiredText("Reason", 200)),
    deduction_amount_2: optional(rupees("Deduction")),
    deduction_reason_2: optional(requiredText("Reason", 200)),
    deduction_amount_3: optional(rupees("Deduction")),
    deduction_reason_3: optional(requiredText("Reason", 200)),
    rebill: checkbox,
    use_deposit: checkbox,
    refund_mode: optional(z.enum(PAYMENT_MODES, { error: "Choose how the refund is paid" })),
    refund_reference: optional(requiredText("Reference", 100)),
  })
  .superRefine((input, context) => {
    for (const row of [1, 2, 3] as const) {
      const amount = input[`deduction_amount_${row}`];
      const reason = input[`deduction_reason_${row}`];
      if (amount !== null && reason === null) {
        context.addIssue({
          code: "custom",
          message: "Say what this is for",
          path: [`deduction_reason_${row}`],
        });
      }
      if (amount === null && reason !== null) {
        context.addIssue({
          code: "custom",
          message: "Enter the amount",
          path: [`deduction_amount_${row}`],
        });
      }
    }
  })
  .transform((input) => ({
    allocation_id: input.allocation_id,
    deductions: ([1, 2, 3] as const).flatMap((row) => {
      const amount = input[`deduction_amount_${row}`];
      const reason = input[`deduction_reason_${row}`];
      return amount !== null && reason !== null ? [{ amount, reason }] : [];
    }),
    rebill: input.rebill,
    use_deposit: input.use_deposit,
    refund_mode: input.refund_mode,
    refund_reference: input.refund_reference,
  }));
