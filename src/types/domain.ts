/**
 * Hand-written domain model for the Hostel/PG ERP.
 *
 * These types mirror the planned Postgres tables (EP-02 to EP-07) and are the
 * single description of each entity shared by server actions and the UI.
 *
 * Conventions:
 * - Ids are UUID strings.
 * - Timestamps are ISO-8601 strings (`timestamptz`); calendar dates are
 *   `YYYY-MM-DD` strings (`date`) so they never shift across time zones.
 * - Money is always an integer number of paise (1 INR = 100 paise). Never
 *   store or compute money as a floating-point rupee amount.
 * - Read models describe a row as selected. `*Insert` omits database-generated
 *   columns; `*Update` is a partial of the columns a user may change.
 */

// ---------------------------------------------------------------------------
// Primitives
// ---------------------------------------------------------------------------

export type Uuid = string;
/** ISO-8601 timestamp, e.g. `2026-10-06T09:30:00.000Z`. */
export type IsoTimestamp = string;
/** Calendar date, `YYYY-MM-DD`. */
export type IsoDate = string;
/** First day of a billing month, `YYYY-MM-01`. */
export type BillingMonth = IsoDate;

/**
 * Integer amount in paise (1 INR = 100 paise). The brand stops a plain number
 * (for example a rupee value from a form) being passed where paise are
 * expected; convert with `rupeesToPaise` / `paiseToRupees`.
 */
export type Paise = number & { readonly __unit: "paise" };

export function rupeesToPaise(rupees: number): Paise {
  return Math.round(rupees * 100) as Paise;
}

export function paiseToRupees(paise: Paise): number {
  return paise / 100;
}

/** Columns every table carries and the database fills in. */
type Generated = "id" | "created_at" | "updated_at";

// ---------------------------------------------------------------------------
// Enumerations (kept in sync with Postgres check constraints)
// ---------------------------------------------------------------------------

export const PROFILE_ROLES = ["owner", "staff", "platform_admin"] as const;
export type ProfileRole = (typeof PROFILE_ROLES)[number];

export const HOSTEL_TYPES = ["boys", "girls", "co_ed"] as const;
export type HostelType = (typeof HOSTEL_TYPES)[number];

/** States and union territories: one spelling, so addresses can be grouped. */
export const INDIAN_STATES = [
  "Andaman and Nicobar Islands",
  "Andhra Pradesh",
  "Arunachal Pradesh",
  "Assam",
  "Bihar",
  "Chandigarh",
  "Chhattisgarh",
  "Dadra and Nagar Haveli and Daman and Diu",
  "Delhi",
  "Goa",
  "Gujarat",
  "Haryana",
  "Himachal Pradesh",
  "Jammu and Kashmir",
  "Jharkhand",
  "Karnataka",
  "Kerala",
  "Ladakh",
  "Lakshadweep",
  "Madhya Pradesh",
  "Maharashtra",
  "Manipur",
  "Meghalaya",
  "Mizoram",
  "Nagaland",
  "Odisha",
  "Puducherry",
  "Punjab",
  "Rajasthan",
  "Sikkim",
  "Tamil Nadu",
  "Telangana",
  "Tripura",
  "Uttar Pradesh",
  "Uttarakhand",
  "West Bengal",
] as const;

export type IndianState = (typeof INDIAN_STATES)[number];

export const HOSTEL_STATUSES = ["draft", "active", "suspended"] as const;
export type HostelStatus = (typeof HOSTEL_STATUSES)[number];

export const SHARING_TYPES = ["single", "double", "triple", "four_plus"] as const;
export type SharingType = (typeof SHARING_TYPES)[number];

export const ROOM_STATUSES = ["active", "archived"] as const;
export type RoomStatus = (typeof ROOM_STATUSES)[number];

/**
 * The status column on `beds` holds only manual states. `occupied` is never
 * stored: it is derived from a live allocation, so it cannot drift.
 */
export const MANUAL_BED_STATUSES = ["available", "blocked", "maintenance"] as const;
export type ManualBedStatus = (typeof MANUAL_BED_STATUSES)[number];
/** Status as displayed: the stored state, or `occupied` when a live allocation exists. */
export const BED_STATUSES = [...MANUAL_BED_STATUSES, "occupied"] as const;
export type BedStatus = (typeof BED_STATUSES)[number];

export const GENDERS = ["male", "female", "other"] as const;
export type Gender = (typeof GENDERS)[number];

