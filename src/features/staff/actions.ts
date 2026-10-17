"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { AuthorizationError } from "@/lib/auth/roles";
import { getSessionUser, requireRole } from "@/lib/auth/session";
import { getHostelContext } from "@/lib/hostels/active";
import { formHostel } from "@/lib/hostels/form";
import { unexpectedFailure } from "@/lib/request-context";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import {
  acceptInvitationSchema,
  formFailure,
  formSuccess,
  formValues,
  staffInviteSchema,
  uuid,
  validateFormData,
  type FormState,
} from "@/lib/validation";

const INVITE_FIELDS = ["full_name", "email"] as const;
const RATE_LIMITED = "Too many invitations in a short time. Wait a minute and try again.";
/** Removed staff stay banned until re-invited; Supabase takes a duration. */
const BAN_FOREVER = "876000h";
const STAFF_PATH = "/settings/staff";

type Admin = ReturnType<typeof createAdminClient>;

function authorizationFailure(error: unknown, values?: Record<string, string>): FormState {
  if (error instanceof AuthorizationError) return formFailure(error.message, values);
  throw error;
}

/**
 * The owner and the hostel they are managing. Owners only ever see hostels
 * they own, so the active hostel is one of theirs.
 */
async function ownerAndHostel(formData: FormData) {
  const user = await requireRole(["owner"]);
  const checked = await formHostel(formData);
  if ("error" in checked) return { user, hostel: null, hostelError: checked.error };
  const hostel = (await getHostelContext()).active!;
  return { user, hostel, hostelError: null };
}

async function accountByEmail(admin: Admin, email: string) {
  const { data, error } = await admin.rpc("account_by_email", { p_email: email });
  if (error) throw error;
  return data[0] ?? null;
}

/**
 * Creates the auth user, sends the invitation email and makes the profile
 * staff of the hostel. Returns the new user's id, or the error. If the
 * profile cannot be made staff the user is deleted again, so a half-made
 * invitation never leaves an owner account behind.
 */
async function sendInvite(
  admin: Admin,
  input: {
    email: string;
    fullName: string;
    hostelId: string;
    hostelName: string;
    ownerName: string;
  },
) {
  const { data, error } = await admin.auth.admin.inviteUserByEmail(input.email, {
    data: {
      full_name: input.fullName,
      hostel_name: input.hostelName,
      invited_by_name: input.ownerName,
    },
  });
  if (error || !data.user)
    return { error: error ?? new Error("inviteUserByEmail returned no user") };

  const userId = data.user.id;
  const { error: profileError } = await admin
    .from("profiles")
    .update({ role: "staff", hostel_id: input.hostelId, full_name: input.fullName })
    .eq("id", userId);
  if (profileError) {
    await admin.auth.admin.deleteUser(userId);
    return { error: profileError };
  }
  return { userId };
}

// ---------------------------------------------------------------------------
// Invite
// ---------------------------------------------------------------------------

