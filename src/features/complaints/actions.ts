"use server";

import type { PostgrestError } from "@supabase/supabase-js";
import { revalidatePath } from "next/cache";
import { after } from "next/server";
import { redirect } from "next/navigation";

import { AuthorizationError } from "@/lib/auth/roles";
import { requireRole } from "@/lib/auth/session";
import { checkComplaintFile } from "@/lib/complaints/file-type";
import { getHostelContext } from "@/lib/hostels/active";
import { formatPaise } from "@/lib/money";
import { logUnexpected, unexpectedFailure } from "@/lib/request-context";
import { deliverOutboxQuietly } from "@/lib/outbox/deliver";
import { createClient } from "@/lib/supabase/server";
import {
  complaintAssignSchema,
  complaintCategorySchema,
  complaintCommentSchema,
  complaintCostsSchema,
  complaintSchema,
  complaintStatusSchema,
  complaintTargetSchema,
  complaintUpdateSchema,
  formFailure,
  formSuccess,
  formValues,
  maintenanceScheduleSchema,
  uuid,
  validateFormData,
  vendorPayoutSchema,
  workerSchema,
  workerUnavailableSchema,
  type FormState,
} from "@/lib/validation";
import { COMPLAINT_PRIORITIES, type ComplaintPriority } from "@/types";

import { COMPLAINT_STATUS_LABELS, PRIORITY_LABELS } from "./options";

const NO_HOSTEL = "Finish setting up your hostel first.";
const NOT_FOUND = "This complaint could not be found. Refresh the page.";
const BUCKET = "complaint-files";

/**
 * Plain-language messages for the rules the complaint functions enforce.
 * They raise P0001 with one of these hints.
 */
const RULE_MESSAGES: Record<string, string> = {
  attachment_limit: "This complaint already has as many photos or videos as it can take.",
  bed_occupied:
    "Someone sleeps in that bed, so it cannot be taken out of service. Untick that box, or move them first.",
  comment_required: "Write a comment.",
  complaint_bed: "That bed is not in the chosen room.",
  complaint_category: "Choose a category.",
  complaint_cost_billed:
    "The resident has already been billed for this repair. Void that invoice first to change it.",
  complaint_cost_zero: "Enter what the repair cost before charging the resident.",
  complaint_finished: "This complaint is finished. Reopen it first.",
  complaint_payer: "Choose the resident who pays.",
  complaint_worker: "Choose someone who works for this hostel.",
  job_link_no_worker: "Assign a worker first.",
  payment_amount: "Enter an amount.",
  payment_future: "A payment date cannot be in the future.",
  reason_required: "Give a reason.",
  worker_hostel_owner: "A worker can only serve your own hostels.",
  range_reversed: "The start date must be on or before the end date.",
  range_too_long: "Choose a range of two years or less.",
};

/** Rules whose database message already says exactly what went wrong. */
const SELF_EXPLAINING_HINTS = new Set(["complaint_transition"]);

function ruleMessage(error: PostgrestError): string | null {
  if (error.code !== "P0001" || !error.hint) return null;
  if (SELF_EXPLAINING_HINTS.has(error.hint)) return `${error.message}.`;
  return RULE_MESSAGES[error.hint] ?? null;
}

/** A rule the user can act on, or a logged failure with the generic message. */
async function failure(action: string, error: PostgrestError, values?: Record<string, string>) {
  const message = ruleMessage(error);
  return message ? formFailure(message, values) : unexpectedFailure(action, error, values);
}

function authorizationFailure(error: unknown, values?: Record<string, string>): FormState {
  if (error instanceof AuthorizationError) return formFailure(error.message, values);
  throw error;
}

async function activeHostelId(): Promise<string | null> {
  return (await getHostelContext()).active?.id ?? null;
}

/** Every screen that shows complaints. */
function revalidateComplaints(complaintId?: string) {
  revalidatePath("/complaints");
  if (complaintId) revalidatePath(`/complaints/${complaintId}`);
  revalidatePath("/dashboard");
  // A change may have queued an SMS to the resident (E15-T4): send it now
  // rather than waiting for the scheduled delivery.
  after(deliverOutboxQuietly);
}

