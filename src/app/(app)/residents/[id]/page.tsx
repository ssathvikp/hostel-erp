import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import type { ReactNode } from "react";

import { PageHeader } from "@/components/shell/PageHeader";
import { Alert, Badge, buttonClass, Table, TBody, Td, Th, THead, Tr } from "@/components/ui";
import { AllocateDialog } from "@/features/allocations/components/AllocateDialog";
import { AllocationHistory } from "@/features/allocations/components/AllocationHistory";
import { StayActions } from "@/features/allocations/components/StayActions";
import { VACATE_REASON_LABELS } from "@/features/allocations/options";
import { DataRights } from "@/features/data-rights/components/DataRights";
import { DepositDialog } from "@/features/deposits/components/DepositDialog";
import { DepositLedger } from "@/features/deposits/components/DepositLedger";
import { depositHint, getDepositRates, getResidentDeposit } from "@/features/deposits/queries";
import { getAllocationEvents, getVacantBeds } from "@/features/allocations/queries";
import { PaymentDialog } from "@/features/fees/components/PaymentDialog";
import { ResidentCharges } from "@/features/charges/components/ResidentCharges";
import { ResidentCredit } from "@/features/fees/components/ResidentCredit";
import { BalanceSentence, ResidentFees } from "@/features/fees/components/ResidentFees";
import { invoiceLabel } from "@/features/fees/options";
import { getResidentBalance, getResidentInvoices } from "@/features/fees/queries";
import { IdProofUpload } from "@/features/residents/components/IdProofUpload";
import { getSettledStays } from "@/features/settlement/queries";
import { OpenComplaints } from "@/features/complaints/components/OpenComplaints";
import { getOpenComplaintsFor } from "@/features/complaints/queries";
import { ResidentStatusControl } from "@/features/residents/components/ResidentStatusControl";
import {
  GENDER_LABELS,
  ID_PROOF_LABELS,
  RESIDENT_STATUS_LABELS,
  RESIDENT_STATUS_TONES,
} from "@/features/residents/options";
import { requireActiveHostel } from "@/lib/hostels/active";
import { formatPaise } from "@/lib/money";
import { createClient } from "@/lib/supabase/server";
import { todayIst, uuid } from "@/lib/validation";
import type { Gender, IdProofType, ResidentStatus, VacateReason } from "@/types";

export const metadata: Metadata = { title: "Resident" };

// Calendar dates are stored as YYYY-MM-DD; format them without shifting days.
const day = new Intl.DateTimeFormat("en-IN", { dateStyle: "medium", timeZone: "UTC" });
const moment = new Intl.DateTimeFormat("en-IN", {
  dateStyle: "medium",
  timeStyle: "short",
  timeZone: "Asia/Kolkata",
});

function formatDay(value: string | null) {
  return value ? day.format(new Date(value)) : "—";
}

function Card({ title, children, id }: { title: string; children: ReactNode; id: string }) {
  return (
    <section
      aria-labelledby={id}
      className="rounded-lg border border-slate-200 bg-white p-5 shadow-xs sm:p-6"
    >
      <h2 id={id} className="mb-4 text-base font-semibold text-slate-900">
        {title}
      </h2>
      {children}
    </section>
  );
}

function Details({ items }: { items: [string, ReactNode][] }) {
  return (
    <dl className="grid gap-x-6 gap-y-3 text-sm sm:grid-cols-[minmax(0,10rem)_1fr]">
      {items.map(([label, value]) => (
        <div key={label} className="contents">
          <dt className="text-slate-500">{label}</dt>
          <dd className="break-words text-slate-900">{value || "—"}</dd>
        </div>
      ))}
    </dl>
  );
}

