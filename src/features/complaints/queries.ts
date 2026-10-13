import "server-only";

import { fetchAllPages, isPastLastPage } from "@/lib/pagination";
import type { createClient } from "@/lib/supabase/server";
import type {
  ComplaintPriority,
  ComplaintStatus,
  ComplaintTargetState,
  MaintenanceUnit,
  PayoutMode,
  Trade,
  WorkerKind,
} from "@/types";

type Supabase = Awaited<ReturnType<typeof createClient>>;

export const COMPLAINT_PAGE_SIZE = 25;
const SIGNED_URL_SECONDS = 300;
const BUCKET = "complaint-files";

export interface ComplaintRow {
  id: string;
  number: number;
  kind: "complaint" | "scheduled";
  title: string;
  priority: ComplaintPriority;
  status: ComplaintStatus;
  needsWorker: boolean;
  where: string;
  roomId: string | null;
  residentId: string | null;
  residentName: string | null;
  categoryName: string;
  workerId: string | null;
  workerName: string | null;
  createdAt: string;
  targetState: ComplaintTargetState;
}

const LIST_COLUMNS =
  "id, number, kind, title, priority, status, needs_worker, area, room_id, room_number, bed_label, resident_id, resident_name, category_name, worker_id, worker_name, created_at, target_state";

type ListRow = {
  id: string | null;
  number: number | null;
  kind: string | null;
  title: string | null;
  priority: string | null;
  status: string | null;
  needs_worker: boolean | null;
  area: string | null;
  room_id: string | null;
  room_number: string | null;
  bed_label: string | null;
  resident_id: string | null;
  resident_name: string | null;
  category_name: string | null;
  worker_id: string | null;
  worker_name: string | null;
  created_at: string | null;
  target_state: string | null;
};

/** "Room 101, bed 101-A", or the common area. */
export function placeLabel(row: {
  area: string | null;
  room_number: string | null;
  bed_label: string | null;
}): string {
  if (row.bed_label) return `Bed ${row.bed_label}`;
  if (row.room_number) return `Room ${row.room_number}`;
  return row.area ?? "";
}

function toRow(row: ListRow): ComplaintRow {
  return {
    id: row.id!,
    number: row.number!,
    kind: row.kind as ComplaintRow["kind"],
    title: row.title ?? "",
    priority: row.priority as ComplaintPriority,
    status: row.status as ComplaintStatus,
    needsWorker: Boolean(row.needs_worker),
    where: placeLabel(row),
    roomId: row.room_id,
    residentId: row.resident_id,
    residentName: row.resident_name,
    categoryName: row.category_name ?? "",
    workerId: row.worker_id,
    workerName: row.worker_name,
    createdAt: row.created_at!,
    targetState: row.target_state as ComplaintTargetState,
  };
}

export interface ComplaintFilters {
  /** "active" (not resolved or closed), "all", or one status. */
  status: ComplaintStatus | "active" | "all";
  categoryId: string | null;
  priority: ComplaintPriority | null;
  roomId: string | null;
  workerId: string | null;
  /** Only complaints raised at least this many days ago. */
  olderThanDays: number | null;
  overdue: boolean;
  page: number;
}

/** One page of complaints, most urgent first; null when past the last page. */
export async function getComplaints(
  supabase: Supabase,
  hostelId: string,
  filters: ComplaintFilters,
): Promise<{ rows: ComplaintRow[]; total: number } | null> {
  let query = supabase
    .from("complaint_list")
    .select(LIST_COLUMNS, { count: "exact" })
    .eq("hostel_id", hostelId);
  if (filters.status === "active") query = query.not("status", "in", "(resolved,closed)");
  else if (filters.status !== "all") query = query.eq("status", filters.status);
  if (filters.categoryId) query = query.eq("category_id", filters.categoryId);
  if (filters.priority) query = query.eq("priority", filters.priority);
  if (filters.roomId) query = query.eq("room_id", filters.roomId);
  if (filters.workerId) query = query.eq("worker_id", filters.workerId);
  if (filters.overdue) query = query.eq("target_state", "overdue");
  if (filters.olderThanDays) {
    const before = new Date(Date.now() - filters.olderThanDays * 86_400_000).toISOString();
    query = query.lte("created_at", before);
  }

  const from = (filters.page - 1) * COMPLAINT_PAGE_SIZE;
  const { data, count, error } = await query
    .order("created_at", { ascending: false })
    .order("id")
    .range(from, from + COMPLAINT_PAGE_SIZE - 1);
  if (isPastLastPage(error)) return null;
  if (error) throw error;
  return { rows: (data ?? []).map(toRow), total: count ?? 0 };
}

