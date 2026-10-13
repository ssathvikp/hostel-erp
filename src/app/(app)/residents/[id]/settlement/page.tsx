import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";

import { PageHeader } from "@/components/shell/PageHeader";
import { Alert } from "@/components/ui";
import { PrintButton } from "@/features/fees/components/PrintButton";
import { ResidentMoneyPanel } from "@/features/fees/components/ResidentMoneyPanel";
import { SettlementForm } from "@/features/fees/components/SettlementForm";
import { getResidentMoney, getSettlementPreview } from "@/features/fees/queries";
import { requireActiveHostel } from "@/lib/hostels/active";
import { formatMonth, formatPaise } from "@/lib/money";
import { createClient } from "@/lib/supabase/server";
import { todayIst, uuid } from "@/lib/validation";

export const metadata: Metadata = { title: "Settlement" };

const day = new Intl.DateTimeFormat("en-IN", { dateStyle: "medium", timeZone: "UTC" });

function Row({ label, value, sign }: { label: string; value: number; sign: "+" | "−" }) {
  return (
    <div className="flex justify-between gap-4 py-2">
      <dt className="text-slate-700">{label}</dt>
      <dd className="text-slate-900 tabular-nums">
        {value === 0 ? formatPaise(0) : `${sign} ${formatPaise(value)}`}
      </dd>
    </div>
  );
}

/**
 * Move-out settlement (E13-T8): one statement of what the resident owes and
 * is owed, and the step that settles it. Owners only; printable.
 */
export default async function SettlementPage({ params }: { params: Promise<{ id: string }> }) {
  const { user, hostel } = await requireActiveHostel();
  const { id } = await params;
  if (!uuid("Resident").safeParse(id).success) notFound();
  if (user.role !== "owner") redirect(`/residents/${id}`);

  const supabase = await createClient();
  const { data: resident, error } = await supabase
    .from("residents")
    .select("id, full_name, phone")
    .eq("id", id)
    .eq("hostel_id", hostel.id)
    .maybeSingle();
  if (error) throw error;
  if (!resident) notFound();

  const [preview, money] = await Promise.all([
    getSettlementPreview(supabase, id),
    getResidentMoney(supabase, hostel.id, id),
  ]);
  const settled =
    preview.dues === 0 &&
    preview.pendingCharges === 0 &&
    preview.credit === 0 &&
    preview.depositHeld === 0 &&
    preview.unusedCredit === 0;

  return (
    <div className="max-w-3xl space-y-6">
      <div className="print:hidden">
        <Link
          href={`/residents/${id}`}
          className="text-sm font-medium text-brand-700 hover:underline"
        >
          ← {resident.full_name}
        </Link>
      </div>
      <PageHeader
        title={`Settlement for ${resident.full_name}`}
        description={`${hostel.name} · ${resident.phone} · ${day.format(new Date(todayIst()))}`}
        actions={<PrintButton label="Print statement" />}
      />

      <section
        aria-labelledby="statement-heading"
        className="rounded-lg border border-slate-200 bg-white p-5 shadow-xs sm:p-6"
      >
        <h2 id="statement-heading" className="mb-3 text-base font-semibold text-slate-900">
          Statement
        </h2>
        <dl className="divide-y divide-slate-100 text-sm">
          <Row label="Deposit held" value={preview.depositHeld} sign="+" />
          <Row label="Credit held" value={preview.credit} sign="+" />
          {preview.unusedCredit > 0 && (
            <Row
              label={`Unused nights on ${preview.unusedInvoiceNumber} (${formatMonth(preview.unusedMonth!)})`}
              value={preview.unusedCredit}
              sign="+"
            />
          )}
          <Row label="Unpaid invoices" value={preview.dues} sign="−" />
          <Row label="Charges not yet billed" value={preview.pendingCharges} sign="−" />
          <div className="flex justify-between gap-4 pt-3 font-semibold">
            <dt>
              {preview.net >= 0 ? "To pay back to the resident" : "Still owed by the resident"}
            </dt>
            <dd className="tabular-nums">{formatPaise(Math.abs(preview.net))}</dd>
          </div>
        </dl>
        <p className="mt-3 text-xs text-slate-500">
          Before any deductions from the deposit. The deposit only pays what is owed if you choose
          so below.
        </p>
      </section>

      {settled ? (
        <Alert tone="success" title="Nothing left to settle">
          Every invoice is paid and nothing is held for this resident.
        </Alert>
      ) : (
        <section
          aria-labelledby="settle-heading"
          className="rounded-lg border border-slate-200 bg-white p-5 shadow-xs sm:p-6 print:hidden"
        >
          <h2 id="settle-heading" className="mb-4 text-base font-semibold text-slate-900">
            Settle
          </h2>
          <SettlementForm residentId={id} />
        </section>
      )}

      <section aria-labelledby="movements-heading">
        <h2 id="movements-heading" className="mb-3 text-base font-semibold text-slate-900">
          Credit and deposit
        </h2>
        <ResidentMoneyPanel residentId={id} money={money} isOwner={false} canSettle={false} />
      </section>
    </div>
  );
}
