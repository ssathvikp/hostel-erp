"use server";

import { createClient as createAnonClient, type PostgrestError } from "@supabase/supabase-js";
import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { z } from "zod";

import { assertPlatformAdmin } from "@/lib/auth/admin";
import { AuthorizationError } from "@/lib/auth/roles";
import { publicEnv } from "@/lib/env";
import { supportCookie } from "./support-cookie";
import { logUnexpected, unexpectedFailure } from "@/lib/request-context";
import { createClient } from "@/lib/supabase/server";
import {
  formFailure,
  formSuccess,
  formValues,
  requiredText,
  uuid,
  validateFormData,
  type FormState,
} from "@/lib/validation";

/**
 * Admin server actions (EP-10). Each checks the admin first; the database
 * function it calls checks again and writes the audit log. None can change
 * a customer's own records: only a hostel's status, and announcements.
 */

const RULE_MESSAGES: Record<string, string> = {
  reason_required: "Give a reason of at least a few words. It is shown in the audit log.",
  hostel_not_found: "This hostel could not be found.",
  account_not_found: "This account could not be found.",
  already_confirmed: "This owner has already confirmed their email address.",
};

async function failure(action: string, error: PostgrestError, values?: Record<string, string>) {
  if (error.code === "P0001" && error.hint === "hostel_status_transition") {
    return formFailure(`${error.message}.`, values);
  }
  const message = error.code === "P0001" && error.hint ? RULE_MESSAGES[error.hint] : undefined;
  return message ? formFailure(message, values) : unexpectedFailure(action, error, values);
}

function authorizationFailure(error: unknown): FormState {
  if (error instanceof AuthorizationError) return formFailure(error.message);
  throw error;
}

const reason = requiredText("Reason", 500).refine((value) => value.length >= 5, {
  error: "Give a reason of at least a few words",
});

// ---------------------------------------------------------------------------
// Suspension (E10-T6)
// ---------------------------------------------------------------------------

const statusSchema = z.object({
  hostel_id: uuid("Hostel"),
  status: z.enum(["active", "suspended"]),
  reason,
});

export async function setHostelStatus(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  const values = formValues(formData, ["reason"]);
  try {
    await assertPlatformAdmin();
  } catch (error) {
    return authorizationFailure(error);
  }
  const parsed = validateFormData(statusSchema, formData);
  if (!parsed.ok) return formFailure(undefined, values, parsed.fieldErrors);

  const supabase = await createClient();
  const { error } = await supabase.rpc("admin_set_hostel_status", {
    p_hostel_id: parsed.data.hostel_id,
    p_status: parsed.data.status,
    p_reason: parsed.data.reason,
  });
  if (error) return failure("setHostelStatus", error, values);

  revalidatePath("/admin", "layout");
  return formSuccess(
    parsed.data.status === "suspended"
      ? "Hostel suspended. The owner's email is queued."
      : "Hostel restored. The owner's email is queued.",
  );
}

// ---------------------------------------------------------------------------
// Account support (E10-T9)
// ---------------------------------------------------------------------------

const supportSchema = z.object({
  account_id: uuid("Account"),
  action: z.enum(["resend_confirmation", "password_reset", "sign_out_everywhere"]),
  reason,
});

const SUPPORT_DONE: Record<z.infer<typeof supportSchema>["action"], string> = {
  resend_confirmation: "Confirmation email sent again.",
  password_reset: "Password reset email sent.",
  sign_out_everywhere: "Signed out of every device.",
};

export async function supportAction(_previous: FormState, formData: FormData): Promise<FormState> {
  const values = formValues(formData, ["reason"]);
  try {
    await assertPlatformAdmin();
  } catch (error) {
    return authorizationFailure(error);
  }
  const parsed = validateFormData(supportSchema, formData);
  if (!parsed.ok) return formFailure(undefined, values, parsed.fieldErrors);

  // The database records the action (and ends the sessions) first, then
  // returns the address to email. Admins never see or set a password.
  const supabase = await createClient();
  const { data: email, error } = await supabase.rpc("admin_support_action", {
    p_account_id: parsed.data.account_id,
    p_action: parsed.data.action,
    p_reason: parsed.data.reason,
  });
  if (error) return failure("supportAction", error, values);

  if (parsed.data.action !== "sign_out_everywhere") {
    // A client with no session, so the admin's own session is untouched.
    const auth = createAnonClient(publicEnv.supabaseUrl, publicEnv.supabaseAnonKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    }).auth;
    const { error: sendError } =
      parsed.data.action === "resend_confirmation"
        ? await auth.resend({ type: "signup", email: email! })
        : await auth.resetPasswordForEmail(email!);
    if (sendError) {
      await logUnexpected("supportAction", sendError);
      return formFailure(
        "The action is recorded, but the email could not be sent. Try again in a minute.",
        values,
      );
    }
  }

  revalidatePath(`/admin/customers/${parsed.data.account_id}`);
  return formSuccess(SUPPORT_DONE[parsed.data.action]);
}