/** Open complaints about a room or a resident, for their pages. */
export async function getOpenComplaints(
  supabase: Supabase,
  hostelId: string,
  about: { roomId?: string; residentId?: string },
): Promise<ComplaintRow[]> {
  let query = supabase
    .from("complaint_list")
    .select(LIST_COLUMNS)
    .eq("hostel_id", hostelId)
    .not("status", "in", "(resolved,closed)");
  if (about.roomId) query = query.eq("room_id", about.roomId);
  if (about.residentId) query = query.eq("resident_id", about.residentId);
  const { data, error } = await query.order("created_at", { ascending: false }).limit(20);
  if (error) throw error;
  return (data ?? []).map(toRow);
}

/** Counts for the dashboard's work queue. */
export async function getComplaintCounts(supabase: Supabase, hostelId: string) {
  const [open, overdue, unassigned] = await Promise.all([
    supabase
      .from("complaint_list")
      .select("id", { count: "exact", head: true })
      .eq("hostel_id", hostelId)
      .not("status", "in", "(resolved,closed)"),
    supabase
      .from("complaint_list")
      .select("id", { count: "exact", head: true })
      .eq("hostel_id", hostelId)
      .eq("target_state", "overdue"),
    supabase
      .from("complaint_list")
      .select("id", { count: "exact", head: true })
      .eq("hostel_id", hostelId)
      .eq("needs_worker", true)
      .is("worker_id", null)
      .not("status", "in", "(resolved,closed)"),
  ]);
  for (const result of [open, overdue, unassigned]) if (result.error) throw result.error;
  return { open: open.count ?? 0, overdue: overdue.count ?? 0, needsWorker: unassigned.count ?? 0 };
}

export interface ComplaintEvent {
  id: number;
  kind: string;
  fromStatus: ComplaintStatus | null;
  toStatus: ComplaintStatus | null;
  note: string | null;
  actorName: string;
  workerName: string | null;
  createdAt: string;
}

export interface ComplaintAttachment {
  id: string;
  kind: "photo" | "video";
  source: "member" | "worker";
  uploadedBy: string;
  url: string | null;
}

export interface ComplaintDetail extends ComplaintRow {
  description: string | null;
  area: string | null;
  roomNumber: string | null;
  bedId: string | null;
  bedLabel: string | null;
  categoryId: string;
  trade: Trade;
  workerKind: WorkerKind | null;
  raisedByName: string | null;
  holdReason: string | null;
  respondDue: string;
  resolveDue: string;
  respondedAt: string | null;
  resolvedAt: string | null;
  shareResidentPhone: boolean;
  costs: {
    labour: number;
    material: number;
    vendorCharge: number;
    payer: "hostel" | "resident";
    chargeResidentId: string | null;
    chargeStatus: "pending" | "invoiced" | "void" | null;
  };
  events: ComplaintEvent[];
  attachments: ComplaintAttachment[];
  payouts: {
    id: string;
    amount: number;
    paidAt: string;
    mode: PayoutMode;
    reference: string | null;
  }[];
  jobLink: { createdAt: string; acceptedAt: string | null; lastSeenAt: string | null } | null;
}