export const ID_PROOF_TYPES = [
  "aadhaar",
  "pan",
  "passport",
  "driving_licence",
  "voter_id",
] as const;
export type IdProofType = (typeof ID_PROOF_TYPES)[number];

export const RESIDENT_STATUSES = ["active", "notice", "vacated", "blocked"] as const;
export type ResidentStatus = (typeof RESIDENT_STATUSES)[number];

export const VACATE_REASONS = ["moved_out", "transferred", "evicted", "other"] as const;
export type VacateReason = (typeof VACATE_REASONS)[number];

/**
 * Stored invoice status: only whether it was voided. Paid, partial, unpaid
 * and overdue are derived from payments and due_date at read time, in a
 * `security_invoker` view, so they never need to be kept in sync.
 */
export const INVOICE_STATUSES = ["issued", "void"] as const;
export type InvoiceStatus = (typeof INVOICE_STATUSES)[number];
export const INVOICE_DUE_STATUSES = ["unpaid", "partial", "paid", "overdue"] as const;
export type InvoiceDueStatus = (typeof INVOICE_DUE_STATUSES)[number];

export const FEE_HEAD_BILLINGS = ["monthly", "one_time"] as const;
export type FeeHeadBilling = (typeof FEE_HEAD_BILLINGS)[number];
export const FEE_HEAD_PRICINGS = ["flat", "per_sharing"] as const;
export type FeeHeadPricing = (typeof FEE_HEAD_PRICINGS)[number];

export const INVOICE_LINE_KINDS = ["rent", "fee", "charge", "discount", "late_fee"] as const;
export type InvoiceLineKind = (typeof INVOICE_LINE_KINDS)[number];

/** One line of an invoice; the lines add up to the invoice amount. */
export interface InvoiceLine {
  position: number;
  kind: InvoiceLineKind;
  description: string;
  /** Negative only for discounts. */
  amount: Paise;
  detail: { nights?: number; monthly_rate?: Paise; stays?: StayBreakdown[] };
}

/** Modes a person records money in. */
export const PAYMENT_MODES = ["cash", "upi", "bank_transfer", "card"] as const;
export type RecordablePaymentMode = (typeof PAYMENT_MODES)[number];
/** Modes a payment against an invoice can take: also a cheque (E13-T11). */
export const INVOICE_PAYMENT_MODES = [...PAYMENT_MODES, "cheque"] as const;
export type InvoicePaymentMode = (typeof INVOICE_PAYMENT_MODES)[number];
/**
 * Every mode a payment row can carry: also credit and deposit money applied
 * to an invoice by the database (E13-T7, E13-T4).
 */
export type PaymentMode = InvoicePaymentMode | "credit" | "deposit";

// ---------------------------------------------------------------------------
// Profile (EP-02) - id equals auth.users.id
// ---------------------------------------------------------------------------

export interface Profile {
  id: Uuid;
  full_name: string;
  phone: string | null;
  role: ProfileRole;
  /** Hostel a staff member belongs to. Null for owners and platform admins. */
  hostel_id: Uuid | null;
  created_at: IsoTimestamp;
  updated_at: IsoTimestamp;
}

/** Profiles are created by a trigger on signup; only these fields change. */
export type ProfileUpdate = Partial<Pick<Profile, "full_name" | "phone">>;

// ---------------------------------------------------------------------------
// Hostel (EP-03)
// ---------------------------------------------------------------------------

export interface Hostel {
  id: Uuid;
  owner_id: Uuid;
  name: string;
  /** Platform-wide unique, URL-safe identifier. */
  slug: string;
  type: HostelType;
  phone: string;
  alt_phone: string | null;
  email: string | null;
  address: string | null;
  city: string | null;
  state: string | null;
  /** Six-digit Indian PIN code. */
  pincode: string | null;
  gstin: string | null;
  floors: number | null;
  status: HostelStatus;
  created_at: IsoTimestamp;
  updated_at: IsoTimestamp;
}

export type HostelInsert = Omit<Hostel, Generated | "status" | "slug"> &
  Partial<Pick<Hostel, "status" | "slug">>;

/** Identity fields (owner, slug) are never editable. */
export type HostelUpdate = Partial<Omit<Hostel, Generated | "owner_id" | "slug">>;

// ---------------------------------------------------------------------------
// Room and Bed (EP-04)
// ---------------------------------------------------------------------------

