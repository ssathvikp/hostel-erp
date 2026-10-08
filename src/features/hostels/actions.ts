"use server";

import type { PostgrestError } from "@supabase/supabase-js";
import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";

import { AuthorizationError } from "@/lib/auth/roles";
import { requireRole } from "@/lib/auth/session";
import { getHostelContext } from "@/lib/hostels/active";
import { ACTIVE_HOSTEL_COOKIE, ACTIVE_HOSTEL_COOKIE_OPTIONS } from "@/lib/hostels/cookie";
import { createClient } from "@/lib/supabase/server";
import {
  formFailure,
  formSuccess,
  formValues,
  hostelAddressSchema,
  hostelBasicsSchema,
  hostelSchema,
  uuid,
  validateFormData,
  type FormState,
} from "@/lib/validation";

const UNEXPECTED = "Something went wrong on our side. Try again in a moment.";

const BASICS_FIELDS = ["name", "type", "phone"] as const;
const ADDRESS_FIELDS = ["address", "city", "state", "pincode", "alt_phone", "email", "floors"];
const SETTINGS_FIELDS = [...BASICS_FIELDS, ...ADDRESS_FIELDS, "gstin"];

function authorizationFailure(error: unknown, values?: Record<string, string>): FormState {
  if (error instanceof AuthorizationError) {
    return formFailure(
      error.reason === "forbidden"
        ? "Only the hostel owner can do this. Ask the owner to make the change."
        : error.message,
      values,
    );
  }
  throw error;
}

/** Maps a duplicate-name violation to a field error; anything else is unexpected. */
function nameConflict(error: PostgrestError, name: string, values: Record<string, string>) {
  if (error.code === "23505" && error.message.includes("hostels_owner_name_key")) {
    return formFailure(undefined, values, {
      name: [`You already have a hostel called "${name}". Choose a different name.`],
    });
  }
  return null;
}

async function setActiveHostelCookie(hostelId: string) {
  (await cookies()).set(ACTIVE_HOSTEL_COOKIE, hostelId, ACTIVE_HOSTEL_COOKIE_OPTIONS);
}

// ---------------------------------------------------------------------------
// Onboarding (E3-T3, E3-T4, E3-T6)
// ---------------------------------------------------------------------------

/** Step 1: creates the owner's draft hostel, or updates it when resuming. */
export async function saveHostelBasics(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  const values = formValues(formData, BASICS_FIELDS);
  try {
    await requireRole(["owner"]);
  } catch (error) {
    return authorizationFailure(error, values);
  }

  const parsed = validateFormData(hostelBasicsSchema, formData);
  if (!parsed.ok) return formFailure(undefined, values, parsed.fieldErrors);

  const supabase = await createClient();
  const { draft } = await getHostelContext();

  let error: PostgrestError | null;
  if (draft) {
    ({ error } = await supabase.from("hostels").update(parsed.data).eq("id", draft.id));
  } else {
    ({ error } = await supabase.from("hostels").insert(parsed.data));
    // A double-submitted step 1 loses the race to the one-draft-per-owner
    // index; the first submission already created the draft, so update it.
    if (error?.code === "23505" && error.message.includes("hostels_one_draft_per_owner")) {
      ({ error } = await supabase.from("hostels").update(parsed.data).eq("status", "draft"));
    }
  }

  if (error)
    return nameConflict(error, parsed.data.name, values) ?? formFailure(UNEXPECTED, values);

  revalidatePath("/onboarding");
  redirect("/onboarding?step=2");
}

/** Step 2: completes the draft and makes it the active hostel. */
export async function completeHostelOnboarding(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  const values = formValues(formData, ADDRESS_FIELDS);
  try {
    await requireRole(["owner"]);
  } catch (error) {
    return authorizationFailure(error, values);
  }

  const parsed = validateFormData(hostelAddressSchema, formData);
  if (!parsed.ok) return formFailure(undefined, values, parsed.fieldErrors);

  const { draft } = await getHostelContext();
  // Already completed (for example a double-submitted final step): the
  // transition happened exactly once, so just continue.
  if (!draft) redirect("/dashboard");

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("hostels")
    .update({ ...parsed.data, status: "active" })
    .eq("id", draft.id)
    .eq("status", "draft")
    .select("id")
    .maybeSingle();

  if (error) return formFailure(UNEXPECTED, values);
  if (data) await setActiveHostelCookie(data.id);

  revalidatePath("/", "layout");
  redirect("/dashboard");
}

/**
 * Lets the step 1 form warn about a duplicate name before submitting. The
 * database constraint is still the real guard.
 */
export async function isHostelNameTaken(name: string): Promise<boolean> {
  const trimmed = name.trim();
  if (!trimmed) return false;

  const user = await requireRole(["owner"]).catch(() => null);
  if (!user) return false;

  const { draft } = await getHostelContext();
  const supabase = await createClient();
  let query = supabase
    .from("hostels")
    .select("id")
    .eq("owner_id", user.id)
    .ilike(
      "name",
      trimmed.replace(/[\\%_]/g, (char) => `\\${char}`),
    );
  if (draft) query = query.neq("id", draft.id);

  const { data } = await query.limit(1);
  return (data ?? []).length > 0;
}

// ---------------------------------------------------------------------------
// Settings (E3-T5)
// ---------------------------------------------------------------------------

export async function updateHostelSettings(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  const values = formValues(formData, SETTINGS_FIELDS);
  try {
    await requireRole(["owner"]);
  } catch (error) {
    return authorizationFailure(error, values);
  }

  const parsed = validateFormData(hostelSchema, formData);
  if (!parsed.ok) return formFailure(undefined, values, parsed.fieldErrors);

  // The hostel comes from the session, never from the form, so a tampered
  // request cannot name another hostel. RLS backs this up.
  const { active } = await getHostelContext();
  if (!active) return formFailure("Finish setting up your hostel first.", values);

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("hostels")
    .update(parsed.data)
    .eq("id", active.id)
    .select("id")
    .maybeSingle();

  if (error)
    return nameConflict(error, parsed.data.name, values) ?? formFailure(UNEXPECTED, values);
  if (!data) return formFailure("Only the hostel owner can change these details.", values);

  revalidatePath("/", "layout");
  return formSuccess("Hostel details saved.");
}

// ---------------------------------------------------------------------------
// Hostel switcher (E3-T7)
// ---------------------------------------------------------------------------

export async function switchHostel(formData: FormData): Promise<void> {
  const parsed = uuid("Hostel").safeParse(formData.get("hostel_id"));
  const { hostels } = await getHostelContext();

  // Only switch to a hostel the user is a member of; anything else is ignored.
  if (parsed.success && hostels.some((hostel) => hostel.id === parsed.data)) {
    await setActiveHostelCookie(parsed.data);
  }

  // Leave the current page so nothing rendered for the previous hostel stays
  // on screen, and rebuild every server component for the new one.
  revalidatePath("/", "layout");
  redirect("/dashboard");
}
