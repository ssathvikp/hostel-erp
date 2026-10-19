import "server-only";

import type { SetupFacts } from "@/lib/hostels/activation";
import type { createClient } from "@/lib/supabase/server";

type Supabase = Awaited<ReturnType<typeof createClient>>;

/** What the owner has set up so far (plan E15-T2). Counts only, one cheap query each. */
export async function getSetupFacts(supabase: Supabase, hostelId: string): Promise<SetupFacts> {
  const count = { count: "exact", head: true } as const;
  const [beds, rates, allocations, invoices, payments] = await Promise.all([
    supabase.from("bed_states").select("id", count).eq("hostel_id", hostelId),
    supabase.from("fee_structures").select("id", count).eq("hostel_id", hostelId),
    supabase.from("allocations").select("id", count).eq("hostel_id", hostelId),
    supabase.from("invoices").select("id", count).eq("hostel_id", hostelId).eq("kind", "rent"),
    supabase.from("payments").select("id", count).eq("hostel_id", hostelId),
  ]);
  for (const result of [beds, rates, allocations, invoices, payments]) {
    if (result.error) throw result.error;
  }
  return {
    beds: beds.count ?? 0,
    ratesSet: (rates.count ?? 0) > 0,
    allocationsEver: allocations.count ?? 0,
    invoiced: (invoices.count ?? 0) > 0,
    paymentRecorded: (payments.count ?? 0) > 0,
  };
}