// ---------------------------------------------------------------------------
// Raising and managing complaints (E15-T2)
// ---------------------------------------------------------------------------

const RAISE_FIELDS = [
  "category_id",
  "priority",
  "title",
  "description",
  "place",
  "room_id",
  "bed_id",
  "area",
  "resident_id",
  "bed_maintenance",
] as const;

export async function raiseComplaint(_previous: FormState, formData: FormData): Promise<FormState> {
  const values = formValues(formData, RAISE_FIELDS);
  try {
    await requireRole(["owner", "staff"]);
  } catch (error) {
    return authorizationFailure(error, values);
  }

  const parsed = validateFormData(complaintSchema, formData);
  if (!parsed.ok) return formFailure(undefined, values, parsed.fieldErrors);
  const hostelId = await activeHostelId();
  if (!hostelId) return formFailure(NO_HOSTEL, values);

  const input = parsed.data;
  const inRoom = input.place === "room";
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("raise_complaint", {
    p_hostel_id: hostelId,
    p_category_id: input.category_id,
    p_title: input.title,
    p_description: input.description ?? undefined,
    p_priority: input.priority,
    p_room_id: inRoom ? (input.room_id ?? undefined) : undefined,
    p_bed_id: inRoom ? (input.bed_id ?? undefined) : undefined,
    p_area: inRoom ? undefined : (input.area ?? undefined),
    p_resident_id: input.resident_id ?? undefined,
    p_bed_maintenance: inRoom && Boolean(input.bed_id) && input.bed_maintenance,
  });
  if (error) return failure("raiseComplaint", error, values);

  revalidateComplaints();
  if (inRoom && input.room_id) revalidatePath(`/rooms/${input.room_id}`);
  if (input.resident_id) revalidatePath(`/residents/${input.resident_id}`);
  redirect(`/complaints/${data}?raised=1`);
}

export async function changeComplaintStatus(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  const values = formValues(formData, ["note"]);
  try {
    await requireRole(["owner", "staff"]);
  } catch (error) {
    return authorizationFailure(error, values);
  }
  const parsed = validateFormData(complaintStatusSchema, formData);
  if (!parsed.ok) return formFailure(undefined, values, parsed.fieldErrors);

  const supabase = await createClient();
  const { error } = await supabase.rpc("set_complaint_status", {
    p_complaint_id: parsed.data.id,
    p_status: parsed.data.status,
    p_note: parsed.data.note ?? undefined,
  });
  if (error) return failure("changeComplaintStatus", error, values);

  revalidateComplaints(parsed.data.id);
  return formSuccess(
    `Complaint marked ${COMPLAINT_STATUS_LABELS[parsed.data.status].toLowerCase()}.`,
  );
}

export async function assignComplaint(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  try {
    await requireRole(["owner", "staff"]);
  } catch (error) {
    return authorizationFailure(error);
  }
  const parsed = validateFormData(complaintAssignSchema, formData);
  if (!parsed.ok) return formFailure(undefined, undefined, parsed.fieldErrors);

  const supabase = await createClient();
  const { error } = await supabase.rpc("assign_complaint", {
    p_complaint_id: parsed.data.id,
    p_worker_id: parsed.data.worker_id ?? undefined,
  });
  if (error) return failure("assignComplaint", error);

  revalidateComplaints(parsed.data.id);
  return formSuccess(parsed.data.worker_id ? "Worker assigned." : "Worker removed.");
}

/** Runs automatic routing again, for a complaint that found nobody before. */
export async function routeComplaint(_previous: FormState, formData: FormData): Promise<FormState> {
  try {
    await requireRole(["owner", "staff"]);
  } catch (error) {
    return authorizationFailure(error);
  }
  const id = uuid("Complaint").safeParse(formData.get("id"));
  if (!id.success) return formFailure(NOT_FOUND);

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("route_complaint", { p_complaint_id: id.data });
  if (error) return failure("routeComplaint", error);

  revalidateComplaints(id.data);
  return data
    ? formSuccess("A worker was found and assigned.")
    : formFailure("Nobody with that trade is available. Assign someone by hand.");
}

