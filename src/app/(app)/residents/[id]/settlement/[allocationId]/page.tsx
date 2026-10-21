import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { PageHeader } from "@/components/shell/PageHeader";
import { Alert } from "@/components/ui";
import { PrintButton } from "@/features/fees/components/PrintButton";
import { getLetterhead } from "@/features/fees/queries";
import { SettlementForm } from "@/features/settlement/components/SettlementForm";
import { SettlementStatement } from "@/features/settlement/components/SettlementStatement";
import { getSettlement, getSettlementPreview } from "@/features/settlement/queries";
import { requireActiveHostel } from "@/lib/hostels/active";
import { createClient } from "@/lib/supabase/server";
import { uuid } from "@/lib/validation";

export const metadata: Metadata = { title: "Move-out settlement" };

/**
 * Settles a resident's closed stay, or shows its statement once settled
 * (ClickUp E13-T8). Staff see the statement; only owners settle.
 */
export default async function SettlementPage({
  params,
}: {
  params: Promise<{ id: string; allocationId: string }>;
}) {
  const { user, hostel } = await requireActiveHostel();
  const { id, allocationId } = await params;
  if (!uuid("Resident").safeParse(id).success || !uuid("Stay").safeParse(allocationId).success) {
    notFound();
  }

  const supabase = await createClient();
  const [{ data: stay }, settlement, letterhead] = await Promise.all([
    supabase
      .from("allocations")
      .select(
        "id, end_date, resident_id, residents!allocations_resident_fkey(full_name), rooms(room_number), beds!allocations_bed_fkey(bed_label)",
      )
      .eq("id", allocationId)
      .eq("resident_id", id)
      .eq("hostel_id", hostel.id)
      .maybeSingle(),
    getSettlement(supabase, hostel.id, allocationId),
    getLetterhead(supabase, hostel.id),
  ]);
  if (!stay) notFound();
  const residentName = stay.residents?.full_name ?? "Resident";
  const room = [stay.rooms?.room_number, stay.beds?.bed_label].filter(Boolean).join(" / ");
  const back = (
    <Link
      href={`/residents/${id}`}
      className="text-sm font-medium text-brand-700 hover:underline print:hidden"
    >
      ← {residentName}
    </Link>
  );

  if (settlement) {
    return (
      <div className="mx-auto max-w-[210mm]">
        <div className="mb-4 flex items-center justify-between print:hidden">
          {back}
          <PrintButton label="Print statement" />
        </div>
        <div className="rounded-lg border border-slate-200 bg-white p-8 shadow-xs print:rounded-none print:border-0 print:p-0 print:shadow-none">
          <SettlementStatement
            hostel={letterhead}
            settlement={settlement}
            residentName={residentName}
            room={room}
          />
        </div>
      </div>
    );
  }

  const preview = stay.end_date ? await getSettlementPreview(supabase, allocationId) : null;
  return (
    <div className="max-w-3xl space-y-6">
      {back}
      <PageHeader
        title={`Settle ${residentName}'s move-out`}
        description="Re-bill the last month for the nights held, take deductions from the deposit, and refund what is left."
      />
      {!preview ? (
        <Alert tone="info">Vacate the bed first, then settle the move-out here.</Alert>
      ) : user.role !== "owner" ? (
        <Alert tone="info">Only the hostel owner can settle a move-out.</Alert>
      ) : (
        <div className="rounded-lg border border-slate-200 bg-white p-5 shadow-xs sm:p-6">
          <SettlementForm preview={preview} />
        </div>
      )}
    </div>
  );
}
