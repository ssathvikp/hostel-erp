import "server-only";

import { fetchAll } from "@/lib/pagination";
import type { createClient } from "@/lib/supabase/server";

import { OPEN_STATUSES, type ComplaintStatus, type Priority, type Trade } from "./options";

type Supabase = Awaited<ReturnType<typeof createClient>>;

// ---------------------------------------------------------------------------
// Setup: categories, workers, targets, schedules
// ---------------------------------------------------------------------------

export interface Category {
  id: string;
  name: string;
  trade: Trade;
  autoRoute: boolean;
  active: boolean;
}

export async function getCategories(supabase: Supabase, hostelId: string): Promise<Category[]> {
  const { data, error } = await supabase
    .from("complaint_categories")
    .select("id, name, trade, auto_route, active")
    .eq("hostel_id", hostelId)
    .order("position")
    .order("name");
  if (error) throw error;
  return data.map((row) => ({
    id: row.id,
    name: row.name,
    trade: row.trade as Trade,
    autoRoute: row.auto_route,
    active: row.active,
  }));
}

export interface Worker {
  id: string;
  kind: "on_site" | "vendor";
  hostelId: string | null;
  fullName: string;
  businessName: string | null;
  phone: string;
  trades: Trade[];
  callOutCharge: number | null;
  notes: string | null;
  preferred: boolean;
  active: boolean;
  openJobs: number;
  timeOff: { id: string; fromDate: string; toDate: string; reason: string | null }[];
}

/** Workers who can take this hostel's jobs: its on-site staff and the owner's vendors. */
export async function getWorkers(supabase: Supabase, hostelId: string): Promise<Worker[]> {
  const [{ data, error }, { data: jobs, error: jobsError }] = await Promise.all([
    supabase
      .from("workers")
      .select(
        "id, kind, hostel_id, full_name, business_name, phone, trades, call_out_charge, notes, preferred, active, worker_unavailability(id, from_date, to_date, reason)",
      )
      .or(`hostel_id.eq.${hostelId},hostel_id.is.null`)
      .order("active", { ascending: false })
      .order("full_name"),
    supabase
      .from("complaints")
      .select("worker_id")
      .eq("hostel_id", hostelId)
      .in("status", [...OPEN_STATUSES])
      .not("worker_id", "is", null),
  ]);
  if (error) throw error;
  if (jobsError) throw jobsError;
  const open = new Map<string, number>();
  for (const job of jobs) open.set(job.worker_id!, (open.get(job.worker_id!) ?? 0) + 1);
  return data.map((row) => ({
    id: row.id,
    kind: row.kind as Worker["kind"],
    hostelId: row.hostel_id,
    fullName: row.full_name,
    businessName: row.business_name,
    phone: row.phone,
    trades: row.trades as Trade[],
    callOutCharge: row.call_out_charge,
    notes: row.notes,
    preferred: row.preferred,
    active: row.active,
    openJobs: open.get(row.id) ?? 0,
    timeOff: (row.worker_unavailability ?? [])
      .map((entry) => ({
        id: entry.id,
        fromDate: entry.from_date,
        toDate: entry.to_date,
        reason: entry.reason,
      }))
      .sort((a, b) => a.fromDate.localeCompare(b.fromDate)),
  }));
}

export interface Target {
  priority: Priority;
  respondMinutes: number;
  resolveMinutes: number;
}

export async function getTargets(supabase: Supabase, hostelId: string): Promise<Target[]> {
  const { data, error } = await supabase
    .from("complaint_targets")
    .select("priority, respond_minutes, resolve_minutes")
    .eq("hostel_id", hostelId);
  if (error) throw error;
  const order: Priority[] = ["urgent", "high", "normal", "low"];
  return data
    .map((row) => ({
      priority: row.priority as Priority,
      respondMinutes: row.respond_minutes,
      resolveMinutes: row.resolve_minutes,
    }))
    .sort((a, b) => order.indexOf(a.priority) - order.indexOf(b.priority));
}

export interface Schedule {
  id: string;
  title: string;
  categoryName: string;
  where: string;
  priority: Priority;
  everyN: number;
  unit: "day" | "week" | "month";
  nextDue: string;
  active: boolean;
}