export async function commentOnComplaint(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  const values = formValues(formData, ["note"]);
  try {
    await requireRole(["owner", "staff"]);
  } catch (error) {
    return authorizationFailure(error, values);
  }
  const parsed = validateFormData(complaintCommentSchema, formData);
  if (!parsed.ok) return formFailure(undefined, values, parsed.fieldErrors);

  const supabase = await createClient();
  const { error } = await supabase.rpc("comment_complaint", {
    p_complaint_id: parsed.data.id,
    p_note: parsed.data.note,
  });
  if (error) return failure("commentOnComplaint", error, values);

  revalidateComplaints(parsed.data.id);
  return formSuccess("Comment added.");
}

export async function updateComplaint(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  try {
    await requireRole(["owner", "staff"]);
  } catch (error) {
    return authorizationFailure(error);
  }
  const parsed = validateFormData(complaintUpdateSchema, formData);
  if (!parsed.ok) return formFailure(undefined, undefined, parsed.fieldErrors);

  const supabase = await createClient();
  const { error } = await supabase.rpc("update_complaint", {
    p_complaint_id: parsed.data.id,
    p_priority: parsed.data.priority,
    p_share_resident_phone: parsed.data.share_resident_phone,
  });
  if (error) return failure("updateComplaint", error);

  revalidateComplaints(parsed.data.id);
  return formSuccess(`Priority is ${PRIORITY_LABELS[parsed.data.priority].toLowerCase()}.`);
}

// ---------------------------------------------------------------------------
// Attachments (E15-T5)
// ---------------------------------------------------------------------------

export async function uploadComplaintFile(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  try {
    await requireRole(["owner", "staff"]);
  } catch (error) {
    return authorizationFailure(error);
  }
  const id = uuid("Complaint").safeParse(formData.get("id"));
  const hostelId = await activeHostelId();
  if (!id.success || !hostelId) return formFailure(NOT_FOUND);

  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) {
    return formFailure(undefined, undefined, { file: ["Choose a photo or video"] });
  }
  const bytes = new Uint8Array(await file.arrayBuffer());
  const checked = checkComplaintFile(bytes);
  if (!checked.ok) return formFailure(undefined, undefined, { file: [checked.error] });

  // Storage policies accept only <hostel>/<complaint>/... for a complaint of
  // a hostel the user belongs to.
  const supabase = await createClient();
  const path = `${hostelId}/${id.data}/${crypto.randomUUID()}.${checked.type.ext}`;
  const { error: uploadError } = await supabase.storage
    .from(BUCKET)
    .upload(path, bytes, { contentType: checked.type.mime, upsert: false });
  if (uploadError) {
    await logUnexpected("uploadComplaintFile", uploadError);
    return formFailure("The file could not be uploaded. Try again.");
  }

  const { error } = await supabase.rpc("add_complaint_attachment", {
    p_complaint_id: id.data,
    p_path: path,
    p_kind: checked.type.kind,
  });
  if (error) {
    await supabase.storage.from(BUCKET).remove([path]);
    return failure("uploadComplaintFile", error);
  }

  revalidateComplaints(id.data);
  return formSuccess(checked.type.kind === "photo" ? "Photo added." : "Video added.");
}

// ---------------------------------------------------------------------------
// Job links (E15-T8)
// ---------------------------------------------------------------------------

/** A new job link, replacing any earlier one. Owners only. */
export async function createJobLink(
  _previous: FormState & { token?: string },
  formData: FormData,
): Promise<FormState & { token?: string }> {
  try {
    await requireRole(["owner"]);
  } catch (error) {
    return authorizationFailure(error);
  }
  const id = uuid("Complaint").safeParse(formData.get("id"));
  if (!id.success) return formFailure(NOT_FOUND);

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("create_job_link", { p_complaint_id: id.data });
  if (error) return failure("createJobLink", error);

  revalidateComplaints(id.data);
  return { ...formSuccess("Job link created. Copy it now: it is shown only once."), token: data };
}

