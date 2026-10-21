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

const UNIQUE_VIOLATION = "23505";

function alreadyInvited(values: Record<string, string>): FormState {
  return formFailure(undefined, values, {
    email: ["This person is already invited. Use Resend in the list below if they lost the email."],
  });
}

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
 * Deletes an auth user created for an invitation, but only while no open
 * invitation points at it. Two owners' clicks racing on the same address
 * can be handed the same not-yet-confirmed user by Supabase, and deleting
 * it would break the invitation that did succeed.
 */
async function discardUnusedUser(admin: Admin, userId: string): Promise<void> {
  const { data, error } = await admin
    .from("staff_invitations")
    .select("id")
    .eq("profile_id", userId)
    .is("revoked_at", null)
    .limit(1);
  if (error || (data && data.length > 0)) return;
  await admin.auth.admin.deleteUser(userId);
}

/**
 * The account an invitation created, if it still exists and is still that
 * invitation's: the same user, staff of this hostel. An email can outlive
 * its invitation's account (deleted on resend, or never created) and later
 * belong to someone else entirely, such as an owner who signed up on their
 * own. That account must never be deleted or banned from here.
 */
async function invitedAccount(
  admin: Admin,
  invitation: { email: string; profile_id: string | null },
  hostelId: string,
) {
  const account = await accountByEmail(admin, invitation.email);
  if (!account) return { account: null, foreign: false } as const;
  const ours =
    invitation.profile_id !== null &&
    account.user_id === invitation.profile_id &&
    account.role === "staff" &&
    account.hostel_id === hostelId;
  return ours
    ? ({ account, foreign: false } as const)
    : ({ account: null, foreign: true } as const);
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
    await discardUnusedUser(admin, userId);
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
  if (open) return alreadyInvited(values);

  // The invitation is written with the service role, which the database's
  // read-only and plan-limit rules do not limit; check them first as the owner.
  const { error: limitError } = await supabase.rpc("check_account_can_add", {
    p_hostel_id: hostel.id,
    p_kind: "staff",
  });
  if (limitError) return unexpectedFailure("inviteStaff", limitError, values);

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
    // Record the invitation first: if a later step fails it is withdrawn
    // again, so the list never shows "removed" for someone with access.
    const { data: invitation, error: insertError } = await admin
      .from("staff_invitations")
      .insert({
        hostel_id: hostel.id,
        email,
        full_name: fullName,
        profile_id: account.user_id,
        invited_by: user.id,
        accepted_at: new Date().toISOString(),
      })
      .select("id")
      .single();
    if (insertError) {
      if (insertError.code === UNIQUE_VIOLATION) return alreadyInvited(values);
      return unexpectedFailure("inviteStaff", insertError, values);
    }
    const { error: banError } = await admin.auth.admin.updateUserById(account.user_id, {
      ban_duration: "none",
    });
    const { error: profileError } = banError
      ? { error: null }
      : await admin.from("profiles").update({ deactivated_at: null }).eq("id", account.user_id);
    if (banError || profileError) {
      await admin.auth.admin.updateUserById(account.user_id, { ban_duration: BAN_FOREVER });
      await admin.from("staff_invitations").delete().eq("id", invitation.id);
      return unexpectedFailure("inviteStaff", banError ?? profileError, values);
    }
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
    await discardUnusedUser(admin, sent.userId);
    // Another click invited the same address a moment earlier.
    if (insertError.code === UNIQUE_VIOLATION) return alreadyInvited(values);
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
    const { account, foreign } = await invitedAccount(admin, invitation, hostel.id);
    if (foreign) {
      // The address now belongs to an account this invitation did not make.
      await withdraw(admin, invitation.id, user.id);
      revalidatePath(STAFF_PATH);
      return formFailure(
        `${invitation.email} now has its own Hostel ERP account, so this invitation was cancelled. Invite them with a different email address.`,
      );
    }
    if (account?.email_confirmed) {
      return formFailure(
        `${invitation.full_name} already opened the invitation. They can choose a password with "Forgot password" on the sign-in page.`,
      );
    }

    // The old link can't be reissued, so the unused account is replaced.
    if (account) {
      const { error: deleteError } = await admin.auth.admin.deleteUser(account.user_id);
      if (deleteError) return unexpectedFailure("resendInvitation", deleteError);
    }
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
    // Only the account this invitation created is touched; an address that
    // now belongs to someone else just has its invitation withdrawn.
    const { account } = await invitedAccount(admin, invitation, hostel.id);
    if (account && !account.email_confirmed) {
      // Never used: the account has no history, so it goes entirely.
      const { error: deleteError } = await admin.auth.admin.deleteUser(account.user_id);
      if (deleteError) return unexpectedFailure("revokeInvitation", deleteError);
    } else if (account) {
      const removed = await deactivate(admin, account.user_id);
      if (removed) return unexpectedFailure("revokeInvitation", removed);
    }
    const error = await withdraw(admin, invitation.id, user.id);
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

/** Marks an invitation withdrawn. Returns the error, if any. */
async function withdraw(admin: Admin, invitationId: string, ownerId: string) {
  const { error } = await admin
    .from("staff_invitations")
    .update({ revoked_at: new Date().toISOString(), revoked_by: ownerId })
    .eq("id", invitationId)
    .is("revoked_at", null);
  return error;
}

/**
 * Ends membership now (database) and blocks new sign-ins (auth). Safe to
 * repeat: an earlier attempt that deactivated but failed to ban is
 * finished by the next one, and the original removal time is kept.
 */
async function deactivate(admin: Admin, profileId: string): Promise<unknown> {
  const { error } = await admin
    .from("profiles")
    .update({ deactivated_at: new Date().toISOString() })
    .eq("id", profileId)
    .is("deactivated_at", null);
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