/** The single view of a resident (E5-T5). */
export default async function ResidentPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ registered?: string; updated?: string }>;
}) {
  const { user, hostel } = await requireActiveHostel();
  const { id } = await params;
  const { registered, updated } = await searchParams;
  if (!uuid("Resident").safeParse(id).success) notFound();

  const supabase = await createClient();
  const [
    { data: resident, error },
    { data: allocations, error: allocationsError },
    vacantBeds,
    events,
    balance,
    invoices,
    deposit,
    depositRates,
    settled,
    complaints,
  ] = await Promise.all([
    supabase.from("residents").select("*").eq("id", id).eq("hostel_id", hostel.id).maybeSingle(),
    supabase
      .from("allocations")
      .select(
        "id, start_date, end_date, vacate_reason, rooms(room_number), beds!allocations_bed_fkey(bed_label)",
      )
      .eq("resident_id", id)
      .eq("hostel_id", hostel.id)
      .order("start_date", { ascending: false }),
    getVacantBeds(supabase, hostel.id),
    getAllocationEvents(supabase, hostel.id, { residentId: id }),
    getResidentBalance(supabase, hostel.id, id),
    getResidentInvoices(supabase, hostel.id, id),
    getResidentDeposit(supabase, hostel.id, id),
    getDepositRates(supabase, hostel.id),
    getSettledStays(supabase, hostel.id, id),
    getOpenComplaintsFor(supabase, hostel.id, { residentId: id }),
  ]);
  if (error) throw error;
  if (allocationsError) throw allocationsError;
  if (!resident) notFound();

  const today = todayIst();
  const history = allocations ?? [];
  const current = history.find(
    (allocation) =>
      allocation.start_date <= today &&
      (allocation.end_date === null || allocation.end_date >= today),
  );
  const status = resident.status as ResidentStatus;
  const bedOptions = vacantBeds.map((bed) => ({ value: bed.id, label: bed.label }));
  const allocatable = status === "active" || status === "notice";
  // Oldest first, so the payment dialog preselects the longest-owed month.
  const payable = invoices
    .filter((invoice) => invoice.balance - invoice.pendingCheques > 0)
    .reverse()
    .map((invoice) => ({
      id: invoice.id,
      label: invoiceLabel(invoice),
      balance: invoice.balance - invoice.pendingCheques,
    }));

  const erased = resident.erased_at !== null;
  const { data: creditHeld } = await supabase
    .from("credit_balances")
    .select("held")
    .eq("resident_id", id)
    .maybeSingle();
  const { count: pendingCharges } = await supabase
    .from("resident_charges")
    .select("id", { count: "exact", head: true })
    .eq("resident_id", id)
    .is("invoice_id", null)
    .is("voided_at", null);
  // Mirrors the checks in erase_resident, so the screen explains them.
  const eraseBlockers = [
    status !== "vacated" && "Mark them vacated once they have left.",
    current && "Vacate their bed first.",
    balance.outstanding > 0 && "Settle what they owe first.",
    deposit.balance.held > 0 && "Refund or deduct the security deposit first.",
    (pendingCharges ?? 0) > 0 && "Bill or void their pending charges first.",
    (creditHeld?.held ?? 0) > 0 && "Refund or use their advance credit first.",
  ].filter((blocker): blocker is string => typeof blocker === "string");

  return (
    <div className="max-w-4xl space-y-6">
      <div>
        <Link href="/residents" className="text-sm font-medium text-brand-700 hover:underline">
          ← All residents
        </Link>
        <div className="mt-2">
          <PageHeader
            title={resident.full_name}
            description={
              <span className="inline-flex items-center gap-2">
                <Badge tone={RESIDENT_STATUS_TONES[status]}>{RESIDENT_STATUS_LABELS[status]}</Badge>
                {resident.status_changed_at && (
                  <span>since {moment.format(new Date(resident.status_changed_at))}</span>
                )}
              </span>
            }
            actions={
              erased ? undefined : (
                <Link
                  href={`/residents/${resident.id}/edit`}
                  className={buttonClass({ variant: "secondary" })}
                >
                  Edit details
                </Link>
              )
            }
          />
        </div>
        {registered && <Alert tone="success">Resident registered.</Alert>}
        {updated && <Alert tone="success">Resident details saved.</Alert>}
      </div>

      {erased && (
        <Alert tone="info">
          This resident&apos;s personal details were erased at their request. Their stays and
          payments remain for the hostel&apos;s records.
        </Alert>
      )}

      {!erased && (
        <Card title="Actions" id="actions-heading">
          <div className="space-y-5">
            <div>
              <h3 className="mb-2 text-sm font-medium text-slate-700">Bed</h3>
              {current ? (
                <StayActions
                  stay={{
                    allocationId: current.id,
                    residentId: resident.id,
                    residentName: resident.full_name,
                    bedLabel: current.beds?.bed_label ?? "",
                    startDate: current.start_date,
                  }}
                  bedOptions={bedOptions}
                  vacateNote={
                    deposit.balance.held > 0
                      ? `${formatPaise(deposit.balance.held)} security deposit is held. After vacating, record the refund and any deduction under Security deposit.`
                      : undefined
                  }
                  feeSummary={
                    <>
                      <BalanceSentence balance={balance} />
                      <p className="mt-1">
                        Rent for the new bed follows its sharing type unless you set an override.
                        This month&apos;s invoice, if already issued, is not changed; void and
                        generate it again to charge each bed for its nights.
                      </p>
                    </>
                  }
                />
              ) : allocatable ? (
                <AllocateDialog
                  title={`Allocate a bed to ${resident.full_name}`}
                  depositHint={depositHint(depositRates)}
                  fixed={{ name: "resident_id", value: resident.id }}
                  choice={{
                    name: "bed_id",
                    label: "Bed",
                    placeholder: "Choose a vacant bed",
                    options: bedOptions,
                    emptyMessage:
                      "There are no vacant beds. Free a bed, or add rooms, before allocating.",
                  }}
                />
              ) : (
                <p className="text-sm text-slate-600">
                  {RESIDENT_STATUS_LABELS[status]} residents cannot be given a bed. Make the
                  resident active first.
                </p>
              )}
            </div>
            <div>
              <h3 className="mb-2 text-sm font-medium text-slate-700">Fees</h3>
              {payable.length > 0 ? (
                <PaymentDialog residentName={resident.full_name} invoices={payable} />
              ) : (
                <p className="text-sm text-slate-600">Nothing is due.</p>
              )}
            </div>
            <div>
              <h3 className="mb-2 text-sm font-medium text-slate-700">Security deposit</h3>
              <DepositDialog
                residentId={resident.id}
                residentName={resident.full_name}
                held={deposit.balance.held}
              />
            </div>
            <div>
              <h3 className="mb-2 text-sm font-medium text-slate-700">Status</h3>
              <ResidentStatusControl
                resident={{ id: resident.id, name: resident.full_name, status }}
              />
            </div>
          </div>
        </Card>
      )}

      <div className="grid gap-6 lg:grid-cols-2">
        <Card title="Personal and contact" id="personal-heading">
          <Details
            items={[
              ["Mobile", resident.phone],
              ["Alternate", resident.alt_phone],
              ["Email", resident.email],
              ["Gender", GENDER_LABELS[resident.gender as Gender]],
              ["Date of birth", formatDay(resident.dob)],
              ["Permanent address", resident.permanent_address],
              ["Guardian", resident.guardian_name],
              ["Guardian mobile", resident.guardian_phone],
              ["Joined", formatDay(resident.joining_date)],
              ["Notes", resident.notes],
            ]}
          />
        </Card>

        <Card title="KYC" id="kyc-heading">
          <Details
            items={[
              [
                "ID proof",
                resident.id_proof_last4
                  ? `${ID_PROOF_LABELS[resident.id_proof_type as IdProofType]} ending ${resident.id_proof_last4}`
                  : "Erased",
              ],
              [
                "Copy on file",
                resident.id_proof_path ? (
                  <a
                    href={`/residents/${resident.id}/id-proof`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="font-medium text-brand-700 underline"
                  >
                    View ID proof
                  </a>
                ) : (
                  "No copy uploaded"
                ),
              ],
            ]}
          />
          {!erased && (
            <div className="mt-5 border-t border-slate-200 pt-5">
              <IdProofUpload residentId={resident.id} hasFile={Boolean(resident.id_proof_path)} />
            </div>
          )}
        </Card>
      </div>

      <Card title="Room and bed" id="stay-heading">
        {current ? (
          <p className="text-sm text-slate-900">
            Room <span className="font-medium">{current.rooms?.room_number}</span>, bed{" "}
            <span className="font-medium">{current.beds?.bed_label}</span> since{" "}
            {formatDay(current.start_date)}
          </p>
        ) : (
          <p className="text-sm text-slate-600">Not allocated to a bed.</p>
        )}

        <h3 className="mt-6 mb-3 text-sm font-semibold text-slate-900">Allocation history</h3>
        {history.length === 0 ? (
          <p className="text-sm text-slate-600">No allocations yet.</p>
        ) : (
          <Table caption="Allocation history">
            <THead>
              <tr>
                <Th>Bed</Th>
                <Th>From</Th>
                <Th>To</Th>
                <Th>Reason</Th>
                <Th>Settlement</Th>
              </tr>
            </THead>
            <TBody>
              {history.map((allocation) => (
                <Tr key={allocation.id}>
                  <Td>{allocation.beds?.bed_label}</Td>
                  <Td>{formatDay(allocation.start_date)}</Td>
                  <Td>{allocation.end_date ? formatDay(allocation.end_date) : "Present"}</Td>
                  <Td>
                    {allocation.vacate_reason
                      ? VACATE_REASON_LABELS[allocation.vacate_reason as VacateReason]
                      : "—"}
                  </Td>
                  <Td>
                    {settled.has(allocation.id) ? (
                      <Link
                        href={`/residents/${resident.id}/settlement/${allocation.id}`}
                        className="text-brand-700 hover:underline"
                      >
                        Statement
                      </Link>
                    ) : allocation.end_date && allocation.vacate_reason !== "transferred" ? (
                      <Link
                        href={`/residents/${resident.id}/settlement/${allocation.id}`}
                        className="text-brand-700 hover:underline"
                      >
                        {user.role === "owner" ? "Settle move-out" : "Not settled"}
                      </Link>
                    ) : (
                      "—"
                    )}
                  </Td>
                </Tr>
              ))}
            </TBody>
          </Table>
        )}

        <h3 className="mt-6 mb-3 text-sm font-semibold text-slate-900">Activity log</h3>
        <AllocationHistory events={events} show="bed" caption="Allocation activity log" />
      </Card>

      <Card title="Open complaints" id="complaints-heading">
        <OpenComplaints
          rows={complaints}
          raiseHref={`/complaints/new?resident=${resident.id}`}
          caption={`Open complaints for ${resident.full_name}`}
        />
      </Card>

      <Card title="Fees" id="fees-heading">
        <ResidentFees balance={balance} invoices={invoices} />
      </Card>

      <Card title="Advance credit" id="credit-heading">
        <ResidentCredit
          residentId={resident.id}
          residentName={resident.full_name}
          hostelId={hostel.id}
          isOwner={user.role === "owner"}
          editable={!erased}
          hasOpenInvoices={payable.length > 0}
        />
      </Card>

      <Card title="Charges and discounts" id="charges-heading">
        <ResidentCharges
          residentId={resident.id}
          hostelId={hostel.id}
          isOwner={user.role === "owner"}
          editable={!erased}
          currentAllocationId={current?.id ?? null}
        />
      </Card>

      <Card title="Data and privacy" id="privacy-heading">
        <DataRights
          resident={{
            id: resident.id,
            name: resident.full_name,
            consentAt: resident.consent_at ? moment.format(new Date(resident.consent_at)) : null,
            erasedAt: resident.erased_at ? moment.format(new Date(resident.erased_at)) : null,
          }}
          isOwner={user.role === "owner"}
          erasable={eraseBlockers.length === 0}
          blockers={eraseBlockers}
        />
      </Card>

      <Card title="Security deposit" id="deposit-heading">
        <DepositLedger
          balance={deposit.balance}
          entries={deposit.entries}
          canVoid={user.role === "owner"}
        />
      </Card>
    </div>
  );
}
