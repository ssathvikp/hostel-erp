import "server-only";

import { createAdminClient } from "@/lib/supabase/admin";
import type { ComplaintPriority, ComplaintStatus } from "@/types";

/** Job tokens are 24 random bytes as hex. Anything else is not worth a query. */
const TOKEN = /^[0-9a-f]{48}$/;

export function isJobToken(value: unknown): value is string {
  return typeof value === "string" && TOKEN.test(value);
}

const SIGNED_URL_SECONDS = 300;
const BUCKET = "complaint-files";

export interface JobView {
  complaintId: string;
  hostelId: string;
  number: number;
  title: string;
  description: string | null;
  priority: ComplaintPriority;
  status: ComplaintStatus;
  category: string;
  where: string;
  hostelName: string;
  hostelAddress: string;
  hostelPhone: string | null;
  residentName: string | null;
  residentPhone: string | null;
  workerName: string;
  accepted: boolean;
  vendorCharge: number;
  attachments: { id: string; kind: "photo" | "video"; source: string; url: string | null }[];
}

interface RawJob {
  complaint_id: string;
  hostel_id: string;
  number: number;
  title: string;
  description: string | null;
  priority: ComplaintPriority;
  status: ComplaintStatus;
  category: string;
  area: string | null;
  room_number: string | null;
  floor: number | null;
  bed_label: string | null;
  hostel_name: string;
  hostel_address: string;
  hostel_phone: string | null;
  resident_name: string | null;
  resident_phone: string | null;
  worker_name: string;
  accepted: boolean;
  vendor_charge: number;
  attachments: { id: string; path: string; kind: "photo" | "video"; source: string }[];
}

/**
 * The job behind a link, or null when the link is unknown, replaced or
 * closed. The database checks the token; the service role is needed only
 * because the worker has no account (E15-T8).
 */
export async function getJob(token: string): Promise<JobView | null> {
  if (!isJobToken(token)) return null;
  const admin = createAdminClient();
  const { data, error } = await admin.rpc("job_view", { p_token: token });
  if (error) throw error;
  if (!data) return null;
  const job = data as unknown as RawJob;

  const paths = job.attachments.map((file) => file.path);
  const signed = paths.length
    ? await admin.storage.from(BUCKET).createSignedUrls(paths, SIGNED_URL_SECONDS)
    : { data: [] as { path: string | null; signedUrl: string }[] };
  const urlFor = new Map((signed.data ?? []).map((entry) => [entry.path, entry.signedUrl]));

  const where = job.bed_label
    ? `Room ${job.room_number}, bed ${job.bed_label}`
    : job.room_number
      ? `Room ${job.room_number}`
      : (job.area ?? "");

  return {
    complaintId: job.complaint_id,
    hostelId: job.hostel_id,
    number: job.number,
    title: job.title,
    description: job.description,
    priority: job.priority,
    status: job.status,
    category: job.category,
    where,
    hostelName: job.hostel_name,
    hostelAddress: job.hostel_address,
    hostelPhone: job.hostel_phone,
    residentName: job.resident_name,
    residentPhone: job.resident_phone,
    workerName: job.worker_name,
    accepted: job.accepted,
    vendorCharge: job.vendor_charge,
    attachments: job.attachments.map((file) => ({
      id: file.id,
      kind: file.kind,
      source: file.source,
      url: urlFor.get(file.path) ?? null,
    })),
  };
}