// ---------------------------------------------------------------------------
// Announcements (E10-T11)
// ---------------------------------------------------------------------------

const announcementSchema = z
  .object({
    message: requiredText("Message", 500),
    severity: z.enum(["info", "warning", "critical"]),
    starts_at: z.string().min(1, { error: "Choose when it starts" }),
    ends_at: z.string().min(1, { error: "Choose when it ends" }),
  })
  .refine((input) => input.ends_at > input.starts_at, {
    error: "It must end after it starts",
    path: ["ends_at"],
  });

/** `datetime-local` values are India time; the database wants an instant. */
function istToIso(local: string): string {
  return new Date(`${local}:00+05:30`).toISOString();
}

export async function createAnnouncement(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  const values = formValues(formData, ["message", "severity", "starts_at", "ends_at"]);
  try {
    await assertPlatformAdmin();
  } catch (error) {
    return authorizationFailure(error);
  }
  const parsed = validateFormData(announcementSchema, formData);
  if (!parsed.ok) return formFailure(undefined, values, parsed.fieldErrors);

  const supabase = await createClient();
  const { error } = await supabase.rpc("admin_create_announcement", {
    p_message: parsed.data.message,
    p_severity: parsed.data.severity,
    p_starts_at: istToIso(parsed.data.starts_at),
    p_ends_at: istToIso(parsed.data.ends_at),
  });
  if (error) return failure("createAnnouncement", error, values);

  revalidatePath("/admin/announcements");
  revalidatePath("/", "layout");
  return formSuccess("Announcement published.");
}

export async function endAnnouncement(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  try {
    await assertPlatformAdmin();
  } catch (error) {
    return authorizationFailure(error);
  }
  const id = uuid("Announcement").safeParse(formData.get("id"));
  if (!id.success) return formFailure("This announcement could not be found.");

  const supabase = await createClient();
  const { error } = await supabase.rpc("admin_end_announcement", { p_announcement_id: id.data });
  if (error) return failure("endAnnouncement", error);

  revalidatePath("/admin/announcements");
  revalidatePath("/", "layout");
  return formSuccess("Announcement ended.");
}

// ---------------------------------------------------------------------------
// Support view (E10-T5)
// ---------------------------------------------------------------------------

const SUPPORT_MINUTES = 30;

const openSchema = z.object({ hostel_id: uuid("Hostel"), reason });

/**
 * Starts a support session: the reason is kept for 30 minutes in a cookie
 * scoped to that hostel's admin page, and every load of the page is logged
 * with it.
 */
export async function openSupportView(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  const values = formValues(formData, ["reason"]);
  try {
    await assertPlatformAdmin();
  } catch (error) {
    return authorizationFailure(error);
  }
  const parsed = validateFormData(openSchema, formData);
  if (!parsed.ok) return formFailure(undefined, values, parsed.fieldErrors);

  (await cookies()).set(supportCookie(parsed.data.hostel_id), parsed.data.reason, {
    httpOnly: true,
    sameSite: "strict",
    secure: process.env.NODE_ENV === "production",
    path: `/admin/hostels/${parsed.data.hostel_id}`,
    maxAge: SUPPORT_MINUTES * 60,
  });
  redirect(`/admin/hostels/${parsed.data.hostel_id}`);
}

// ---------------------------------------------------------------------------
// Data requests (E10-T10)
// ---------------------------------------------------------------------------

const completeSchema = z.object({ request_id: uuid("Request"), reason });

/** Records that an account closure has been carried out. */
export async function completeClosure(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  const values = formValues(formData, ["reason"]);
  try {
    await assertPlatformAdmin();
  } catch (error) {
    return authorizationFailure(error);
  }
  const parsed = validateFormData(completeSchema, formData);
  if (!parsed.ok) return formFailure(undefined, values, parsed.fieldErrors);

  const supabase = await createClient();
  const { error } = await supabase.rpc("admin_complete_closure", {
    p_request_id: parsed.data.request_id,
    p_reason: parsed.data.reason,
  });
  if (error?.hint === "request_not_found") {
    return formFailure("This closure is no longer scheduled. Refresh the page.", values);
  }
  if (error) return failure("completeClosure", error, values);

  revalidatePath("/admin/requests");
  return formSuccess("Closure recorded as done.");
}