export async function getComplaint(
  supabase: Supabase,
  hostelId: string,
  complaintId: string,
): Promise<ComplaintDetail | null> {
  const [list, raw, events, attachments, payouts, links] = await Promise.all([
    supabase
      .from("complaint_list")
      .select(
        `${LIST_COLUMNS}, description, category_id, trade, worker_kind, raised_by_name, hold_reason, respond_due, resolve_due, responded_at, resolved_at, bed_id`,
      )
      .eq("hostel_id", hostelId)
      .eq("id", complaintId)
      .maybeSingle(),
    supabase
      .from("complaints")
      .select(
        "share_resident_phone, labour_cost, material_cost, vendor_charge, payer, charge_resident_id, resident_charges!complaints_resident_charge_fkey(status)",
      )
      .eq("hostel_id", hostelId)
      .eq("id", complaintId)
      .maybeSingle(),
    supabase
      .from("complaint_events")
      .select("id, kind, from_status, to_status, note, actor_name, created_at, workers(name)")
      .eq("complaint_id", complaintId)
      .order("id"),
    supabase
      .from("complaint_attachments")
      .select("id, path, kind, source, uploaded_by_name")
      .eq("complaint_id", complaintId)
      .order("created_at"),
    supabase
      .from("vendor_payouts")
      .select("id, amount, paid_at, mode, reference")
      .eq("complaint_id", complaintId)
      .order("paid_at"),
    supabase
      .from("complaint_job_links")
      .select("created_at, accepted_at, last_seen_at")
      .eq("complaint_id", complaintId)
      .is("revoked_at", null)
      .maybeSingle(),
  ]);
  for (const result of [list, raw, events, attachments, payouts, links]) {
    if (result.error) throw result.error;
  }
  const row = list.data;
  const extra = raw.data;
  if (!row || !extra) return null;

  const files = attachments.data ?? [];
  const signed = files.length
    ? await supabase.storage.from(BUCKET).createSignedUrls(
        files.map((file) => file.path),
        SIGNED_URL_SECONDS,
      )
    : { data: [] as { path: string | null; signedUrl: string }[] };
  const urlFor = new Map((signed.data ?? []).map((entry) => [entry.path, entry.signedUrl]));

  return {
    ...toRow(row),
    description: row.description,
    area: row.area,
    roomNumber: row.room_number,
    bedId: row.bed_id,
    bedLabel: row.bed_label,
    categoryId: row.category_id!,
    trade: row.trade as Trade,
    workerKind: row.worker_kind as WorkerKind | null,
    raisedByName: row.raised_by_name,
    holdReason: row.hold_reason,
    respondDue: row.respond_due!,
    resolveDue: row.resolve_due!,
    respondedAt: row.responded_at,
    resolvedAt: row.resolved_at,
    shareResidentPhone: extra.share_resident_phone,
    costs: {
      labour: extra.labour_cost,
      material: extra.material_cost,
      vendorCharge: extra.vendor_charge,
      payer: extra.payer as "hostel" | "resident",
      chargeResidentId: extra.charge_resident_id,
      chargeStatus:
        (extra.resident_charges?.status as ComplaintDetail["costs"]["chargeStatus"]) ?? null,
    },
    events: (events.data ?? []).map((event) => ({
      id: event.id,
      kind: event.kind,
      fromStatus: event.from_status as ComplaintStatus | null,
      toStatus: event.to_status as ComplaintStatus | null,
      note: event.note,
      actorName: event.actor_name,
      workerName: event.workers?.name ?? null,
      createdAt: event.created_at,
    })),
    attachments: files.map((file) => ({
      id: file.id,
      kind: file.kind as "photo" | "video",
      source: file.source as "member" | "worker",
      uploadedBy: file.uploaded_by_name,
      url: urlFor.get(file.path) ?? null,
    })),
    payouts: (payouts.data ?? []).map((payout) => ({
      id: payout.id,
      amount: payout.amount,
      paidAt: payout.paid_at,
      mode: payout.mode as PayoutMode,
      reference: payout.reference,
    })),
    jobLink: links.data
      ? {
          createdAt: links.data.created_at,
          acceptedAt: links.data.accepted_at,
          lastSeenAt: links.data.last_seen_at,
        }
      : null,
  };
}

export interface CategoryRow {
  id: string;
  name: string;
  trade: Trade;
  autoRoute: boolean;
  active: boolean;
}

export async function getCategories(supabase: Supabase, hostelId: string): Promise<CategoryRow[]> {
  const { data, error } = await supabase
    .from("complaint_categories")
    .select("id, name, trade, auto_route, active")
    .eq("hostel_id", hostelId)
    .order("name");
  if (error) throw error;
  return (data ?? []).map((row) => ({
    id: row.id,
    name: row.name,
    trade: row.trade as Trade,
    autoRoute: row.auto_route,
    active: row.active,
  }));
}

