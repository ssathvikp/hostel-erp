"use server";

import type { PostgrestError } from "@supabase/supabase-js";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { whatsAppLink } from "@/features/notifications/message";
import { AuthorizationError } from "@/lib/auth/roles";
import { requireRole } from "@/lib/auth/session";
import { formHostel } from "@/lib/hostels/form";
import { formatPaise } from "@/lib/money";
import { unexpectedFailure } from "@/lib/request-context";
import { siteOrigin } from "@/lib/site-origin";
import { createClient } from "@/lib/supabase/server";
import {
  complaintAssignSchema,
  complaintCategorySchema,
  complaintCommentSchema,
  complaintCostSchema,
  complaintPayoutSchema,
  complaintSchema,
  complaintStatusSchema,
  complaintTargetsSchema,
  formFailure,
  formSuccess,
  formValues,
  maintenanceScheduleSchema,
  requiredText,
  uuid,
  validateFormData,
  workerSchema,
  workerTimeOffSchema,
  type FormState,
} from "@/lib/validation";

import { complaintNumber } from "./options";

/** Plain-language messages for the rules the complaint functions enforce (ClickUp EP-15). */
const RULE_MESSAGES: Record<string, string> = {
  complaint_not_found: "This complaint could not be found. Refresh the page.",
  complaint_transition: "The complaint cannot move to that status from where it is now.",
  hold_reason: "Say why the complaint is on hold.",
  reopen_reason: "Say why the complaint is reopened.",
  complaint_no_worker: "Assign a worker first.",
  complaint_done: "This complaint is finished. Reopen it first.",
  worker_not_found: "That worker does not work for this hostel.",
  comment_invalid: "Write a comment of up to 2000 characters.",
  complaint_bed_room: "That bed is not in the chosen room.",
  cost_no_resident: "Link the complaint to a resident before charging them.",
  cost_not_found: "That cost could not be found. Only the owner can void costs.",
  cost_void: "This cost is already void.",
  cost_billed: "The resident was already billed for this. Void that invoice first.",
  void_reason: "Say why.",
  hostel_not_found: "That hostel could not be found.",
  worker_profile_invalid: "That staff account is not part of this hostel.",
  not_owner: "Only the hostel owner can do this.",
};

async function failure(action: string, error: PostgrestError, values?: Record<string, string>) {
  if (error.code === "42501") return formFailure("Only the hostel owner can do this.", values);
  if (error.code === "23505") return formFailure("That name is already used.", values);
  const message = error.code === "P0001" && error.hint ? RULE_MESSAGES[error.hint] : undefined;
  return message ? formFailure(message, values) : unexpectedFailure(action, error, values);
}

async function allowed(roles: ("owner" | "staff")[], values?: Record<string, string>) {
  try {
    await requireRole(roles);
    return null;
  } catch (error) {
    if (error instanceof AuthorizationError) return formFailure(error.message, values);
    throw error;
  }
}

function revalidateComplaint(id: unknown) {
  const complaint = uuid("Complaint").safeParse(id);
  revalidatePath("/complaints");
  if (complaint.success) revalidatePath(`/complaints/${complaint.data}`);
  revalidatePath("/dashboard");
}

// ---------------------------------------------------------------------------
// Raise (T2)
// ---------------------------------------------------------------------------

const RAISE_FIELDS = [
  "location",
  "room_id",
  "bed_id",
  "area",
  "resident_id",
  "category_id",
  "priority",
  "title",
  "description",
  "bed_maintenance",
] as const;

export async function raiseComplaint(_previous: FormState, formData: FormData): Promise<FormState> {
  const values = formValues(formData, RAISE_FIELDS);
  const denied = await allowed(["owner", "staff"], values);
  if (denied) return denied;
  const parsed = validateFormData(complaintSchema, formData);
  if (!parsed.ok) return formFailure(undefined, values, parsed.fieldErrors);
  const hostel = await formHostel(formData);
  if ("error" in hostel) return formFailure(hostel.error, values);

  const supabase = await createClient();
  const input = parsed.data;
  const { data, error } = await supabase
    .from("complaints")
    .insert({
      hostel_id: hostel.id,
      room_id: input.room_id,
      bed_id: input.bed_id,
      area: input.area,
      resident_id: input.resident_id,
      category_id: input.category_id,
      priority: input.priority,
      title: input.title,
      description: input.description,
    })
    .select("id, number")
    .single();
  if (error) return failure("raiseComplaint", error, values);

  if (input.bed_maintenance && input.bed_id) {
    // Best effort: the complaint stands even if the bed cannot be marked.
    await supabase
      .from("beds")
      .update({ status: "maintenance", status_reason: `Complaint ${complaintNumber(data.number)}` })
      .eq("id", input.bed_id)
      .eq("hostel_id", hostel.id);
    revalidatePath("/rooms", "layout");
  }
  revalidateComplaint(data.id);
  redirect(`/complaints/${data.id}?raised=1`);
}

