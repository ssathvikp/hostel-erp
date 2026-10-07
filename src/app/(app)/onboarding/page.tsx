import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { PageHeader } from "@/components/shell/PageHeader";
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
  // Staff join an existing hostel; only owners create one.
  if (user.role !== "owner") redirect("/dashboard");

  const { draft, hostels } = await getHostelContext();
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
