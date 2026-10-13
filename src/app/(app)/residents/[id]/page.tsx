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
import { getAllocationEvents, getVacantBeds } from "@/features/allocations/queries";
import { ComplaintTable } from "@/features/complaints/components/ComplaintTable";
import { getOpenComplaints } from "@/features/complaints/queries";
import { EraseResidentDialog } from "@/features/data-protection/components/DataForms";
import { FeeExemptionToggle } from "@/features/fees/components/FeeHeadForms";
import { PaymentDialog } from "@/features/fees/components/PaymentDialog";
import { BalanceSentence, ResidentFees } from "@/features/fees/components/ResidentFees";
import { ResidentCharges } from "@/features/fees/components/ResidentCharges";
import { ResidentMoneyPanel } from "@/features/fees/components/ResidentMoneyPanel";
import {
  getFeeHeads,
  getResidentBalance,
  getResidentCharges,
  getResidentDiscounts,
  getResidentExemptions,
  getResidentInvoices,
  getResidentMoney,
} from "@/features/fees/queries";
import { IdProofUpload } from "@/features/residents/components/IdProofUpload";
import { ResidentStatusControl } from "@/features/residents/components/ResidentStatusControl";
import {
  GENDER_LABELS,
  ID_PROOF_LABELS,
  RESIDENT_STATUS_LABELS,
  RESIDENT_STATUS_TONES,
} from "@/features/residents/options";
import { requireActiveHostel } from "@/lib/hostels/active";
import { formatMonth } from "@/lib/money";
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
  searchParams: Promise<{ registered?: string; updated?: string; erased?: string }>;
}) {
  const { user, hostel } = await requireActiveHostel();
  const { id } = await params;
  const { registered, updated, erased } = await searchParams;
  if (!uuid("Resident").safeParse(id).success) notFound();

  const supabase = await createClient();
  const [
    { data: resident, error },
    { data: allocations, error: allocationsError },
    vacantBeds,
    events,
    balance,
    invoices,
    heads,
    exemptions,
    charges,
    discounts,
    money,
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
    getFeeHeads(supabase, hostel.id),
    getResidentExemptions(supabase, hostel.id, id),
    getResidentCharges(supabase, hostel.id, id),
    getResidentDiscounts(supabase, hostel.id, id),
    getResidentMoney(supabase, hostel.id, id),
    getOpenComplaints(supabase, hostel.id, { residentId: id }),
  ]);
  const monthlyHeads = heads.filter((head) => head.billing === "monthly" && head.active);
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
  const isErased = resident.erased_at !== null;
  const bedOptions = vacantBeds.map((bed) => ({ value: bed.id, label: bed.label }));
  const allocatable = status === "active" || status === "notice";
  // Oldest first, so the payment dialog preselects the longest-owed month.
  const payable = invoices
    .filter((invoice) => invoice.balance - invoice.pendingCheques > 0)
    .reverse()
    .map((invoice) => ({
      id: invoice.id,
      label: formatMonth(invoice.periodMonth),
      balance: invoice.balance - invoice.pendingCheques,
    }));

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
              !isErased && (
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
        {erased && <Alert tone="success">The resident&apos;s personal data has been erased.</Alert>}
        {isErased && !erased && (
          <Alert tone="info">
            This resident&apos;s personal data was erased on{" "}
            {moment.format(new Date(resident.erased_at!))}. Their stays and payments are kept as the
            law requires.
          </Alert>
        )}
      </div>

      {!isErased && (
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
              <h3 className="mb-2 text-sm font-medium text-slate-700">Status</h3>
              <ResidentStatusControl
                resident={{ id: resident.id, name: resident.full_name, status }}
              />
            </div>
          </div>
        </Card>
      )}

      {!isErased && (
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
                  `${ID_PROOF_LABELS[resident.id_proof_type as IdProofType]} ending ${resident.id_proof_last4}`,
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
            <div className="mt-5 border-t border-slate-200 pt-5">
              <IdProofUpload residentId={resident.id} hasFile={Boolean(resident.id_proof_path)} />
            </div>
          </Card>
        </div>
      )}

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
                </Tr>
              ))}
            </TBody>
          </Table>
        )}

        <h3 className="mt-6 mb-3 text-sm font-semibold text-slate-900">Activity log</h3>
        <AllocationHistory events={events} show="bed" caption="Allocation activity log" />
      </Card>

      <Card title="Credit and deposit" id="money-heading">
        <ResidentMoneyPanel
          residentId={resident.id}
          money={money}
          isOwner={user.role === "owner"}
          canSettle={!current && history.length > 0}
        />
      </Card>

      <Card title="Fees" id="fees-heading">
        <ResidentFees balance={balance} invoices={invoices} />
        {monthlyHeads.length > 0 && (
          <div className="mt-6 border-t border-slate-200 pt-5">
            <h3 className="mb-3 text-sm font-semibold text-slate-900">Monthly charges</h3>
            <ul className="divide-y divide-slate-100 text-sm">
              {monthlyHeads.map((head) => {
                const exempt = exemptions.has(head.id);
                return (
                  <li key={head.id} className="flex items-center justify-between gap-3 py-2">
                    <span>
                      {head.name}{" "}
                      <Badge tone={exempt ? "neutral" : "success"}>
                        {exempt ? "Excused" : "Billed"}
                      </Badge>
                    </span>
                    {user.role === "owner" && (
                      <FeeExemptionToggle residentId={resident.id} head={head} exempt={exempt} />
                    )}
                  </li>
                );
              })}
            </ul>
          </div>
        )}
        <div className="mt-6 border-t border-slate-200 pt-5">
          <ResidentCharges
            resident={{ id: resident.id, name: resident.full_name }}
            charges={charges}
            discounts={discounts}
            heads={heads}
            isOwner={user.role === "owner"}
          />
        </div>
      </Card>

      <Card title="Open complaints" id="complaints-heading">
        {complaints.length === 0 ? (
          <p className="text-sm text-slate-600">
            Nothing reported by {resident.full_name} is open.
          </p>
        ) : (
          <ComplaintTable
            rows={complaints}
            caption={`Open complaints from ${resident.full_name}`}
            compact
          />
        )}
        <Link
          href={`/complaints/new?resident=${resident.id}`}
          className={buttonClass({ variant: "secondary", size: "sm", className: "mt-4" })}
        >
          Raise a complaint for {resident.full_name}
        </Link>
      </Card>

      {user.role === "owner" && status === "vacated" && !current && !isErased && (
        <section
          aria-labelledby="erase-heading"
          className="rounded-lg border border-red-200 bg-white p-5 sm:p-6"
        >
          <h2 id="erase-heading" className="text-base font-semibold text-red-800">
            Erase personal data
          </h2>
          <p className="mt-1 mb-4 text-sm text-slate-600">
            When a former resident asks to be forgotten (DPDP Act 2023), erase their personal data.
            Financial records stay.
          </p>
          <EraseResidentDialog residentId={resident.id} name={resident.full_name} />
        </section>
      )}
    </div>
  );
}