// ---------------------------------------------------------------------------
// Costs and payouts (E15-T9)
// ---------------------------------------------------------------------------

const COST_FIELDS = ["labour_cost", "material_cost", "vendor_charge", "payer", "resident_id"];

export async function saveComplaintCosts(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  const values = formValues(formData, COST_FIELDS);
  try {
    await requireRole(["owner"]);
  } catch (error) {
    return authorizationFailure(error, values);
  }
  const parsed = validateFormData(complaintCostsSchema, formData);
  if (!parsed.ok) return formFailure(undefined, values, parsed.fieldErrors);

  const costs = parsed.data;
  const supabase = await createClient();
  const { error } = await supabase.rpc("set_complaint_costs", {
    p_complaint_id: costs.id,
    p_labour: costs.labour_cost,
    p_material: costs.material_cost,
    p_vendor_charge: costs.vendor_charge,
    p_payer: costs.payer,
    p_resident_id: costs.payer === "resident" ? (costs.resident_id ?? undefined) : undefined,
  });
  if (error) return failure("saveComplaintCosts", error, values);

  revalidateComplaints(costs.id);
  revalidatePath("/residents", "layout");
  revalidatePath("/fees", "layout");
  const total = costs.labour_cost + costs.material_cost + costs.vendor_charge;
  return formSuccess(
    costs.payer === "resident"
      ? `${formatPaise(total)} will be charged on the resident's next invoice.`
      : "Costs saved.",
  );
}

const PAYOUT_FIELDS = ["amount", "paid_at", "mode", "reference"] as const;

export async function recordVendorPayout(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  const values = formValues(formData, PAYOUT_FIELDS);
  try {
    await requireRole(["owner"]);
  } catch (error) {
    return authorizationFailure(error, values);
  }
  const parsed = validateFormData(vendorPayoutSchema, formData);
  if (!parsed.ok) return formFailure(undefined, values, parsed.fieldErrors);

  const supabase = await createClient();
  const { error } = await supabase.rpc("record_vendor_payout", {
    p_complaint_id: parsed.data.id,
    p_amount: parsed.data.amount,
    p_paid_at: parsed.data.paid_at,
    p_mode: parsed.data.mode,
    p_reference: parsed.data.reference ?? undefined,
  });
  if (error) return failure("recordVendorPayout", error, values);

  revalidateComplaints(parsed.data.id);
  return formSuccess(`Payment of ${formatPaise(parsed.data.amount)} recorded.`);
}

// ---------------------------------------------------------------------------
// Workers (E15-T6)
// ---------------------------------------------------------------------------

const WORKER_FIELDS = ["kind", "name", "business_name", "phone", "call_out_charge", "notes"];

function revalidateWorkers() {
  revalidatePath("/settings/workers");
  revalidatePath("/complaints", "layout");
}