export interface Room {
  id: Uuid;
  hostel_id: Uuid;
  floor: number;
  /** Normalised: trimmed and upper-cased, unique within a hostel. */
  room_number: string;
  sharing_type: SharingType;
  capacity: number;
  status: RoomStatus;
  created_at: IsoTimestamp;
  updated_at: IsoTimestamp;
}

export type RoomInsert = Omit<Room, Generated | "status"> & Partial<Pick<Room, "status">>;

export type RoomUpdate = Partial<Pick<Room, "floor" | "sharing_type" | "capacity" | "status">>;

export interface Bed {
  id: Uuid;
  hostel_id: Uuid;
  room_id: Uuid;
  /** Stable label, e.g. `101-A`. Unique within a room. */
  bed_label: string;
  /** Stored manual state only; see `BedStatus` for the derived display state. */
  status: ManualBedStatus;
  status_reason: string | null;
  status_changed_by: Uuid | null;
  status_changed_at: IsoTimestamp | null;
  /** Set when capacity is reduced; beds with allocation history are retired, never deleted. */
  archived_at: IsoTimestamp | null;
  created_at: IsoTimestamp;
  updated_at: IsoTimestamp;
}

/** Beds are generated from room capacity; users only block/unblock them. */
export interface BedStatusUpdate {
  status: ManualBedStatus;
  status_reason?: string | null;
}

// ---------------------------------------------------------------------------
// Resident (EP-05)
// ---------------------------------------------------------------------------

export interface Resident {
  id: Uuid;
  hostel_id: Uuid;
  full_name: string;
  /** Normalised 10-digit Indian mobile number. */
  phone: string;
  alt_phone: string | null;
  email: string | null;
  gender: Gender;
  dob: IsoDate;
  id_proof_type: IdProofType;
  /**
   * The full ID number is never stored (Aadhaar rules forbid it outside a
   * vault). We keep the last 4 characters for display and a keyed HMAC of the
   * normalised number for duplicate detection.
   */
  id_proof_last4: string;
  id_proof_hash: string;
  /** Storage object path inside the private ID-proof bucket. */
  id_proof_path: string | null;
  guardian_name: string | null;
  guardian_phone: string | null;
  permanent_address: string;
  joining_date: IsoDate;
  status: ResidentStatus;
  status_changed_by: Uuid | null;
  status_changed_at: IsoTimestamp | null;
  notes: string | null;
  created_by: Uuid | null;
  created_at: IsoTimestamp;
  updated_at: IsoTimestamp;
}

export type ResidentInsert = Omit<
  Resident,
  Generated | "status" | "id_proof_path" | "status_changed_by" | "status_changed_at" | "created_by"
> &
  Partial<Pick<Resident, "status" | "id_proof_path">>;

/** Status moves through its own lifecycle action, not a generic update. */
export type ResidentUpdate = Partial<Omit<Resident, Generated | "hostel_id" | "status">>;

// ---------------------------------------------------------------------------
// Allocation (EP-06)
// ---------------------------------------------------------------------------

export interface Allocation {
  id: Uuid;
  hostel_id: Uuid;
  resident_id: Uuid;
  bed_id: Uuid;
  room_id: Uuid;
  start_date: IsoDate;
  /**
   * Last night in the bed; null while open-ended. An allocation is live when
   * `start_date <= today (IST)` and `end_date` is null or `>= today`. There is
   * no stored status column, so liveness can never disagree with the dates.
   */
  end_date: IsoDate | null;
  vacate_reason: VacateReason | null;
  /**
   * Negotiated rent for this resident. Rent precedence is: this override, then
   * the hostel fee structure for the room's sharing type effective that month.
   */
  rent_override: Paise | null;
  created_by: Uuid;
  created_at: IsoTimestamp;
  updated_at: IsoTimestamp;
}

export type AllocationInsert = Pick<
  Allocation,
  "hostel_id" | "resident_id" | "bed_id" | "room_id" | "start_date" | "created_by"
> &
  Partial<Pick<Allocation, "rent_override">>;

/** Allocations are only ever closed, never edited. */
export interface AllocationVacate {
  end_date: IsoDate;
  vacate_reason: VacateReason;
}

// ---------------------------------------------------------------------------
// Fees (EP-07)
// ---------------------------------------------------------------------------

export interface FeeStructure {
  id: Uuid;
  hostel_id: Uuid;
  sharing_type: SharingType;
  monthly_amount: Paise;
  effective_from: IsoDate;
  /** Last day the rate applies. Null while it is the current rate. */
  effective_to: IsoDate | null;
  created_by: Uuid | null;
  created_at: IsoTimestamp;
  updated_at: IsoTimestamp;
}

