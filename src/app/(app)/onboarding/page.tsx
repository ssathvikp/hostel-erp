import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { PageHeader } from "@/components/shell/PageHeader";
import { Alert, EmptyState } from "@/components/ui";
import { HostelAddressForm } from "@/features/hostels/components/HostelAddressForm";
import { HostelBasicsForm } from "@/features/hostels/components/HostelBasicsForm";
import { OnboardingSteps } from "@/features/hostels/components/OnboardingSteps";
import { requireUser } from "@/lib/auth/session";
import { getHostelContext } from "@/lib/hostels/active";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Set up your hostel" };

/**
 * Two-step onboarding wizard (E3-T3, E3-T4). The draft hostel saved by step 1
 * is the resume point: leaving and coming back continues where the owner
 * stopped (E3-T6).
 */
export default async function OnboardingPage({
  searchParams,
}: {
  searchParams: Promise<{ step?: string }>;
}) {
  const user = await requireUser();
  const { active, draft, hostels, suspended } = await getHostelContext();

  // Staff join an existing hostel; only owners create one. Without an active
  // hostel there is nowhere to send them, so explain instead: redirecting to
  // the dashboard would bounce straight back here.
  if (user.role !== "owner") {
    if (active) redirect("/dashboard");
    return (
      <div className="mx-auto max-w-2xl">
        <PageHeader title="No hostel to work in" />
        <EmptyState
          title={
            suspended.length > 0
              ? `${suspended[0].name} is not active right now`
              : "Your account is not linked to an active hostel"
          }
          description="Ask the hostel owner to contact Hostel ERP support. You can sign in again once the hostel is active."
        />
      </div>
    );
  }

  const { step: requested } = await searchParams;
  const step = requested === "2" && draft ? 2 : 1;

  const supabase = await createClient();
  const { data: details } = draft
    ? await supabase.from("hostels").select("*").eq("id", draft.id).single()
    : { data: null };

  const isFirstHostel = hostels.length === 0;
  const title = isFirstHostel ? "Set up your hostel" : "Add another hostel";

  return (
    <div className="mx-auto max-w-2xl">
      <PageHeader
        title={title}
        description={
          details
            ? `Continuing setup for ${details.name}. Your progress is saved.`
            : "Two short steps. You can stop at any time and pick up where you left off."
        }
      />
      {isFirstHostel && suspended.length > 0 && (
        <Alert tone="warning" className="mb-6">
          {suspended.map((hostel) => hostel.name).join(", ")}{" "}
          {suspended.length === 1 ? "is" : "are"} suspended, so{" "}
          {suspended.length === 1 ? "it does" : "they do"} not appear in the app. Contact Hostel ERP
          support to restore {suspended.length === 1 ? "it" : "them"}.
        </Alert>
      )}
      <div className="rounded-lg border border-slate-200 bg-white p-6 shadow-xs sm:p-8">
        <OnboardingSteps current={step} />
        {step === 1 ? (
          <HostelBasicsForm
            defaults={details}
            persistKey={`onboarding:${details?.id ?? "new"}:basics`}
          />
        ) : (
          <HostelAddressForm
            defaults={details!}
            persistKey={`onboarding:${details!.id}:address`}
            clearKey="onboarding:new:basics"
          />
        )}
      </div>
    </div>
  );
}
