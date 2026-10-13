"use server";

import type { PostgrestError } from "@supabase/supabase-js";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { AuthorizationError } from "@/lib/auth/roles";
import { requireRole } from "@/lib/auth/session";
import { logUnexpected, unexpectedFailure } from "@/lib/request-context";
import { createClient } from "@/lib/supabase/server";
import { formFailure, formSuccess, formValues, uuid, type FormState } from "@/lib/validation";

/** Data protection actions for owners (E10-T10). */

const RULE_MESSAGES: Record<string, string> = {
  reason_required: "Give a reason of at least a few words. It is kept with the record.",
  resident_not_vacated:
    "Only a resident who has left can be erased. Vacate their bed and mark them vacated first.",
  resident_erased: "This resident has already been erased.",
  closure_scheduled: "Closing your account is already scheduled.",
};

async function failure(action: string, error: PostgrestError, values?: Record<string, string>) {
  const message = error.code === "P0001" && error.hint ? RULE_MESSAGES[error.hint] : undefined;
  return message ? formFailure(message, values) : unexpectedFailure(action, error, values);
}

function authorizationFailure(error: unknown, values?: Record<string, string>): FormState {
  if (error instanceof AuthorizationError) return formFailure(error.message, values);
  throw error;
}

/**
 * Erases a resident who has left: personal fields and the ID proof go, the
 * financial records stay. Cannot be undone.
 */
export async function eraseResident(_previous: FormState, formData: FormData): Promise<FormState> {
  const values = formValues(formData, ["reason"]);
  try {
    await requireRole(["owner"]);
  } catch (error) {
    return authorizationFailure(error, values);
  }
  const id = uuid("Resident").safeParse(formData.get("resident_id"));
  if (!id.success) return formFailure("This resident could not be found.", values);
  if (formData.get("confirm") !== "ERASE") {
    return formFailure(undefined, values, { confirm: ["Type the word ERASE in capitals"] });
  }

  const supabase = await createClient();
  const { data: path, error } = await supabase.rpc("erase_resident", {
    p_resident_id: id.data,
    p_reason: String(formData.get("reason") ?? ""),
  });
  if (error) return failure("eraseResident", error, values);

  if (path) {
    const { error: removeError } = await supabase.storage.from("id-proofs").remove([path]);
    // The record no longer points at it; log so an operator can remove it.
    if (removeError) await logUnexpected("eraseResident: ID proof file not removed", removeError);
  }

  revalidatePath("/residents", "layout");
  redirect(`/residents/${id.data}?erased=1`);
}

export async function requestAccountClosure(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  const values = formValues(formData, ["reason"]);
  try {
    await requireRole(["owner"]);
  } catch (error) {
    return authorizationFailure(error, values);
  }
  if (formData.get("confirm") !== "CLOSE") {
    return formFailure(undefined, values, { confirm: ["Type the word CLOSE in capitals"] });
  }
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("request_account_closure", {
    p_reason: String(formData.get("reason") ?? "") || undefined,
  });
  if (error) return failure("requestAccountClosure", error, values);

  revalidatePath("/settings/hostel");
  const on = new Intl.DateTimeFormat("en-IN", { dateStyle: "long", timeZone: "UTC" }).format(
    new Date(data),
  );
  return formSuccess(
    `Your account is scheduled to close on ${on}. Download your data before then.`,
  );
}

export async function cancelAccountClosure(): Promise<FormState> {
  try {
    await requireRole(["owner"]);
  } catch (error) {
    return authorizationFailure(error);
  }
  const supabase = await createClient();
  const { error } = await supabase.rpc("cancel_account_closure");
  if (error) return failure("cancelAccountClosure", error);
  revalidatePath("/settings/hostel");
  return formSuccess("Closing your account is cancelled.");
}