/** Rates are set through `set_fee_structure`, which closes the previous rate. */
export type FeeStructureInsert = Pick<
  FeeStructure,
  "hostel_id" | "sharing_type" | "monthly_amount" | "effective_from"
>;

/** One stay's share of an invoice's rent: its nights in the month at its rate. */
export interface StayBreakdown {
  allocation_id: Uuid;
  room_number: string;
  bed_label: string;
  sharing_type: SharingType;
  from: IsoDate;
  to: IsoDate;
  nights: number;
  monthly_rate: Paise;
  rate_source: "override" | "structure";
}

export interface Invoice {
  id: Uuid;
  hostel_id: Uuid;
  resident_id: Uuid;
  allocation_id: Uuid | null;
  period_month: BillingMonth;
  amount: Paise;
  due_date: IsoDate;
  status: InvoiceStatus;
  void_reason: string | null;
  voided_at: IsoTimestamp | null;
  voided_by: Uuid | null;
  /** How the rent was reached; see `StayBreakdown`. */
  breakdown: StayBreakdown[];
  created_by: Uuid | null;
  created_at: IsoTimestamp;
  updated_at: IsoTimestamp;
}

/** Invoices are generated, never hand-edited; due status derives from payments. */
export type InvoiceInsert = Omit<
  Invoice,
  Generated | "status" | "void_reason" | "voided_at" | "voided_by" | "created_by"
>;

export interface Payment {
  id: Uuid;
  hostel_id: Uuid;
  invoice_id: Uuid;
  amount: Paise;
  paid_at: IsoDate;
  mode: PaymentMode;
  reference: string | null;
  recorded_by: Uuid;
  /** A mistaken payment is reversed by voiding it, never by editing or deleting. */
  voided_at: IsoTimestamp | null;
  void_reason: string | null;
  voided_by: Uuid | null;
  created_at: IsoTimestamp;
}

/** Payments are append-only: there is no update variant beyond voiding. */
export type PaymentInsert = Omit<
  Payment,
  "id" | "created_at" | "voided_at" | "void_reason" | "voided_by" | "recorded_by"
>;

// ---------------------------------------------------------------------------
// Read models (security_invoker views)
// ---------------------------------------------------------------------------

/**
 * Generated view types mark every column nullable because Postgres cannot
 * prove otherwise. Use this for views whose columns are known to be set.
 */
export type ViewRow<T> = { [K in keyof T]-?: NonNullable<T[K]> };

// ---------------------------------------------------------------------------
// Complaints and maintenance (EP-15)
// ---------------------------------------------------------------------------

export const COMPLAINT_STATUSES = [
  "open",
  "assigned",
  "in_progress",
  "on_hold",
  "resolved",
  "closed",
  "reopened",
] as const;
export type ComplaintStatus = (typeof COMPLAINT_STATUSES)[number];

/** Where each status may go next; the database enforces the same paths. */
export const COMPLAINT_NEXT_STATUSES: Record<ComplaintStatus, readonly ComplaintStatus[]> = {
  open: ["assigned", "in_progress", "on_hold", "resolved", "closed"],
  assigned: ["open", "in_progress", "on_hold", "resolved", "closed"],
  in_progress: ["assigned", "on_hold", "resolved", "closed"],
  on_hold: ["open", "assigned", "in_progress", "closed"],
  resolved: ["closed", "reopened"],
  closed: ["reopened"],
  reopened: ["assigned", "in_progress", "on_hold", "resolved", "closed"],
};

export const COMPLAINT_PRIORITIES = ["urgent", "high", "normal", "low"] as const;
export type ComplaintPriority = (typeof COMPLAINT_PRIORITIES)[number];

export const TRADES = [
  "electrician",
  "plumber",
  "carpenter",
  "cleaner",
  "technician",
  "pest_control",
  "general",
] as const;
export type Trade = (typeof TRADES)[number];

export const WORKER_KINDS = ["on_site", "vendor"] as const;
export type WorkerKind = (typeof WORKER_KINDS)[number];

export type ComplaintTargetState = "on_track" | "due_soon" | "overdue" | "paused" | "done";

export const MAINTENANCE_UNITS = ["day", "week", "month"] as const;
export type MaintenanceUnit = (typeof MAINTENANCE_UNITS)[number];

export const PAYOUT_MODES = ["cash", "upi", "bank_transfer", "cheque"] as const;
export type PayoutMode = (typeof PAYOUT_MODES)[number];