export interface WorkerRow {
  id: string;
  kind: WorkerKind;
  name: string;
  businessName: string | null;
  phone: string;
  trades: Trade[];
  preferredTrades: Trade[];
  callOutCharge: number | null;
  notes: string | null;
  active: boolean;
  openJobs: number;
  unavailable: { id: string; from: string; to: string; reason: string | null }[];
}

/** The workers serving a hostel, with their open jobs there. */
export async function getWorkers(supabase: Supabase, hostelId: string): Promise<WorkerRow[]> {
  const [{ data, error }, jobs] = await Promise.all([
    supabase
      .from("worker_hostels")
      .select(
        "preferred_trades, workers!inner(id, kind, name, business_name, phone, trades, call_out_charge, notes, active, worker_unavailability(id, from_date, to_date, reason))",
      )
      .eq("hostel_id", hostelId),
    fetchAllPages((first, last) =>
      supabase
        .from("complaints")
        .select("worker_id")
        .eq("hostel_id", hostelId)
        .not("worker_id", "is", null)
        .not("status", "in", "(resolved,closed)")
        .order("id")
        .range(first, last),
    ),
  ]);
  if (error) throw error;
  const open = new Map<string, number>();
  for (const job of jobs) open.set(job.worker_id!, (open.get(job.worker_id!) ?? 0) + 1);

  return (data ?? [])
    .map(({ preferred_trades, workers: worker }) => ({
      id: worker.id,
      kind: worker.kind as WorkerKind,
      name: worker.name,
      businessName: worker.business_name,
      phone: worker.phone,
      trades: worker.trades as Trade[],
      preferredTrades: preferred_trades as Trade[],
      callOutCharge: worker.call_out_charge,
      notes: worker.notes,
      active: worker.active,
      openJobs: open.get(worker.id) ?? 0,
      unavailable: worker.worker_unavailability
        .filter((range) => range.to_date >= new Date().toISOString().slice(0, 10))
        .map((range) => ({
          id: range.id,
          from: range.from_date,
          to: range.to_date,
          reason: range.reason,
        })),
    }))
    .sort((a, b) => Number(b.active) - Number(a.active) || a.name.localeCompare(b.name));
}

export interface TargetRow {
  priority: ComplaintPriority;
  respondMinutes: number;
  resolveMinutes: number;
  custom: boolean;
}

const DEFAULT_TARGETS: Record<ComplaintPriority, [number, number]> = {
  urgent: [120, 1440],
  high: [240, 2880],
  normal: [1440, 4320],
  low: [2880, 10080],
};

export async function getTargets(supabase: Supabase, hostelId: string): Promise<TargetRow[]> {
  const { data, error } = await supabase
    .from("complaint_targets")
    .select("priority, respond_minutes, resolve_minutes")
    .eq("hostel_id", hostelId);
  if (error) throw error;
  const custom = new Map((data ?? []).map((row) => [row.priority, row]));
  return (Object.keys(DEFAULT_TARGETS) as ComplaintPriority[]).map((priority) => {
    const row = custom.get(priority);
    return {
      priority,
      respondMinutes: row?.respond_minutes ?? DEFAULT_TARGETS[priority][0],
      resolveMinutes: row?.resolve_minutes ?? DEFAULT_TARGETS[priority][1],
      custom: Boolean(row),
    };
  });
}

export interface ScheduleRow {
  id: string;
  title: string;
  categoryName: string;
  where: string;
  every: number;
  unit: MaintenanceUnit;
  nextDue: string;
  priority: ComplaintPriority;
  active: boolean;
}

export async function getSchedules(supabase: Supabase, hostelId: string): Promise<ScheduleRow[]> {
  const { data, error } = await supabase
    .from("maintenance_schedules")
    .select(
      "id, title, every, unit, next_due, priority, active, area, complaint_categories(name), rooms(room_number)",
    )
    .eq("hostel_id", hostelId)
    .order("next_due");
  if (error) throw error;
  return (data ?? []).map((row) => ({
    id: row.id,
    title: row.title,
    categoryName: row.complaint_categories?.name ?? "",
    where: row.rooms ? `Room ${row.rooms.room_number}` : (row.area ?? ""),
    every: row.every,
    unit: row.unit as MaintenanceUnit,
    nextDue: row.next_due,
    priority: row.priority as ComplaintPriority,
    active: row.active,
  }));
}