/** Adds a worker to the active hostel, or edits one when `worker_id` is set. */
export async function saveWorker(_previous: FormState, formData: FormData): Promise<FormState> {
  const values = {
    ...formValues(formData, WORKER_FIELDS),
    trades: formData.getAll("trades").join(","),
    preferred_trades: formData.getAll("preferred_trades").join(","),
  };
  let ownerId: string;
  try {
    ownerId = (await requireRole(["owner"])).id;
  } catch (error) {
    return authorizationFailure(error, values);
  }
  const parsed = validateFormData(workerSchema, formData);
  if (!parsed.ok) return formFailure(undefined, values, parsed.fieldErrors);
  const hostelId = await activeHostelId();
  if (!hostelId) return formFailure(NO_HOSTEL, values);

  const existing = uuid("Worker").safeParse(formData.get("worker_id"));
  const { preferred_trades, ...worker } = parsed.data;
  const vendor = worker.kind === "vendor";
  const row = {
    name: worker.name,
    phone: worker.phone,
    trades: worker.trades,
    notes: worker.notes,
    business_name: vendor ? worker.business_name : null,
    call_out_charge: vendor ? worker.call_out_charge : null,
  };

  const supabase = await createClient();
  let workerId: string;
  if (existing.success) {
    const { data, error } = await supabase
      .from("workers")
      .update(row)
      .eq("id", existing.data)
      .select("id")
      .maybeSingle();
    if (error) return failure("saveWorker", error, values);
    if (!data) return formFailure("This worker could not be found. Refresh the page.", values);
    workerId = data.id;
  } else {
    const { data, error } = await supabase
      .from("workers")
      .insert({ ...row, kind: worker.kind, owner_id: ownerId })
      .select("id")
      .single();
    if (error) return failure("saveWorker", error, values);
    workerId = data.id;
  }

  // Only preferred_trades is updatable, so an upsert is not allowed: update
  // the hostel link when the worker already serves this hostel, else add it.
  const { data: linked, error: updateError } = await supabase
    .from("worker_hostels")
    .update({ preferred_trades })
    .eq("worker_id", workerId)
    .eq("hostel_id", hostelId)
    .select("worker_id");
  if (updateError) return failure("saveWorker", updateError, values);
  if ((linked ?? []).length === 0) {
    const { error: linkError } = await supabase
      .from("worker_hostels")
      .insert({ worker_id: workerId, hostel_id: hostelId, preferred_trades });
    // A new worker is kept even so: they can be added to the hostel from the
    // owner's other workers on the same page.
    if (linkError) return failure("saveWorker", linkError, values);
  }

  revalidateWorkers();
  return formSuccess(existing.success ? `${worker.name} saved.` : `${worker.name} added.`);
}

/** Lets one of the owner's workers from another hostel serve this one too. */
export async function addWorkerToHostel(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  try {
    await requireRole(["owner"]);
  } catch (error) {
    return authorizationFailure(error);
  }
  const id = uuid("Worker").safeParse(formData.get("worker_id"));
  if (!id.success) return formFailure("This worker could not be found. Refresh the page.");
  const hostelId = await activeHostelId();
  if (!hostelId) return formFailure(NO_HOSTEL);

  const supabase = await createClient();
  const { error } = await supabase
    .from("worker_hostels")
    .insert({ worker_id: id.data, hostel_id: hostelId });
  if (error?.code === "23505") return formSuccess("Already serving this hostel.");
  if (error) return failure("addWorkerToHostel", error);

  revalidateWorkers();
  return formSuccess("Added to this hostel.");
}

/** Stops or restarts sending jobs to a worker. */
export async function setWorkerActive(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  try {
    await requireRole(["owner"]);
  } catch (error) {
    return authorizationFailure(error);
  }
  const id = uuid("Worker").safeParse(formData.get("worker_id"));
  if (!id.success) return formFailure("This worker could not be found. Refresh the page.");
  const active = formData.get("active") === "true";

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("workers")
    .update({ active })
    .eq("id", id.data)
    .select("name")
    .maybeSingle();
  if (error) return failure("setWorkerActive", error);
  if (!data) return formFailure("This worker could not be found. Refresh the page.");

  revalidateWorkers();
  return formSuccess(
    active ? `${data.name} gets jobs again.` : `${data.name} no longer gets new jobs.`,
  );
}

export async function addWorkerUnavailability(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  const values = formValues(formData, ["from_date", "to_date", "reason"]);
  try {
    await requireRole(["owner"]);
  } catch (error) {
    return authorizationFailure(error, values);
  }
  const parsed = validateFormData(workerUnavailableSchema, formData);
  if (!parsed.ok) return formFailure(undefined, values, parsed.fieldErrors);

  const supabase = await createClient();
  const { error } = await supabase.from("worker_unavailability").insert(parsed.data);
  if (error) return failure("addWorkerUnavailability", error, values);

  revalidateWorkers();
  return formSuccess("Time off recorded. Jobs go to someone else on those days.");
}

export async function removeWorkerUnavailability(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  try {
    await requireRole(["owner"]);
  } catch (error) {
    return authorizationFailure(error);
  }
  const id = uuid("Time off").safeParse(formData.get("id"));
  if (!id.success) return formFailure("This could not be found. Refresh the page.");

  const supabase = await createClient();
  const { error } = await supabase.from("worker_unavailability").delete().eq("id", id.data);
  if (error) return failure("removeWorkerUnavailability", error);

  revalidateWorkers();
  return formSuccess("Time off removed.");
}