export async function getSchedules(supabase: Supabase, hostelId: string): Promise<Schedule[]> {
  const { data, error } = await supabase
    .from("maintenance_schedules")
    .select(
      "id, title, priority, every_n, unit, next_due, active, area, complaint_categories(name), rooms(room_number)",
    )
    .eq("hostel_id", hostelId)
    .order("active", { ascending: false })
    .order("next_due");
  if (error) throw error;
  return data.map((row) => ({
    id: row.id,
    title: row.title,
    categoryName: row.complaint_categories?.name ?? "",
    where: row.rooms ? `Room ${row.rooms.room_number}` : (row.area ?? ""),
    priority: row.priority as Priority,
    everyN: row.every_n,
    unit: row.unit as Schedule["unit"],
    nextDue: row.next_due,
    active: row.active,
  }));
}

// ---------------------------------------------------------------------------
// The list (T2)
// ---------------------------------------------------------------------------

export const COMPLAINT_PAGE_SIZE = 25;

export interface ComplaintFilters {
  /** "open" (any open status), "all", or one status. */
  status: "open" | "all" | ComplaintStatus;
  categoryId?: string;
  priority?: Priority;
  roomId?: string;
  workerId?: string;
  /** Only complaints past a target. */
  late?: boolean;
  /** Only complaints nobody could be routed to. */
  unassigned?: boolean;
  page: number;
}

export interface ComplaintRow {
  id: string;
  number: number;
  kind: "reported" | "scheduled";
  title: string;
  status: ComplaintStatus;
  priority: Priority;
  categoryName: string;
  where: string;
  residentName: string | null;
  workerName: string | null;
  needsWorker: boolean;
  createdAt: string;
  respondBy: string | null;
  resolveBy: string | null;
  firstResponseAt: string | null;
  resolvedAt: string | null;
}

const LIST_COLUMNS =
  "id, number, kind, title, status, priority, category_name, room_number, bed_label, area, resident_name, worker_name, needs_worker, created_at, respond_by, resolve_by, first_response_at, resolved_at";

type OverviewRow = {
  id: string | null;
  number: number | null;
  kind: string | null;
  title: string | null;
  status: string | null;
  priority: string | null;
  category_name: string | null;
  room_number: string | null;
  bed_label: string | null;
  area: string | null;
  resident_name: string | null;
  worker_name: string | null;
  needs_worker: boolean | null;
  created_at: string | null;
  respond_by: string | null;
  resolve_by: string | null;
  first_response_at: string | null;
  resolved_at: string | null;
};

export function whereLabel(row: {
  room_number: string | null;
  bed_label?: string | null;
  area: string | null;
}): string {
  if (row.room_number) return `Room ${row.room_number}${row.bed_label ? `, ${row.bed_label}` : ""}`;
  return row.area ?? "";
}

function toRow(row: OverviewRow): ComplaintRow {
  return {
    id: row.id ?? "",
    number: row.number ?? 0,
    kind: (row.kind ?? "reported") as ComplaintRow["kind"],
    title: row.title ?? "",
    status: (row.status ?? "open") as ComplaintStatus,
    priority: (row.priority ?? "normal") as Priority,
    categoryName: row.category_name ?? "",
    where: whereLabel(row),
    residentName: row.resident_name,
    workerName: row.worker_name,
    needsWorker: row.needs_worker ?? false,
    createdAt: row.created_at ?? "",
    respondBy: row.respond_by,
    resolveBy: row.resolve_by,
    firstResponseAt: row.first_response_at,
    resolvedAt: row.resolved_at,
  };
}