export async function inviteStaff(_previous: FormState, formData: FormData): Promise<FormState> {
  const values = formValues(formData, INVITE_FIELDS);
  let owner;
  try {
    owner = await ownerAndHostel(formData);
  } catch (error) {
    return authorizationFailure(error, values);
  }
  const { user, hostel } = owner;
  if (!hostel) return formFailure(owner.hostelError, values);

  const parsed = validateFormData(staffInviteSchema, formData);
  if (!parsed.ok) return formFailure(undefined, values, parsed.fieldErrors);
  const { full_name: fullName, email } = parsed.data;

  const supabase = await createClient();
  const { data: open, error: openError } = await supabase
    .from("staff_invitations")
    .select("id")
    .eq("hostel_id", hostel.id)
    .eq("email", email)
    .is("revoked_at", null)
    .maybeSingle();
  if (openError) return unexpectedFailure("inviteStaff", openError, values);
  if (open) {
    return formFailure(undefined, values, {
      email: [
        "This person is already invited. Use Resend in the list below if they lost the email.",
      ],
    });
  }

  const admin = createAdminClient();
  let account;
  try {
    account = await accountByEmail(admin, email);
  } catch (error) {
    return unexpectedFailure("inviteStaff", error, values);
  }

  if (account) {
    // A staff member removed from this hostel can be given access again.
    const returning =
      account.role === "staff" && account.hostel_id === hostel.id && account.deactivated;
    if (!returning) {
      return formFailure(undefined, values, {
        email: ["This email already has a Hostel ERP account. Staff need their own email address."],
      });
    }
    const { error: profileError } = await admin
      .from("profiles")
      .update({ deactivated_at: null })
      .eq("id", account.user_id);
    if (profileError) return unexpectedFailure("inviteStaff", profileError, values);
    const { error: banError } = await admin.auth.admin.updateUserById(account.user_id, {
      ban_duration: "none",
    });
    if (banError) return unexpectedFailure("inviteStaff", banError, values);
    const now = new Date().toISOString();
    const { error: insertError } = await admin.from("staff_invitations").insert({
      hostel_id: hostel.id,
      email,
      full_name: fullName,
      profile_id: account.user_id,
      invited_by: user.id,
      accepted_at: now,
    });
    if (insertError) return unexpectedFailure("inviteStaff", insertError, values);
    revalidatePath(STAFF_PATH);
    return formSuccess(
      `${fullName} has access to ${hostel.name} again. They sign in with their existing password.`,
    );
  }

  const sent = await sendInvite(admin, {
    email,
    fullName,
    hostelId: hostel.id,
    hostelName: hostel.name,
    ownerName: user.fullName,
  });
  if ("error" in sent) {
    const status = (sent.error as { status?: number }).status;
    if (status === 429) return formFailure(RATE_LIMITED, values);
    return unexpectedFailure("inviteStaff", sent.error, values);
  }

  const { error: insertError } = await admin.from("staff_invitations").insert({
    hostel_id: hostel.id,
    email,
    full_name: fullName,
    profile_id: sent.userId,
    invited_by: user.id,
  });
  if (insertError) {
    await admin.auth.admin.deleteUser(sent.userId);
    return unexpectedFailure("inviteStaff", insertError, values);
  }

  revalidatePath(STAFF_PATH);
  return formSuccess(`Invitation sent to ${email}. The link in it works for one hour.`);
}

// ---------------------------------------------------------------------------
// Resend and revoke a pending invitation
// ---------------------------------------------------------------------------

/** The owner's own pending invitation, read through RLS. */
async function pendingInvitation(invitationId: unknown) {
  const id = uuid("Invitation").safeParse(invitationId);
  if (!id.success) return null;
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("staff_invitations")
    .select("id, hostel_id, email, full_name, profile_id, accepted_at, revoked_at")
    .eq("id", id.data)
    .maybeSingle();
  if (error) throw error;
  if (!data || data.accepted_at || data.revoked_at) return null;
  return data;
}

const NOT_PENDING = "This invitation was already accepted or cancelled. Refresh the page.";

export async function resendInvitation(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  let owner;
  try {
    owner = await ownerAndHostel(formData);
  } catch (error) {
    return authorizationFailure(error);
  }
  const { user, hostel } = owner;
  if (!hostel) return formFailure(owner.hostelError);

  try {
    const invitation = await pendingInvitation(formData.get("invitation_id"));
    if (!invitation || invitation.hostel_id !== hostel.id) return formFailure(NOT_PENDING);

    const admin = createAdminClient();
    const account = await accountByEmail(admin, invitation.email);
    if (account?.email_confirmed) {
      return formFailure(
        `${invitation.full_name} already opened the invitation. They can choose a password with "Forgot password" on the sign-in page.`,
      );
    }

    // The old link can't be reissued, so the unused account is replaced.
    if (account) await admin.auth.admin.deleteUser(account.user_id);
    const sent = await sendInvite(admin, {
      email: invitation.email,
      fullName: invitation.full_name,
      hostelId: hostel.id,
      hostelName: hostel.name,
      ownerName: user.fullName,
    });
    if ("error" in sent) {
      if ((sent.error as { status?: number }).status === 429) return formFailure(RATE_LIMITED);
      return unexpectedFailure("resendInvitation", sent.error);
    }
    const { error } = await admin
      .from("staff_invitations")
      .update({ profile_id: sent.userId, invited_at: new Date().toISOString() })
      .eq("id", invitation.id);
    if (error) return unexpectedFailure("resendInvitation", error);
  } catch (error) {
    return unexpectedFailure("resendInvitation", error);
  }

  revalidatePath(STAFF_PATH);
  return formSuccess("Invitation sent again.");
}