// ---------------------------------------------------------------------------
// Categories and targets (E15-T1, E15-T7, E15-T10)
// ---------------------------------------------------------------------------

function revalidateComplaintSettings() {
  revalidatePath("/settings/complaints");
  revalidatePath("/complaints", "layout");
}

export async function addCategory(_previous: FormState, formData: FormData): Promise<FormState> {
  const values = formValues(formData, ["name", "trade"]);
  try {
    await requireRole(["owner"]);
  } catch (error) {
    return authorizationFailure(error, values);
  }
  const parsed = validateFormData(complaintCategorySchema, formData);
  if (!parsed.ok) return formFailure(undefined, values, parsed.fieldErrors);
  const hostelId = await activeHostelId();
  if (!hostelId) return formFailure(NO_HOSTEL, values);

  const supabase = await createClient();
  const { error } = await supabase
    .from("complaint_categories")
    .insert({ hostel_id: hostelId, name: parsed.data.name, trade: parsed.data.trade });
  if (error?.code === "23505") {
    return formFailure(undefined, values, { name: ["There is already a category with this name"] });
  }
  if (error) return failure("addCategory", error, values);

  revalidateComplaintSettings();
  return formSuccess(`${parsed.data.name} added.`);
}

/** Turns automatic routing, or the whole category, on or off. */
export async function toggleCategory(_previous: FormState, formData: FormData): Promise<FormState> {
  try {
    await requireRole(["owner"]);
  } catch (error) {
    return authorizationFailure(error);
  }
  const id = uuid("Category").safeParse(formData.get("id"));
  const field = formData.get("field");
  if (!id.success || (field !== "auto_route" && field !== "active")) {
    return formFailure("This category could not be found. Refresh the page.");
  }
  const on = formData.get("value") === "true";
  const hostelId = await activeHostelId();
  if (!hostelId) return formFailure(NO_HOSTEL);

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("complaint_categories")
    .update(field === "active" ? { active: on } : { auto_route: on })
    .eq("id", id.data)
    .eq("hostel_id", hostelId)
    .select("name")
    .maybeSingle();
  if (error) return failure("toggleCategory", error);
  if (!data) return formFailure("This category could not be found. Refresh the page.");

  revalidateComplaintSettings();
  if (field === "active") return formSuccess(`${data.name} ${on ? "restored" : "hidden"}.`);
  return formSuccess(
    on
      ? `${data.name} complaints are routed automatically.`
      : `${data.name} complaints wait for someone to assign them.`,
  );
}

export async function saveTarget(_previous: FormState, formData: FormData): Promise<FormState> {
  const values = formValues(formData, ["respond_hours", "resolve_hours"]);
  try {
    await requireRole(["owner"]);
  } catch (error) {
    return authorizationFailure(error, values);
  }
  const parsed = validateFormData(complaintTargetSchema, formData);
  if (!parsed.ok) return formFailure(undefined, values, parsed.fieldErrors);
  const hostelId = await activeHostelId();
  if (!hostelId) return formFailure(NO_HOSTEL, values);

  const supabase = await createClient();
  // Only the minutes are updatable, so update the hostel's own target and
  // insert one when the default applied until now.
  const minutes = {
    respond_minutes: Math.round(parsed.data.respond_hours * 60),
    resolve_minutes: Math.round(parsed.data.resolve_hours * 60),
  };
  const { data: updated, error: updateError } = await supabase
    .from("complaint_targets")
    .update(minutes)
    .eq("hostel_id", hostelId)
    .eq("priority", parsed.data.priority)
    .select("priority");
  if (updateError) return failure("saveTarget", updateError, values);
  const { error } =
    (updated ?? []).length > 0
      ? { error: null }
      : await supabase
          .from("complaint_targets")
          .insert({ hostel_id: hostelId, priority: parsed.data.priority, ...minutes });
  if (error) return failure("saveTarget", error, values);

  revalidateComplaintSettings();
  return formSuccess(`${PRIORITY_LABELS[parsed.data.priority]} targets saved.`);
}