// ---------------------------------------------------------------------------
// Work a complaint (T2, T7)
// ---------------------------------------------------------------------------

export async function setComplaintStatus(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  const values = formValues(formData, ["status", "note"]);
  const denied = await allowed(["owner", "staff"], values);
  if (denied) return denied;
  const parsed = validateFormData(complaintStatusSchema, formData);
  if (!parsed.ok) return formFailure(undefined, values, parsed.fieldErrors);

  const supabase = await createClient();
  const { error } = await supabase.rpc("complaint_set_status", {
    p_complaint_id: parsed.data.complaint_id,
    p_status: parsed.data.status,
    p_note: parsed.data.note ?? undefined,
  });
  if (error) return failure("setComplaintStatus", error, values);
  revalidateComplaint(parsed.data.complaint_id);
  return formSuccess("Status updated.");
}

export async function assignComplaint(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  const values = formValues(formData, ["worker_id", "note"]);
  const denied = await allowed(["owner", "staff"], values);
  if (denied) return denied;
  const parsed = validateFormData(complaintAssignSchema, formData);
  if (!parsed.ok) return formFailure(undefined, values, parsed.fieldErrors);

  const supabase = await createClient();
  if (formData.get("auto") === "1") {
    const { data, error } = await supabase.rpc("complaint_auto_route", {
      p_complaint_id: parsed.data.complaint_id,
    });
    if (error) return failure("assignComplaint", error, values);
    revalidateComplaint(parsed.data.complaint_id);
    return data
      ? formSuccess("Worker assigned.")
      : formSuccess(undefined, "No available worker has the right trade. Assign someone by hand.");
  }
  const { error } = await supabase.rpc("complaint_assign", {
    p_complaint_id: parsed.data.complaint_id,
    p_worker_id: parsed.data.worker_id as string,
    p_note: parsed.data.note ?? undefined,
  });
  if (error) return failure("assignComplaint", error, values);
  revalidateComplaint(parsed.data.complaint_id);
  return formSuccess(parsed.data.worker_id ? "Worker assigned." : "Worker removed.");
}

export async function commentOnComplaint(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  const values = formValues(formData, ["body"]);
  const denied = await allowed(["owner", "staff"], values);
  if (denied) return denied;
  const parsed = validateFormData(complaintCommentSchema, formData);
  if (!parsed.ok) return formFailure(undefined, values, parsed.fieldErrors);

  const supabase = await createClient();
  const { error } = await supabase.rpc("complaint_comment", {
    p_complaint_id: parsed.data.complaint_id,
    p_body: parsed.data.body,
  });
  if (error) return failure("commentOnComplaint", error, values);
  revalidateComplaint(parsed.data.complaint_id);
  return formSuccess("Comment added.");
}

export type JobLinkResult =
  { ok: true; url: string; whatsApp: string | null } | { ok: false; error: string };

/**
 * A fresh job link for the assigned worker (T8), with a WhatsApp message
 * ready to send. Any earlier link for the job stops working.
 */