export async function getComplaints(
  supabase: Supabase,
  hostelId: string,
  filters: ComplaintFilters,
) {
  let query = supabase
    .from("complaint_overview")
    .select(LIST_COLUMNS, { count: "exact" })
    .eq("hostel_id", hostelId);
  if (filters.status === "open") query = query.in("status", [...OPEN_STATUSES]);
  else if (filters.status !== "all") query = query.eq("status", filters.status);
  if (filters.categoryId) query = query.eq("category_id", filters.categoryId);
  if (filters.priority) query = query.eq("priority", filters.priority);
  if (filters.roomId) query = query.eq("room_id", filters.roomId);
  if (filters.workerId) query = query.eq("worker_id", filters.workerId);
  if (filters.unassigned) query = query.is("worker_id", null).in("status", [...OPEN_STATUSES]);
  if (filters.late) {
    const now = new Date().toISOString();
    query = query
      .in("status", [...OPEN_STATUSES])
      .or(`resolve_by.lt.${now},and(first_response_at.is.null,respond_by.lt.${now})`);
  }
  const from = (filters.page - 1) * COMPLAINT_PAGE_SIZE;
  const { data, count, error } = await query
    .order("created_at", { ascending: false })
    .order("id")
    .range(from, from + COMPLAINT_PAGE_SIZE - 1);
  if (error) {
    // A page past the end (an old link): the caller sends the user to page 1.
    if (error.code === "PGRST103") return null;
    throw error;
  }
  return { rows: data.map(toRow), total: count ?? 0 };
}

/** Open complaints about a room or raised for a resident, for their pages. */
export async function getOpenComplaintsFor(
  supabase: Supabase,
  hostelId: string,
  scope: { roomId?: string; residentId?: string },
): Promise<ComplaintRow[]> {
  let query = supabase
    .from("complaint_overview")
    .select(LIST_COLUMNS)
    .eq("hostel_id", hostelId)
    .in("status", [...OPEN_STATUSES]);
  if (scope.roomId) query = query.eq("room_id", scope.roomId);
  if (scope.residentId) query = query.eq("resident_id", scope.residentId);
  const { data, error } = await query.order("created_at", { ascending: false }).limit(20);
  if (error) throw error;
  return data.map(toRow);
}

/** Counts for the dashboard's work queue. */
export async function getComplaintQueue(supabase: Supabase, hostelId: string) {
  const rows = await fetchAll((from, to) =>
    supabase
      .from("complaint_overview")
      .select(
        "id, created_at, respond_by, resolve_by, first_response_at, resolved_at, needs_worker, priority",
      )
      .eq("hostel_id", hostelId)
      .in("status", [...OPEN_STATUSES])
      .order("id")
      .range(from, to),
  );
  const now = Date.now();
  let late = 0;
  let urgent = 0;
  let needsWorker = 0;
  for (const row of rows) {
    const respondLate =
      !row.first_response_at && row.respond_by && Date.parse(row.respond_by) < now;
    const resolveLate = row.resolve_by && Date.parse(row.resolve_by) < now;
    if (respondLate || resolveLate) late += 1;
    if (row.priority === "urgent") urgent += 1;
    if (row.needs_worker) needsWorker += 1;
  }
  return { open: rows.length, late, urgent, needsWorker };
}

// ---------------------------------------------------------------------------
// One complaint
// ---------------------------------------------------------------------------

export interface ComplaintDetail extends ComplaintRow {
  description: string | null;
  categoryId: string;
  trade: Trade;
  roomId: string | null;
  bedId: string | null;
  residentId: string | null;
  workerId: string | null;
  workerKind: "on_site" | "vendor" | null;
  workerPhone: string | null;
  raisedByKind: string;
  holdSeconds: number;
  events: {
    id: string;
    kind: string;
    fromStatus: string | null;
    toStatus: string | null;
    body: string | null;
    actorName: string | null;
    actorKind: string;
    workerId: string | null;
    createdAt: string;
  }[];
  costs: {
    id: string;
    kind: "labour" | "material" | "vendor_charge";
    amount: number;
    payer: "hostel" | "resident";
    description: string | null;
    viaJob: boolean;
    voidedAt: string | null;
    voidReason: string | null;
    createdAt: string;
  }[];
  payouts: {
    id: string;
    workerName: string;
    amount: number;
    paidAt: string;
    mode: string;
    reference: string | null;
  }[];
  attachments: {
    id: string;
    mimeType: string;
    stage: "report" | "completion";
    viaJob: boolean;
    createdAt: string;
  }[];
  jobLink: { state: string; createdAt: string } | null;
}