export async function resetTarget(_previous: FormState, formData: FormData): Promise<FormState> {
  try {
    await requireRole(["owner"]);
  } catch (error) {
    return authorizationFailure(error);
  }
  const priority = formData.get("priority");
  if (!(COMPLAINT_PRIORITIES as readonly unknown[]).includes(priority)) {
    return formFailure("Choose a priority.");
  }
  const hostelId = await activeHostelId();
  if (!hostelId) return formFailure(NO_HOSTEL);

  const supabase = await createClient();
  const { error } = await supabase
    .from("complaint_targets")
    .delete()
    .eq("hostel_id", hostelId)
    .eq("priority", priority as ComplaintPriority);
  if (error) return failure("resetTarget", error);

  revalidateComplaintSettings();
  return formSuccess(`${PRIORITY_LABELS[priority as ComplaintPriority]} targets reset.`);
}

// ---------------------------------------------------------------------------
// Preventive maintenance (E15-T12)
// ---------------------------------------------------------------------------

const SCHEDULE_FIELDS = [
  "title",
  "description",
  "category_id",
  "place",
  "room_id",
  "area",
  "every",
  "unit",
  "next_due",
  "priority",
] as const;

export async function saveSchedule(_previous: FormState, formData: FormData): Promise<FormState> {
  const values = formValues(formData, SCHEDULE_FIELDS);
  try {
    await requireRole(["owner"]);
  } catch (error) {
    return authorizationFailure(error, values);
  }
  const parsed = validateFormData(maintenanceScheduleSchema, formData);
  if (!parsed.ok) return formFailure(undefined, values, parsed.fieldErrors);
  const hostelId = await activeHostelId();
  if (!hostelId) return formFailure(NO_HOSTEL, values);

  const { place, ...schedule } = parsed.data;
  const row = {
    ...schedule,
    room_id: place === "room" ? schedule.room_id : null,
    area: place === "area" ? schedule.area : null,
  };
  const existing = uuid("Schedule").safeParse(formData.get("schedule_id"));
  const supabase = await createClient();
  const { error } = existing.success
    ? await supabase
        .from("maintenance_schedules")
        .update(row)
        .eq("id", existing.data)
        .eq("hostel_id", hostelId)
    : await supabase.from("maintenance_schedules").insert({ ...row, hostel_id: hostelId });
  if (error) return failure("saveSchedule", error, values);

  revalidatePath("/complaints/maintenance");
  return formSuccess(`${schedule.title} saved.`);
}

export async function setScheduleActive(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  try {
    await requireRole(["owner"]);
  } catch (error) {
    return authorizationFailure(error);
  }
  const id = uuid("Schedule").safeParse(formData.get("id"));
  if (!id.success) return formFailure("This task could not be found. Refresh the page.");
  const active = formData.get("active") === "true";
  const hostelId = await activeHostelId();
  if (!hostelId) return formFailure(NO_HOSTEL);

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("maintenance_schedules")
    .update({ active })
    .eq("id", id.data)
    .eq("hostel_id", hostelId)
    .select("title")
    .maybeSingle();
  if (error) return failure("setScheduleActive", error);
  if (!data) return formFailure("This task could not be found. Refresh the page.");

  revalidatePath("/complaints/maintenance");
  return formSuccess(active ? `${data.title} resumed.` : `${data.title} paused.`);
}

/** Creates the jobs for every task that has fallen due, now instead of overnight. */
export async function runDueMaintenance(): Promise<FormState> {
  try {
    await requireRole(["owner"]);
  } catch (error) {
    return authorizationFailure(error);
  }
  const hostelId = await activeHostelId();
  if (!hostelId) return formFailure(NO_HOSTEL);

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("create_due_maintenance", { p_hostel_id: hostelId });
  if (error) return failure("runDueMaintenance", error);

  revalidatePath("/complaints/maintenance");
  revalidateComplaints();
  return formSuccess(
    data === 0
      ? "Nothing is due yet."
      : `${data} ${data === 1 ? "job was" : "jobs were"} created and routed.`,
  );
}