export async function createJobLink(complaintId: string): Promise<JobLinkResult> {
  try {
    await requireRole(["owner", "staff"]);
  } catch (error) {
    if (error instanceof AuthorizationError) return { ok: false, error: error.message };
    throw error;
  }
  if (!uuid("Complaint").safeParse(complaintId).success) {
    return { ok: false, error: RULE_MESSAGES.complaint_not_found };
  }
  const supabase = await createClient();
  const { data: token, error } = await supabase.rpc("complaint_job_link", {
    p_complaint_id: complaintId,
  });
  if (error || !token) {
    const message = error?.hint ? RULE_MESSAGES[error.hint] : undefined;
    if (!message) await unexpectedFailure("createJobLink", error ?? new Error("No token"));
    return { ok: false, error: message ?? "The link could not be made. Try again." };
  }
  const { data: complaint } = await supabase
    .from("complaint_overview")
    .select("number, title, worker_id, hostel_id")
    .eq("id", complaintId)
    .single();
  const [{ data: worker }, { data: hostel }] = await Promise.all([
    supabase.from("workers").select("full_name, phone").eq("id", complaint!.worker_id!).single(),
    supabase.from("hostels").select("name").eq("id", complaint!.hostel_id!).single(),
  ]);
  const url = `${await siteOrigin()}/job/${token}`;
  const message = `Hello ${worker?.full_name}, ${hostel?.name} has a job for you: ${complaint?.title} (${complaintNumber(complaint?.number ?? 0)}). Details and updates: ${url}`;
  revalidateComplaint(complaintId);
  return { ok: true, url, whatsApp: whatsAppLink(worker?.phone, message) };
}

// ---------------------------------------------------------------------------
// Costs and payouts (T9)
// ---------------------------------------------------------------------------

export async function addComplaintCost(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  const values = formValues(formData, ["kind", "amount", "payer", "description"]);
  const denied = await allowed(["owner", "staff"], values);
  if (denied) return denied;
  const parsed = validateFormData(complaintCostSchema, formData);
  if (!parsed.ok) return formFailure(undefined, values, parsed.fieldErrors);

  const supabase = await createClient();
  const { error } = await supabase.rpc("complaint_add_cost", {
    p_complaint_id: parsed.data.complaint_id,
    p_kind: parsed.data.kind,
    p_amount: parsed.data.amount,
    p_payer: parsed.data.payer,
    p_description: parsed.data.description ?? undefined,
  });
  if (error) return failure("addComplaintCost", error, values);
  revalidateComplaint(parsed.data.complaint_id);
  return formSuccess(
    parsed.data.payer === "resident"
      ? `${formatPaise(parsed.data.amount)} added. It goes on the resident's next invoice.`
      : `${formatPaise(parsed.data.amount)} added.`,
  );
}

export async function voidComplaintCost(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  const values = formValues(formData, ["reason"]);
  const denied = await allowed(["owner"], values);
  if (denied) return denied;
  const cost = uuid("Cost").safeParse(formData.get("cost_id"));
  const reason = requiredText("Reason", 500).safeParse(formData.get("reason"));
  if (!cost.success) return formFailure(RULE_MESSAGES.cost_not_found, values);
  if (!reason.success) return formFailure(undefined, values, { reason: ["Say why"] });

  const supabase = await createClient();
  const { error } = await supabase.rpc("complaint_void_cost", {
    p_cost_id: cost.data,
    p_reason: reason.data,
  });
  if (error) return failure("voidComplaintCost", error, values);
  revalidateComplaint(formData.get("complaint_id"));
  return formSuccess("Cost voided.");
}

export async function recordPayout(_previous: FormState, formData: FormData): Promise<FormState> {
  const values = formValues(formData, ["worker_id", "amount", "paid_at", "mode", "reference"]);
  const denied = await allowed(["owner"], values);
  if (denied) return denied;
  const parsed = validateFormData(complaintPayoutSchema, formData);
  if (!parsed.ok) return formFailure(undefined, values, parsed.fieldErrors);
  const hostel = await formHostel(formData);
  if ("error" in hostel) return formFailure(hostel.error, values);

  const supabase = await createClient();
  const { error } = await supabase.from("complaint_payouts").insert({
    hostel_id: hostel.id,
    complaint_id: parsed.data.complaint_id,
    worker_id: parsed.data.worker_id,
    amount: parsed.data.amount,
    paid_at: parsed.data.paid_at,
    mode: parsed.data.mode,
    reference: parsed.data.reference,
  });
  if (error) return failure("recordPayout", error, values);
  revalidateComplaint(parsed.data.complaint_id);
  return formSuccess(`Payout of ${formatPaise(parsed.data.amount)} recorded.`);
}

// ---------------------------------------------------------------------------
// Workers (T6)
// ---------------------------------------------------------------------------

const WORKER_FIELDS = [
  "kind",
  "full_name",
  "business_name",
  "phone",
  "call_out_charge",
  "notes",
  "preferred",
] as const;

