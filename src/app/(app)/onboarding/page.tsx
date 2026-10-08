import type { Metadata } from "next";

import { PageHeader } from "@/components/shell/PageHeader";
import { EmptyState } from "@/components/ui";

export const metadata: Metadata = { title: "Set up your hostel" };

/** Placeholder until the onboarding wizard lands (E3-T3). */
export default function OnboardingPage() {
  return (
    <>
      <PageHeader
        title="Set up your hostel"
        description="Your account is ready. Next, tell us about your hostel."
      />
      <EmptyState
        title="Hostel setup is coming next"
        description="The two-step setup wizard for your hostel's details, address and capacity arrives with the onboarding epic."
      />
    </>
  );
}
