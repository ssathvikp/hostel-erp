"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, type FormEvent } from "react";

import { Alert, Button, Input, Spinner } from "@/components/ui";
import { createClient } from "@/lib/supabase/client";

type State =
  | { step: "loading" }
  | { step: "enrol"; factorId: string; qr: string; secret: string }
  | { step: "verify"; factorId: string }
  | { step: "error"; message: string };

/**
 * Sets up or checks the admin's authenticator app (E10-T1). Admin pages
 * need a session verified with a TOTP code; a password alone is not enough.
 */
export function MfaPanel() {
  const router = useRouter();
  const [state, setState] = useState<State>({ step: "loading" });
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  // Enrolment must run once: a second concurrent enrol is refused.
  const started = useRef(false);

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    const supabase = createClient();
    (async () => {
      const { data, error: listError } = await supabase.auth.mfa.listFactors();
      if (listError) {
        setState({
          step: "error",
          message: "Could not read your sign-in methods. Reload the page.",
        });
        return;
      }
      const verified = data.totp.find((factor) => factor.status === "verified");
      if (verified) {
        setState({ step: "verify", factorId: verified.id });
        return;
      }
      // Leftovers from an enrolment that was never finished.
      for (const factor of data.all.filter((f) => f.status === "unverified")) {
        await supabase.auth.mfa.unenroll({ factorId: factor.id });
      }
      const enrolled = await supabase.auth.mfa.enroll({
        factorType: "totp",
        friendlyName: "Hostel ERP admin",
      });
      if (enrolled.error) {
        setState({ step: "error", message: "Could not start the set-up. Reload the page." });
        return;
      }
      setState({
        step: "enrol",
        factorId: enrolled.data.id,
        qr: enrolled.data.totp.qr_code,
        secret: enrolled.data.totp.secret,
      });
    })();
  }, []);

  async function verify(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (state.step !== "enrol" && state.step !== "verify") return;
    const code = String(new FormData(event.currentTarget).get("code") ?? "").replace(/\s/g, "");
    if (!/^\d{6}$/.test(code)) {
      setError("Enter the 6-digit code from your authenticator app");
      return;
    }
    setPending(true);
    setError(null);
    const { error: verifyError } = await createClient().auth.mfa.challengeAndVerify({
      factorId: state.factorId,
      code,
    });
    setPending(false);
    if (verifyError) {
      setError("That code did not work. Codes change every 30 seconds; try the current one.");
      return;
    }
    router.replace("/admin");
    router.refresh();
  }

  if (state.step === "loading") {
    return (
      <p role="status" className="flex items-center gap-2 text-sm text-slate-600">
        <Spinner className="size-4" /> Checking your sign-in methods
      </p>
    );
  }
  if (state.step === "error") return <Alert tone="error">{state.message}</Alert>;

  return (
    <div className="max-w-md space-y-5 rounded-lg border border-slate-200 bg-white p-5 sm:p-6">
      {state.step === "enrol" ? (
        <>
          <p className="text-sm text-slate-700">
            Scan this code with an authenticator app (Google Authenticator, Microsoft Authenticator,
            1Password or similar), then enter the 6-digit code it shows.
          </p>
          {/* A data URL produced by Supabase Auth; next/image adds nothing here. */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={state.qr}
            alt="QR code for your authenticator app"
            className="size-48 rounded border border-slate-200"
          />
          <p className="text-xs break-all text-slate-500">
            Or enter this key by hand: <span className="font-mono">{state.secret}</span>
          </p>
        </>
      ) : (
        <p className="text-sm text-slate-700">
          Enter the 6-digit code from your authenticator app to open the admin area.
        </p>
      )}
      <form onSubmit={verify} noValidate className="space-y-3">
        <Input
          id="code"
          label="Code"
          inputMode="numeric"
          autoComplete="one-time-code"
          maxLength={7}
          required
          error={error ?? undefined}
        />
        <Button type="submit" loading={pending}>
          Verify
        </Button>
      </form>
    </div>
  );
}