export async function saveWorker(_previous: FormState, formData: FormData): Promise<FormState> {
  const values = formValues(formData, WORKER_FIELDS);
  const denied = await allowed(["owner"], values);
  if (denied) return denied;
  const parsed = validateFormData(workerSchema, formData);
  if (!parsed.ok) return formFailure(undefined, values, parsed.fieldErrors);
  const hostel = await formHostel(formData);
  if ("error" in hostel) return formFailure(hostel.error, values);

  const input = parsed.data;
  const row = {
    full_name: input.full_name,
    business_name: input.business_name,
    phone: input.phone,
    trades: input.trades,
    call_out_charge: input.call_out_charge,
    notes: input.notes,
    preferred: input.preferred,
  };
  const supabase = await createClient();
  const { error } = input.worker_id
    ? await supabase.from("workers").update(row).eq("id", input.worker_id)
    : await supabase.from("workers").insert({
        ...row,
        kind: input.kind,
        // Vendors are shared across the owner's hostels; on-site staff belong to one.
        hostel_id: input.kind === "on_site" ? hostel.id : null,
      });
  if (error) return failure("saveWorker", error, values);
  revalidatePath("/settings/workers");
  return formSuccess(input.worker_id ? "Worker saved." : `${input.full_name} added.`);
}

export async function setWorkerActive(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  const denied = await allowed(["owner"]);
  if (denied) return denied;
  const worker = uuid("Worker").safeParse(formData.get("worker_id"));
  if (!worker.success) return formFailure("That worker could not be found.");
  const active = formData.get("active") === "true";
  const supabase = await createClient();
  const { error } = await supabase.from("workers").update({ active }).eq("id", worker.data);
  if (error) return failure("setWorkerActive", error);
  revalidatePath("/settings/workers");
  return formSuccess(active ? "Worker takes jobs again." : "Worker no longer gets jobs.");
}

export async function addWorkerTimeOff(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  const values = formValues(formData, ["from_date", "to_date", "reason"]);
  const denied = await allowed(["owner"], values);
  if (denied) return denied;
  const parsed = validateFormData(workerTimeOffSchema, formData);
  if (!parsed.ok) return formFailure(undefined, values, parsed.fieldErrors);
  const supabase = await createClient();
  const { error } = await supabase.from("worker_unavailability").insert(parsed.data);
  if (error) return failure("addWorkerTimeOff", error, values);
  revalidatePath("/settings/workers");
  return formSuccess("Time off added. No jobs are routed to them on those days.");
}

export async function removeWorkerTimeOff(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  const denied = await allowed(["owner"]);
  if (denied) return denied;
  const entry = uuid("Time off").safeParse(formData.get("time_off_id"));
  if (!entry.success) return formFailure("That entry could not be found.");
  const supabase = await createClient();
  const { error } = await supabase.from("worker_unavailability").delete().eq("id", entry.data);
  if (error) return failure("removeWorkerTimeOff", error);
  revalidatePath("/settings/workers");
  return formSuccess("Time off removed.");
}

// ---------------------------------------------------------------------------
// Setup: categories, targets, settings, schedules (T1, T10, T8, T12)
// ---------------------------------------------------------------------------

export async function saveCategory(_previous: FormState, formData: FormData): Promise<FormState> {
  const values = formValues(formData, ["name", "trade", "auto_route"]);
  const denied = await allowed(["owner"], values);
  if (denied) return denied;
  const parsed = validateFormData(complaintCategorySchema, formData);
  if (!parsed.ok) return formFailure(undefined, values, parsed.fieldErrors);
  const hostel = await formHostel(formData);
  if ("error" in hostel) return formFailure(hostel.error, values);

  const supabase = await createClient();
  const row = {
    name: parsed.data.name,
    trade: parsed.data.trade,
    auto_route: parsed.data.auto_route,
  };
  const { error } = parsed.data.category_id
    ? await supabase
        .from("complaint_categories")
        .update(row)
        .eq("id", parsed.data.category_id)
        .eq("hostel_id", hostel.id)
    : await supabase
        .from("complaint_categories")
        .insert({ ...row, hostel_id: hostel.id, position: 100 });
  if (error) return failure("saveCategory", error, values);
  revalidatePath("/settings/complaints");
  return formSuccess(parsed.data.category_id ? "Category saved." : `${parsed.data.name} added.`);
}

