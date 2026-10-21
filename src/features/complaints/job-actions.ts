"use server";

import { revalidatePath } from "next/cache";

import { rupees } from "@/lib/validation";
import { logUnexpected } from "@/lib/request-context";
import { createClient } from "@/lib/supabase/server";

const MESSAGES: Record<string, string> = {
  job_link_invalid: "This job link no longer works. Ask the hostel for a new one.",
  job_rate_limited: "Too many updates. Try again in an hour.",
  job_state: "Accept the job first.",
  job_note_length: "The note is too long.",
  job_charge_range: "Enter a charge between ₹0 and ₹1,00,000.",
};

export type JobUpdateState = {
  status: "idle" | "success" | "error";
  message?: string;
  /** The link has done its job (finished or declined) and no longer works. */
  final?: boolean;
};

const ACTIONS = new Set(["accept", "decline", "on_the_way", "started", "done"]);

/**
 * A worker's update from their job link (ClickUp EP-15 T8). No account:
 * the token is the only key, and the database checks it on every call.
 */
export async function updateJob(
  _previous: JobUpdateState,
  formData: FormData,
): Promise<JobUpdateState> {
  const token = String(formData.get("token") ?? "");
  const action = String(formData.get("action") ?? "");
  if (!ACTIONS.has(action)) return { status: "error", message: "Choose what to update." };
  const note = String(formData.get("note") ?? "").trim() || null;
  const chargeInput = String(formData.get("charge") ?? "").trim();
  let charge: number | null = null;
  if (chargeInput) {
    const parsed = rupees("Charge", { positive: false }).safeParse(chargeInput);
    if (!parsed.success)
      return { status: "error", message: "Enter the charge in rupees, e.g. 450." };
    charge = parsed.data;
  }

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("job_update", {
    p_token: token,
    p_action: action,
    p_note: note ?? undefined,
    p_charge: charge ?? undefined,
  });
  if (error) {
    const message = error.hint ? MESSAGES[error.hint] : undefined;
    if (!message) await logUnexpected("updateJob", error);
    return { status: "error", message: message ?? "That did not save. Try again." };
  }
  const final = data === "done" || data === "declined";
  // A finished link no longer opens, so the page is not re-rendered: the
  // worker keeps the confirmation on screen.
  if (!final) revalidatePath(`/job/${token}`);
  const done: Record<string, string> = {
    accepted: "Thank you. The hostel knows you have taken the job.",
    on_the_way: "The hostel knows you are on the way.",
    started: "Marked as started.",
    done: "Marked as done. Thank you.",
    declined: "You have declined this job. The link no longer works.",
  };
  return { status: "success", message: done[data as string] ?? "Saved.", final };
}