export async function revokeInvitation(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  let owner;
  try {
    owner = await ownerAndHostel(formData);
  } catch (error) {
    return authorizationFailure(error);
  }
  const { user, hostel } = owner;
  if (!hostel) return formFailure(owner.hostelError);

  try {
    const invitation = await pendingInvitation(formData.get("invitation_id"));
    if (!invitation || invitation.hostel_id !== hostel.id) return formFailure(NOT_PENDING);

    const admin = createAdminClient();
    const account = await accountByEmail(admin, invitation.email);
    if (account && !account.email_confirmed) {
      // Never used: the account has no history, so it goes entirely.
      await admin.auth.admin.deleteUser(account.user_id);
    } else if (account) {
      const removed = await deactivate(admin, account.user_id);
      if (removed) return unexpectedFailure("revokeInvitation", removed);
    }
    const { error } = await admin
      .from("staff_invitations")
      .update({ revoked_at: new Date().toISOString(), revoked_by: user.id })
      .eq("id", invitation.id);
    if (error) return unexpectedFailure("revokeInvitation", error);
  } catch (error) {
    return unexpectedFailure("revokeInvitation", error);
  }

  revalidatePath(STAFF_PATH);
  return formSuccess("Invitation cancelled.");
}

// ---------------------------------------------------------------------------
// Remove a staff member
// ---------------------------------------------------------------------------

/** Ends membership now (database) and blocks new sign-ins (auth). */
async function deactivate(admin: Admin, profileId: string): Promise<unknown> {
  const { error } = await admin
    .from("profiles")
    .update({ deactivated_at: new Date().toISOString() })
    .eq("id", profileId);
  if (error) return error;
  const { error: banError } = await admin.auth.admin.updateUserById(profileId, {
    ban_duration: BAN_FOREVER,
  });
  return banError ?? null;
}

export async function removeStaff(_previous: FormState, formData: FormData): Promise<FormState> {
  let owner;
  try {
    owner = await ownerAndHostel(formData);
  } catch (error) {
    return authorizationFailure(error);
  }
  const { user, hostel } = owner;
  if (!hostel) return formFailure(owner.hostelError);

  const id = uuid("Staff member").safeParse(formData.get("profile_id"));
  if (!id.success) return formFailure("This staff member could not be found. Refresh the page.");

  // Owners can read the staff profiles of their own hostels only.
  const supabase = await createClient();
  const { data: staff, error } = await supabase
    .from("profiles")
    .select("id, full_name, hostel_id, deactivated_at")
    .eq("id", id.data)
    .eq("role", "staff")
    .maybeSingle();
  if (error) return unexpectedFailure("removeStaff", error);
  if (!staff || staff.hostel_id !== hostel.id) {
    return formFailure("This staff member could not be found. Refresh the page.");
  }
  if (staff.deactivated_at) return formSuccess(`${staff.full_name} was already removed.`);

  const admin = createAdminClient();
  const failed = await deactivate(admin, staff.id);
  if (failed) return unexpectedFailure("removeStaff", failed);
  const { error: revokeError } = await admin
    .from("staff_invitations")
    .update({ revoked_at: new Date().toISOString(), revoked_by: user.id })
    .eq("profile_id", staff.id)
    .is("revoked_at", null);
  if (revokeError) return unexpectedFailure("removeStaff", revokeError);

  revalidatePath(STAFF_PATH);
  return formSuccess(`${staff.full_name} no longer has access to ${hostel.name}.`);
}

// ---------------------------------------------------------------------------
// Accept (the invited person, signed in through the email link)
// ---------------------------------------------------------------------------

export async function acceptInvitation(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  const parsed = validateFormData(acceptInvitationSchema, formData);
  if (!parsed.ok) return formFailure(undefined, undefined, parsed.fieldErrors);

  const user = await getSessionUser();
  if (!user || user.role !== "staff") {
    return formFailure("Your invitation link has expired. Ask the hostel owner to send it again.");
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.updateUser({ password: parsed.data.password });
  if (error) {
    if (error.code === "weak_password") {
      return formFailure(undefined, undefined, { password: ["Choose a stronger password"] });
    }
    return unexpectedFailure("acceptInvitation", error);
  }

  const { error: acceptError } = await createAdminClient()
    .from("staff_invitations")
    .update({ accepted_at: new Date().toISOString() })
    .eq("profile_id", user.id)
    .is("accepted_at", null)
    .is("revoked_at", null);
  if (acceptError) return unexpectedFailure("acceptInvitation", acceptError);

  redirect("/dashboard");
}