export async function getComplaint(
  supabase: Supabase,
  hostelId: string,
  id: string,
): Promise<ComplaintDetail | null> {
  const { data: row, error } = await supabase
    .from("complaint_overview")
    .select(
      `${LIST_COLUMNS}, description, category_id, trade, room_id, bed_id, resident_id, worker_id, worker_kind, raised_by_kind, held_seconds`,
    )
    .eq("hostel_id", hostelId)
    .eq("id", id)
    .maybeSingle();
  if (error) throw error;
  if (!row) return null;

  const [events, costs, payouts, attachments, worker] = await Promise.all([
    supabase
      .from("complaint_events")
      .select(
        "id, kind, from_status, to_status, body, actor_name, actor_kind, worker_id, created_at",
      )
      .eq("complaint_id", id)
      .order("created_at")
      .order("id"),
    supabase
      .from("complaint_costs")
      .select(
        "id, kind, amount, payer, description, recorded_via_job, voided_at, void_reason, created_at",
      )
      .eq("complaint_id", id)
      .order("created_at"),
    supabase
      .from("complaint_payouts")
      .select("id, amount, paid_at, mode, reference, workers(full_name)")
      .eq("complaint_id", id)
      .order("paid_at"),
    supabase
      .from("complaint_attachments")
      .select("id, mime_type, stage, via_job, created_at")
      .eq("complaint_id", id)
      .order("created_at"),
    row.worker_id
      ? supabase.from("workers").select("phone").eq("id", row.worker_id).maybeSingle()
      : Promise.resolve({ data: null, error: null }),
  ]);
  for (const result of [events, costs, payouts, attachments, worker]) {
    if (result.error) throw result.error;
  }

  // The job link's state is not readable by members directly; the latest
  // job event tells them enough.
  const lastJob = [...(events.data ?? [])]
    .reverse()
    .find((event) => event.kind === "job" && event.worker_id === row.worker_id);

  return {
    ...toRow(row),
    description: row.description,
    categoryId: row.category_id ?? "",
    trade: (row.trade ?? "general") as Trade,
    roomId: row.room_id,
    bedId: row.bed_id,
    residentId: row.resident_id,
    workerId: row.worker_id,
    workerKind: row.worker_kind as ComplaintDetail["workerKind"],
    workerPhone: worker.data?.phone ?? null,
    raisedByKind: row.raised_by_kind ?? "staff",
    holdSeconds: row.held_seconds ?? 0,
    events: (events.data ?? []).map((event) => ({
      id: event.id,
      kind: event.kind,
      fromStatus: event.from_status,
      toStatus: event.to_status,
      body: event.body,
      actorName: event.actor_name,
      actorKind: event.actor_kind,
      workerId: event.worker_id,
      createdAt: event.created_at,
    })),
    costs: (costs.data ?? []).map((cost) => ({
      id: cost.id,
      kind: cost.kind as ComplaintDetail["costs"][number]["kind"],
      amount: cost.amount,
      payer: cost.payer as "hostel" | "resident",
      description: cost.description,
      viaJob: cost.recorded_via_job,
      voidedAt: cost.voided_at,
      voidReason: cost.void_reason,
      createdAt: cost.created_at,
    })),
    payouts: (payouts.data ?? []).map((payout) => ({
      id: payout.id,
      workerName: payout.workers?.full_name ?? "Worker",
      amount: payout.amount,
      paidAt: payout.paid_at,
      mode: payout.mode,
      reference: payout.reference,
    })),
    attachments: (attachments.data ?? []).map((file) => ({
      id: file.id,
      mimeType: file.mime_type,
      stage: file.stage as "report" | "completion",
      viaJob: file.via_job,
      createdAt: file.created_at,
    })),
    jobLink: lastJob ? { state: lastJob.body ?? "", createdAt: lastJob.created_at } : null,
  };
}

export async function getComplaintSettings(supabase: Supabase, hostelId: string) {
  const { data, error } = await supabase
    .from("hostels")
    .select("complaints_share_resident_phone")
    .eq("id", hostelId)
    .single();
  if (error) throw error;
  return { shareResidentPhone: data.complaints_share_resident_phone };
}