export async function setCategoryActive(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  const denied = await allowed(["owner"]);
  if (denied) return denied;
  const category = uuid("Category").safeParse(formData.get("category_id"));
  const hostel = await formHostel(formData);
  if (!category.success || "error" in hostel)
    return formFailure("That category could not be found.");
  const active = formData.get("active") === "true";
  const supabase = await createClient();
  const { error } = await supabase
    .from("complaint_categories")
    .update({ active })
    .eq("id", category.data)
    .eq("hostel_id", hostel.id);
  if (error) return failure("setCategoryActive", error);
  revalidatePath("/settings/complaints");
  return formSuccess(active ? "Category shown again." : "Category hidden from new complaints.");
}

export async function saveTargets(_previous: FormState, formData: FormData): Promise<FormState> {
  const fields = (["urgent", "high", "normal", "low"] as const).flatMap((priority) => [
    `respond_${priority}`,
    `resolve_${priority}`,
  ]);
  const values = formValues(formData, fields);
  const denied = await allowed(["owner"], values);
  if (denied) return denied;
  const parsed = validateFormData(complaintTargetsSchema, formData);
  if (!parsed.ok) return formFailure(undefined, values, parsed.fieldErrors);
  const hostel = await formHostel(formData);
  if ("error" in hostel) return formFailure(hostel.error, values);

  const supabase = await createClient();
  for (const priority of ["urgent", "high", "normal", "low"] as const) {
    const respond = parsed.data[`respond_${priority}`];
    const resolve = parsed.data[`resolve_${priority}`];
    if (resolve < respond) {
      return formFailure(undefined, values, {
        [`resolve_${priority}`]: ["The fix target cannot be shorter than the response target"],
      });
    }
    const { error } = await supabase
      .from("complaint_targets")
      .update({ respond_minutes: respond * 60, resolve_minutes: resolve * 60 })
      .eq("hostel_id", hostel.id)
      .eq("priority", priority);
    if (error) return failure("saveTargets", error, values);
  }
  revalidatePath("/settings/complaints");
  revalidatePath("/complaints");
  return formSuccess("Targets saved.");
}

export async function saveComplaintSettings(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  const denied = await allowed(["owner"]);
  if (denied) return denied;
  const hostel = await formHostel(formData);
  if ("error" in hostel) return formFailure(hostel.error);
  const supabase = await createClient();
  const { error } = await supabase
    .from("hostels")
    .update({ complaints_share_resident_phone: formData.get("share_resident_phone") === "on" })
    .eq("id", hostel.id);
  if (error) return failure("saveComplaintSettings", error);
  revalidatePath("/settings/complaints");
  return formSuccess("Settings saved.");
}

const SCHEDULE_FIELDS = [
  "title",
  "description",
  "category_id",
  "location",
  "room_id",
  "area",
  "priority",
  "every_n",
  "unit",
  "next_due",
] as const;

export async function saveSchedule(_previous: FormState, formData: FormData): Promise<FormState> {
  const values = formValues(formData, SCHEDULE_FIELDS);
  const denied = await allowed(["owner"], values);
  if (denied) return denied;
  const parsed = validateFormData(maintenanceScheduleSchema, formData);
  if (!parsed.ok) return formFailure(undefined, values, parsed.fieldErrors);
  const hostel = await formHostel(formData);
  if ("error" in hostel) return formFailure(hostel.error, values);

  const supabase = await createClient();
  const { location: _location, ...row } = parsed.data;
  void _location;
  const { error } = await supabase
    .from("maintenance_schedules")
    .insert({ ...row, hostel_id: hostel.id });
  if (error) return failure("saveSchedule", error, values);
  revalidatePath("/settings/complaints");
  return formSuccess(`${parsed.data.title} scheduled.`);
}

export async function setScheduleActive(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  const denied = await allowed(["owner"]);
  if (denied) return denied;
  const schedule = uuid("Schedule").safeParse(formData.get("schedule_id"));
  const hostel = await formHostel(formData);
  if (!schedule.success || "error" in hostel)
    return formFailure("That schedule could not be found.");
  const active = formData.get("active") === "true";
  const supabase = await createClient();
  const { error } = await supabase
    .from("maintenance_schedules")
    .update({ active })
    .eq("id", schedule.data)
    .eq("hostel_id", hostel.id);
  if (error) return failure("setScheduleActive", error);
  revalidatePath("/settings/complaints");
  return formSuccess(active ? "Schedule resumed." : "Schedule paused.");
}
