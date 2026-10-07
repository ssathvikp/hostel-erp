"use server";

import type { AuthError } from "@supabase/supabase-js";
import { redirect } from "next/navigation";

import { safeNextPath } from "@/lib/auth/redirect";
import { createClient } from "@/lib/supabase/server";
import {
  forgotPasswordSchema,
  formValues,
  loginSchema,
  resetPasswordSchema,
  signupSchema,
  validateFormData,
  type FormState,
} from "@/lib/validation";

const RATE_LIMITED = "Too many attempts. Wait a minute and try again.";
const UNEXPECTED = "Something went wrong on our side. Try again in a moment.";

function isRateLimited(error: AuthError) {
  return error.status === 429 || error.code === "over_request_rate_limit";
}

function failure(
  formError: string | undefined,
  values?: Record<string, string>,
  fieldErrors: FormState["fieldErrors"] = {},
): FormState {
  return { status: "error", formError, fieldErrors, values };
}

// ---------------------------------------------------------------------------
// Sign up (E2-T2)
// ---------------------------------------------------------------------------

export async function signUp(_previous: FormState, formData: FormData): Promise<FormState> {
  const values = formValues(formData, ["full_name", "email"]);
  const parsed = validateFormData(signupSchema, formData);
  if (!parsed.ok) return failure(undefined, values, parsed.fieldErrors);

  const { full_name, email, password } = parsed.data;
  const supabase = await createClient();
  const { data, error } = await supabase.auth.signUp({
    email,
    password,
    options: { data: { full_name } },
  });

  if (error) {
    if (isRateLimited(error)) return failure(RATE_LIMITED, values);
    if (error.code === "weak_password") {
      return failure(undefined, values, { password: ["Choose a stronger password"] });
    }
    return failure(UNEXPECTED, values);
  }

  // Only reachable if email confirmation is switched off.
  if (data.session) redirect("/onboarding");

  // Supabase answers an already-registered address exactly like a new one,
  // so this message never reveals whether an account exists.
  return {
    status: "success",
    fieldErrors: {},
    message: email,
  };
}

// ---------------------------------------------------------------------------
// Sign in and sign out (E2-T3)
// ---------------------------------------------------------------------------

export async function signIn(_previous: FormState, formData: FormData): Promise<FormState> {
  const values = formValues(formData, ["email"]);
  const parsed = validateFormData(loginSchema, formData);
  if (!parsed.ok) return failure(undefined, values, parsed.fieldErrors);

  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword(parsed.data);

  if (error) {
    if (isRateLimited(error)) return failure(RATE_LIMITED, values);
    if (error.code === "email_not_confirmed") {
      return failure(
        "Confirm your email address first. The link is in the email we sent when you signed up.",
        values,
      );
    }
    // One message for unknown email and wrong password alike.
    return failure("Incorrect email or password.", values);
  }

  redirect(safeNextPath(formData.get("next")));
}

export async function signOut(): Promise<void> {
  const supabase = await createClient();
  // Local scope: ends this device's session only.
  await supabase.auth.signOut({ scope: "local" });
  redirect("/login");
}

// ---------------------------------------------------------------------------
// Password reset (E2-T7)
// ---------------------------------------------------------------------------

export async function requestPasswordReset(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  const values = formValues(formData, ["email"]);
  const parsed = validateFormData(forgotPasswordSchema, formData);
  if (!parsed.ok) return failure(undefined, values, parsed.fieldErrors);

  const supabase = await createClient();
  const { error } = await supabase.auth.resetPasswordForEmail(parsed.data.email);
  if (error && isRateLimited(error)) return failure(RATE_LIMITED, values);

  // Same answer whether or not the address is registered.
  return { status: "success", fieldErrors: {}, message: parsed.data.email };
}

export async function resetPassword(_previous: FormState, formData: FormData): Promise<FormState> {
  const parsed = validateFormData(resetPasswordSchema, formData);
  if (!parsed.ok) return failure(undefined, undefined, parsed.fieldErrors);

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return failure("Your reset link has expired. Request a new one to choose a password.");
  }

  const { error } = await supabase.auth.updateUser({ password: parsed.data.password });
  if (error) {
    if (isRateLimited(error)) return failure(RATE_LIMITED);
    if (error.code === "same_password") {
      return failure(undefined, undefined, {
        password: ["Choose a password you have not used before"],
      });
    }
    if (error.code === "weak_password") {
      return failure(undefined, undefined, { password: ["Choose a stronger password"] });
    }
    return failure(UNEXPECTED);
  }

  // A reset usually means the old password may be known to someone else:
  // end every other session, keep this one.
  await supabase.auth.signOut({ scope: "others" });
  redirect("/dashboard");
}
