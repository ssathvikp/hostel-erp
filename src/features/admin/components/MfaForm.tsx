"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState, useTransition } from "react";

import { Alert, Button, Input } from "@/components/ui";
import { createClient } from "@/lib/supabase/client";

interface Enrolment {
  factorId: string;
  qrCode: string;
  secret: string;
}

/**
 * The second sign-in step for platform admins (ClickUp E10-T1). With a
 * verified authenticator, asks for its 6-digit code; otherwise enrols one
 * first, showing a QR code and the secret to type in by hand.
 */
export function MfaForm({ factorId }: { factorId: string | null }) {
  const router = useRouter();
  const [enrolment, setEnrolment] = useState<Enrolment | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [code, setCode] = useState("");
  const [pending, startTransition] = useTransition();

  useEffect(() => {
    if (factorId) return;
    let cancelled = false;
    (async () => {
      const supabase = createClient();
      // An enrolment left unfinished earlier would block a new one.
      const { data: factors } = await supabase.auth.mfa.listFactors();
      for (const factor of factors?.all ?? []) {
        if (factor.status === "unverified")
          await supabase.auth.mfa.unenroll({ factorId: factor.id });
      }
      const { data, error: enrolError } = await supabase.auth.mfa.enroll({
        factorType: "totp",
        friendlyName: `Hostel ERP admin ${new Date().toISOString().slice(0, 10)}`,
      });
      if (cancelled) return;
      if (enrolError || !data) {
        setError("Could not start setting up the authenticator. Refresh the page to try again.");
        return;
      }
      setEnrolment({ factorId: data.id, qrCode: data.totp.qr_code, secret: data.totp.secret });
    })();
    return () => {
      cancelled = true;
    };
  }, [factorId]);

  const activeFactor = factorId ?? enrolment?.factorId ?? null;

  function verify(event: React.FormEvent) {
    event.preventDefault();
    if (!activeFactor) return;
    if (!/^\d{6}$/.test(code.trim())) {
      setError("Enter the 6-digit code from your authenticator app.");
      return;
    }
    startTransition(async () => {
      const { error: verifyError } = await createClient().auth.mfa.challengeAndVerify({
        factorId: activeFactor,
        code: code.trim(),
      });
      if (verifyError) {
        setError("That code did not work. Codes change every 30 seconds; try the current one.");
        return;
      }
      router.replace("/admin");
      router.refresh();
    });
  }

  return (
    <form onSubmit={verify} noValidate className="space-y-4">
      {error && <Alert tone="error">{error}</Alert>}
      {!factorId && enrolment && (
        <div className="space-y-3 text-sm text-slate-700">
          <p>
            Scan this code with an authenticator app (Google Authenticator, Microsoft Authenticator,
            1Password or similar), then enter the 6-digit code it shows.
          </p>
          {/* eslint-disable-next-line @next/next/no-img-element -- a data URL from Supabase */}
          <img
            src={enrolment.qrCode}
            alt="QR code for your authenticator app"
            className="size-44 rounded border border-slate-200 bg-white p-2"
          />
          <p>
            Can&apos;t scan it? Enter this key by hand:{" "}
            <code
              data-testid="totp-secret"
              className="rounded bg-slate-100 px-1 font-mono break-all"
            >
              {enrolment.secret}
            </code>
          </p>
        </div>
      )}
      <Input
        id="mfa-code"
        name="code"
        label="6-digit code"
        inputMode="numeric"
        autoComplete="one-time-code"
        maxLength={6}
        value={code}
        onChange={(event) => setCode(event.target.value)}
        required
      />
      <Button type="submit" loading={pending} disabled={!activeFactor}>
        {factorId ? "Confirm" : "Turn on and continue"}
      </Button>
    </form>
  );
}
