import { z } from "zod";

import { PAYMENT_MODES } from "@/types";

import {
  indianMobile,
  integer,
  isoDate,
  optional,
  requiredText,
  rupees,
  todayIst,
  uuid,
} from "./fields";

/** Forms for complaints and maintenance (ClickUp EP-15). */

const checkbox = z
  .literal("on")
  .optional()
  .transform((value) => value === "on");

const PRIORITY = z.enum(["urgent", "high", "normal", "low"], { error: "Choose a priority" });
const TRADE = z.enum(
  ["electrician", "plumber", "carpenter", "cleaner", "technician", "pest_control", "general"],
  { error: "Choose a trade" },
);

/** One value or several (checkbox group), as an array. */
const many = <S extends z.ZodType>(schema: S) =>
  z.preprocess(
    (value) => (value === undefined ? [] : Array.isArray(value) ? value : [value]),
    z.array(schema),
  );

export const complaintSchema = z
  .object({
    location: z.enum(["room", "area"], { error: "Choose where the problem is" }),
    room_id: optional(uuid("Room")),
    bed_id: optional(uuid("Bed")),
    area: optional(requiredText("Area", 100)),
    resident_id: optional(uuid("Resident")),
    category_id: uuid("Category"),
    priority: PRIORITY,
    title: requiredText("What is wrong", 120),
    description: optional(requiredText("Details", 2000)),
    bed_maintenance: checkbox,
  })
  .refine((input) => input.location !== "room" || input.room_id !== null, {
    error: "Choose the room",
    path: ["room_id"],
  })
  .refine((input) => input.location !== "area" || input.area !== null, {
    error: "Name the area, e.g. Kitchen",
    path: ["area"],
  })
  .transform((input) => ({
    ...input,
    room_id: input.location === "room" ? input.room_id : null,
    bed_id: input.location === "room" ? input.bed_id : null,
    area: input.location === "area" ? input.area : null,
    bed_maintenance: input.location === "room" && input.bed_id !== null && input.bed_maintenance,
  }));

export const complaintStatusSchema = z.object({
  complaint_id: uuid("Complaint"),
  status: z.enum(["open", "assigned", "in_progress", "on_hold", "resolved", "closed", "reopened"], {
    error: "Choose a status",
  }),
  note: optional(requiredText("Note", 500)),
});

export const complaintAssignSchema = z.object({
  complaint_id: uuid("Complaint"),
  worker_id: optional(uuid("Worker")),
  note: optional(requiredText("Note", 500)),
});

export const complaintCommentSchema = z.object({
  complaint_id: uuid("Complaint"),
  body: requiredText("Comment", 2000),
});

export const complaintCostSchema = z.object({
  complaint_id: uuid("Complaint"),
  kind: z.enum(["labour", "material", "vendor_charge"], { error: "Choose what the cost is for" }),
  amount: rupees("Amount"),
  payer: z.enum(["hostel", "resident"], { error: "Choose who pays" }),
  description: optional(requiredText("Description", 200)),
});

export const complaintPayoutSchema = z.object({
  complaint_id: uuid("Complaint"),
  worker_id: uuid("Worker"),
  amount: rupees("Amount"),
  paid_at: isoDate("Date").refine((value) => value <= todayIst(), {
    error: "The date cannot be in the future",
  }),
  mode: z.enum([...PAYMENT_MODES, "cheque"], { error: "Choose how it was paid" }),
  reference: optional(requiredText("Reference", 100)),
});

export const workerSchema = z
  .object({
    worker_id: optional(uuid("Worker")),
    kind: z.enum(["on_site", "vendor"], { error: "Choose the kind of worker" }),
    hostel_id: uuid("Hostel"),
    full_name: requiredText("Name", 100),
    business_name: optional(requiredText("Business name", 100)),
    phone: indianMobile,
    trades: many(TRADE).refine((trades) => trades.length > 0, {
      error: "Choose at least one trade",
    }),
    call_out_charge: optional(rupees("Call-out charge", { positive: false })),
    notes: optional(requiredText("Notes", 500)),
    preferred: checkbox,
  })
  .transform((input) => ({ ...input, trades: [...new Set(input.trades)] }));

export const workerTimeOffSchema = z
  .object({
    worker_id: uuid("Worker"),
    from_date: isoDate("From"),
    to_date: isoDate("To"),
    reason: optional(requiredText("Reason", 200)),
  })
  .refine((input) => input.to_date >= input.from_date, {
    error: "The end date must be on or after the start",
    path: ["to_date"],
  });

export const complaintCategorySchema = z.object({
  category_id: optional(uuid("Category")),
  name: requiredText("Name", 60),
  trade: TRADE,
  auto_route: checkbox,
});

const respond = integer("Response target (hours)", 1, 720);
const resolve = integer("Fix target (hours)", 1, 2160);

/** Targets in hours per priority; stored in minutes. */
export const complaintTargetsSchema = z.object({
  respond_urgent: respond,
  resolve_urgent: resolve,
  respond_high: respond,
  resolve_high: resolve,
  respond_normal: respond,
  resolve_normal: resolve,
  respond_low: respond,
  resolve_low: resolve,
});

export const maintenanceScheduleSchema = z
  .object({
    title: requiredText("Task", 120),
    description: optional(requiredText("Details", 2000)),
    category_id: uuid("Category"),
    location: z.enum(["room", "area"], { error: "Choose where" }),
    room_id: optional(uuid("Room")),
    area: optional(requiredText("Area", 100)),
    priority: PRIORITY,
    every_n: integer("Every", 1, 365),
    unit: z.enum(["day", "week", "month"], { error: "Choose days, weeks or months" }),
    next_due: isoDate("First due"),
  })
  .refine((input) => input.location !== "room" || input.room_id !== null, {
    error: "Choose the room",
    path: ["room_id"],
  })
  .refine((input) => input.location !== "area" || input.area !== null, {
    error: "Name the area, e.g. Water tank",
    path: ["area"],
  })
  .transform((input) => ({
    ...input,
    room_id: input.location === "room" ? input.room_id : null,
    area: input.location === "area" ? input.area : null,
  }));
